#include "appearance-bridge.h"
#include "core/video/AssetPaths.h"
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QImage>
#include <QRegularExpression>

QString webSkinDirectory(const QString& name)
{
    if (name == "skinSD" || name == "skinDX") return miacode::assets::assetPath("skin/" + name);
    static const QRegularExpression pattern(QStringLiteral("^skin-[a-f0-9]{64}$"));
    return pattern.match(name).hasMatch() ? QStringLiteral("/web-appearance/skins/") + name : QString();
}

QJsonObject webSkinImport(const QString& operation, const QString& name)
{
    const auto directory = webSkinDirectory(name), staged = directory + ".staging";
    if (!directory.startsWith("/web-appearance/skins/")) return {{"error", "皮肤目录无效"}};
    if (operation == "begin") {
        if (QDir(directory).exists()) return {{"ready", true}};
        if (QDir(staged).exists() && !QDir(staged).removeRecursively()) return {{"error", "皮肤导入目录清理失败"}};
        if (!QDir().mkpath(staged)) return {{"error", "皮肤导入目录创建失败"}};
    } else if (operation == "commit") {
        if (!QFile::exists(staged + "/tap.png") || !QDir().rename(staged, directory)) return {{"error", "皮肤导入提交失败"}};
    } else if (operation == "abort") {
        if (QDir(staged).exists() && !QDir(staged).removeRecursively()) return {{"error", "皮肤导入目录清理失败"}};
    } else return {{"error", "皮肤导入操作无效"}};
    return {{"ready", operation == "commit"}};
}

QJsonObject webImportAppearanceImage(const QJsonObject& request, const QByteArray& data)
{
    const auto image = QImage::fromData(data, "PNG");
    if (image.isNull() || image.width() > 4096 || image.height() > 4096) return {{"error", "请选择宽高在 4096 像素以内的 PNG 素材"}};
    const auto kind = request.value("kind").toString();
    QString path, fileName;
    if (kind == "skin") {
        const auto directory = webSkinDirectory(request.value("skinDirectoryName").toString());
        const auto relative = request.value("path").toString();
        const auto parts = relative.split('/');
        if (!directory.startsWith("/web-appearance/skins/") || relative.isEmpty() || QDir::isAbsolutePath(relative)
            || relative.contains('\\') || parts.contains("..") || parts.contains(".") || parts.contains(QString())
            || !relative.endsWith(".png", Qt::CaseInsensitive)) return {{"error", "皮肤素材路径无效"}};
        if (!QDir(directory + ".staging").exists()) return {{"error", "请开始皮肤导入事务"}};
        path = directory + ".staging/" + relative;
    } else if (kind == "outline") {
        fileName = "outline-" + QString::fromLatin1(QCryptographicHash::hash(data, QCryptographicHash::Sha256).toHex()) + ".png";
        path = QDir(miacode::assets::customOutlineRootPath()).filePath(fileName);
    } else return {{"error", "外观素材类型无效"}};
    QFile file(path);
    if (!file.exists() && (!QDir().mkpath(QFileInfo(path).path()) || !file.open(QIODevice::WriteOnly) || file.write(data) != data.size()))
        return {{"error", "外观素材写入失败"}};
    return {{"path", path}, {"customOutlineFileName", fileName}, {"width", image.width()}, {"height", image.height()}};
}

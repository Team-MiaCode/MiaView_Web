#include "preferences-bridge.h"
#include "app/ui/preferences/AppBackgroundSettings.h"
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>

using namespace miacode::preview::scene;
namespace {
const QStringList fontAreas{"chart_info", "timestamp", "center_display", "object_stats", "debug_info"};
}

QJsonObject webBackgroundSettings(const QJsonObject& values) {
    using namespace miacode::ui;
    QJsonObject source{{"enabled", values.value("enabled")}, {"image_path", values.value("imagePath")},
        {"size_mode", values.value("sizeMode")}, {"position", values.value("position")}};
    if (values.contains("opacity")) source.insert("opacity", values.value("opacity"));
    if (values.contains("blur")) source.insert("blur", values.value("blur"));
    auto overlays = values.value("overlays").toObject();
    if (values.contains("panelAlpha")) overlays.insert("panel", values.value("panelAlpha"));
    source.insert("overlay_alpha", overlays);
    const auto normalized = appBackgroundSettingsFromJson(source);
    return {{"enabled", normalized.enabled}, {"imagePath", normalized.imagePath}, {"opacity", normalized.opacity},
        {"blur", normalized.blur}, {"panelAlpha", normalized.overlays.panelAlpha},
        {"sizeMode", appBackgroundSizeModeToken(normalized.sizeMode)}, {"position", appBackgroundPositionToken(normalized.position)},
        {"overlays", appBackgroundSettingsToJson(normalized).value("overlay_alpha")}};
}

QJsonObject webImportFont(const QByteArray& bytes, const QString& name) {
    const auto suffix = QFileInfo(name).suffix().toLower();
    if (suffix != "ttf" && suffix != "otf") return {{"error", "请选择 TTF 或 OTF 字体"}};
    const auto hash = QString::fromLatin1(QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex());
    const QString path = "/web-fonts/" + hash + (bytes.startsWith("OTTO") ? ".otf" : ".ttf");
    QFile file(path);
    if (!file.exists()) {
        if (!QDir().mkpath("/web-fonts") || !file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size())
            return {{"error", "字体写入失败"}};
        file.close();
    }
    const auto family = previewHudFontFamilyForFile(path);
    if (family.isEmpty()) { file.remove(); return {{"error", "字体解码失败"}}; }
    return {{"path", path}, {"family", family}, {"sha256", hash}};
}

QJsonObject webHudFontPaths(const PreviewHudFontSettings& settings) {
    QJsonObject result;
    for (int index = 0; index < fontAreas.size(); ++index) result.insert(fontAreas[index], settings.paths[index]);
    return result;
}

bool webSetHudFontPaths(const QJsonObject& values, PreviewHudFontSettings& settings, QString& error) {
    auto next = settings;
    for (auto item = values.begin(); item != values.end(); ++item) {
        const auto index = fontAreas.indexOf(item.key());
        if (index < 0 || !item.value().isString()) { error = "HUD 字体区域或路径无效"; return false; }
        const auto path = item.value().toString();
        if (!path.isEmpty() && previewHudFontFamilyForFile(path).isEmpty()) { error = "请导入 HUD 字体"; return false; }
        next.paths[index] = path;
    }
    settings = next;
    return true;
}

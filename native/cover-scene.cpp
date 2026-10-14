#include "cover-scene.h"
#include <QFile>
#include <QJsonDocument>
#include <QQmlComponent>

WebCoverScene::WebCoverScene(QQuickItem* parent)
    : QObject(parent), layout_(this), engine_(this)
{
    layout_.ensureDefaultLayers();
    QFile source(QStringLiteral(":/intro/templates/maimai_banner.json"));
    if (!source.open(QIODevice::ReadOnly)) {
        error_ = source.errorString();
        return;
    }
    const auto coverTemplate = QJsonDocument::fromJson(source.readAll()).object();
    QQmlComponent component(&engine_, QUrl(QStringLiteral("qrc:/intro/qml/CoverComposer.qml")));
    const QVariantMap properties{
        {QStringLiteral("coverLayout"), QVariant::fromValue<QObject*>(&layout_)},
        {QStringLiteral("coverTemplate"), coverTemplate.toVariantMap()},
        {QStringLiteral("selectionBinder"), QVariant::fromValue<QObject*>(this)},
        {QStringLiteral("selectedKey"), selectedKey_},
        {QStringLiteral("editable"), true},
    };
    item_ = qobject_cast<QQuickItem*>(component.createWithInitialProperties(properties));
    if (!item_) {
        QStringList messages;
        for (const auto& error : component.errors()) messages.append(error.toString());
        error_ = messages.join(QLatin1Char('\n'));
        return;
    }
    item_->setParent(this);
    item_->setParentItem(parent);
    item_->setSize(parent->size());
    item_->setZ(2);
}

WebCoverScene::~WebCoverScene()
{
    delete item_;
}

QJsonObject WebCoverScene::configure(const QJsonObject& values)
{
    if (!error_.isEmpty()) return {{QStringLiteral("error"), error_}};
    if (values.contains(QStringLiteral("layout")))
        layout_.fromJson(values.value(QStringLiteral("layout")).toObject());
    if (values.contains(QStringLiteral("activeLayerKey")))
        selectedKey_ = values.value(QStringLiteral("activeLayerKey")).toString();
    item_->setProperty("selectedKey", selectedKey_);
    for (const auto& key : {"trackOverrides", "jacketImage", "backgroundImage", "backgroundMode", "blurEnabled", "coverBgBrightness", "cardShadowEnabled", "coverTemplate"}) {
        if (values.contains(QLatin1String(key)))
            item_->setProperty(key, values.value(QLatin1String(key)).toVariant());
    }
    return snapshot();
}

QJsonObject WebCoverScene::snapshot() const
{
    return {{QStringLiteral("layout"), layout_.toJson()}, {QStringLiteral("activeLayerKey"), selectedKey_},
        {QStringLiteral("outputWidth"), item_ ? item_->width() : 0},
        {QStringLiteral("outputHeight"), item_ ? item_->height() : 0}};
}

void WebCoverScene::setVisible(bool visible)
{
    if (item_) item_->setVisible(visible);
}

QSize WebCoverScene::outputSize() const
{
    return item_ ? QSize(qRound(item_->width()), qRound(item_->height())) : QSize();
}

void WebCoverScene::setOutputSize(const QSize& size)
{
    if (item_) item_->setSize(size);
}

void WebCoverScene::selectLayerKey(const QString& key)
{
    selectedKey_ = key;
    item_->setProperty("selectedKey", selectedKey_);
    emit compositionChanged(snapshot());
}

void WebCoverScene::commitActiveLayerGeometry()
{
    emit compositionChanged(snapshot());
}

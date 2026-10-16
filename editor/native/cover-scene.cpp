#include "cover-scene.h"
#include "export/cover_export/CoverCompositionState.h"
#include "export/cover_export/CoverCompositeRenderer.h"
#include "export/video_export/FontLibrary.h"
#include "export/video_export/VideoExportController.h"
#include "core/chart/document/SimaiDocument.h"
#include "core/chart/parser/SimaiParser.h"
#include "core/chart/document/SimaiTimingMetadata.h"
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMetaProperty>
#include <QQmlComponent>
#include <QStringList>
#include <QUrl>
#include <algorithm>

WebCoverScene::WebCoverScene(QQuickItem* parent)
    : QObject(parent), layout_(this), engine_(this)
{
    layout_.ensureDefaultLayers();
    QFile source(QStringLiteral(":/intro/templates/maimai_banner.json"));
    if (!source.open(QIODevice::ReadOnly)) {
        error_ = source.errorString();
        return;
    }
    template_ = QJsonDocument::fromJson(source.readAll()).object();
    miacode::cover_export::registerCoverChartImageProvider(&engine_, &layout_);
    QQmlComponent component(&engine_, QUrl(QStringLiteral("qrc:/intro/qml/CoverComposer.qml")));
    const QVariantMap properties{
        {QStringLiteral("coverLayout"), QVariant::fromValue<QObject*>(&layout_)},
        {QStringLiteral("coverTemplate"), template_.toVariantMap()},
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
    connect(item_, SIGNAL(layerPreviewRevisionChanged()), this, SLOT(syncFrames()), Qt::QueuedConnection);
    connect(&layout_, &miacode::cover_export::CoverLayoutModel::layersChanged, this, &WebCoverScene::syncFrames, Qt::QueuedConnection);
    connect(&playback_, &miacode::cover_export::CoverFramePlaybackController::secondsChanged, this, [this] {
        if (!synchronizingPlayback_ && playback_.playing()) playbackClock_.start();
        if (auto* layer = layout_.layer(selectedKey_); layer && layer->kind() == "chartFrame") {
            layer->setFrameSeconds(playback_.seconds());
            updateFrame(layer);
            publishPlayback();
        }
    });
    connect(&playback_, &miacode::cover_export::CoverFramePlaybackController::playingChanged, this, [this] {
        if (playback_.playing()) playbackClock_.start();
        else playbackClock_.invalidate();
        item_->setProperty("chartFramePlaying", playback_.playing());
        publishPlayback(true);
        if (!playback_.playing()) emit compositionChanged(snapshot());
    });
}

WebCoverScene::~WebCoverScene()
{
    frames_.clear();
    delete item_;
}

QJsonObject WebCoverScene::configure(const QJsonObject& values)
{
    if (!error_.isEmpty()) return {{QStringLiteral("error"), error_}};
    if (values.contains(QStringLiteral("layout"))) {
        playback_.cancelInput();
        playback_.pause();
        layout_.fromJson(values.value(QStringLiteral("layout")).toObject());
    }
    if (values.contains(QStringLiteral("activeLayerKey")))
        selectedKey_ = values.value(QStringLiteral("activeLayerKey")).toString();
    if (!layout_.layer(selectedKey_)) selectedKey_ = layout_.cardKey();
    item_->setProperty("selectedKey", selectedKey_);
    for (const auto& key : {"trackOverrides", "jacketImage", "backgroundImage", "backgroundMode", "blurEnabled", "coverBgBrightness", "cardShadowEnabled", "coverTemplate"}) {
        if (values.contains(QLatin1String(key)))
            item_->setProperty(key, values.value(QLatin1String(key)).toVariant());
    }
    for (auto it = values.begin(); it != values.end(); ++it)
        if (it.key() != "layout") values_.insert(it.key(), it.value());
    auto track = values_.value("trackOverrides").toObject();
    using namespace miacode::video_export;
    if (isAutoIntroBannerMode(track.value("mode").toString("auto"))) {
        const auto source = values_.value("sourceText").toString();
        const auto difficulty = values_.value("difficulty").toInt();
        if (source != modeSource_ || difficulty != modeDifficulty_) {
            const auto document = SimaiDocument::fromText(source);
            const auto* chart = document.difficulty(difficulty);
            const auto markers = chart ? SimaiParser::parseForTimeline(chart->chart, miacode::simai::buildTimingMetadata(document)).noteMarkers
                                       : QVector<TimelineNoteMarker>();
            detectedMode_ = detectedIntroBannerMode(markers);
            modeSource_ = source; modeDifficulty_ = difficulty;
        }
        track.insert("mode", detectedMode_);
    } else track.insert("mode", normalizedIntroBannerMode(track.value("mode").toString()));
    item_->setProperty("trackOverrides", track.toVariantMap());
    if (values.contains("coverTemplate")) template_ = values.value("coverTemplate").toObject();
    if (values.contains("coverTemplate") || values.contains("cardFontDisplayPath") || values.contains("cardFontBodyPath")) {
        auto data = template_.toVariantMap();
        miacode::video_export::applyBannerFontOverride(data, values_.value("cardFontDisplayPath").toString(), values_.value("cardFontBodyPath").toString());
        item_->setProperty("coverTemplate", data);
    }
    syncSelection();
    syncFrames();
    return snapshot();
}

QJsonObject WebCoverScene::command(const QString& id, const QJsonObject& args)
{
    if (!error_.isEmpty()) return {{"error", error_}};
    using miacode::cover_export::CoverLayer;
    const auto key = args.value("key").toString(selectedKey_);
    auto* layer = layout_.layer(key);
    CoverLayer* added = nullptr;
    if (id == "cover.importLayout") {
        miacode::cover_export::CoverCompositionState imported;
        QString error;
        if (!miacode::cover_export::CoverCompositionState::fromJson(args.value("composition").toObject(), &imported, &error)) return {{"error", error}};
        const auto size = imported.size.isValid() ? imported.size : outputSize();
        if (size.width() > 4096 || size.height() > 4096) return {{"error", "封面分辨率无效"}};
        const auto background = imported.background, card = imported.card;
        auto overrides = values_.value("trackOverrides").toObject();
        overrides.insert("mode", card.value("mode").toString("auto"));
        overrides.insert("lvRenderMode", card.value("levelTextRender").toBool() ? "text" : "atlas");
        overrides.insert("stillTextMode", card.value("longText").toString("shrink"));
        const auto mode = background.value("mode").toString("jacket");
        const auto path = background.value("customPath").toString();
        QJsonObject config{{"layout", imported.layout}, {"activeLayerKey", layout_.cardKey()},
            {"trackOverrides", overrides}, {"backgroundMode", mode == "custom" ? 1 : mode == "transparent" ? 2 : 0},
            {"backgroundImage", path.isEmpty() ? QString() : QUrl::fromLocalFile(path).toString()},
            {"blurEnabled", background.value("blur").toBool(true)},
            {"coverBgBrightness", qBound(0.0, background.value("brightness").toDouble(0.45), 1.0)},
            {"cardShadowEnabled", card.value("shadow").toBool()},
            {"cardFontDisplayPath", card.value("fontDisplay").toString()}, {"cardFontBodyPath", card.value("fontBody").toString()}};
        if (!imported.outputFile.isEmpty()) config.insert("outputFile", imported.outputFile);
        setOutputSize(size);
        return configure(config);
    } else if (id == "cover.endActiveLayerKeySeek") {
        playback_.endKeySeek();
    } else if (id == "cover.toggleActiveLayerPlayback" || id == "cover.beginActiveLayerKeySeek") {
        if (!chartAvailable_ || !layer || layer->kind() != "chartFrame") return {{"error", "请选择谱面画面图层"}};
        if (id == "cover.toggleActiveLayerPlayback") playback_.toggle();
        else playback_.beginKeySeek(args.value("direction").toInt());
    } else if (id == "cover.addTextLayer") {
        added = layout_.addTextLayer(args.value("text").toString(QStringLiteral("文字")));
    } else if (id == "cover.addImageLayer") {
        added = layout_.addImageLayer(args.value("imagePath").toString());
    } else if (id == "cover.addChartFrameLayer") {
        added = layout_.addChartFrameLayerFromTemplate(
            layer && layer->kind() == "chartFrame" ? layer : nullptr,
            args.value("frameSeconds").toDouble());
    } else if (id == "cover.resetLayout") {
        layout_.resetLayout();
    } else {
        if (!layer) return {{"error", QStringLiteral("封面图层不存在")}};
        if (id == "cover.selectLayerKey") {
            selectedKey_ = key;
        } else if (id == "cover.layer" || id == "cover.setLayerVisible" || id == "cover.setLayerLocked") {
            const QStringList fields{"nx", "ny", "sizeFraction", "opacity", "visible", "locked",
                "text", "textColor", "textBold", "fontPath", "imagePath", "frameSeconds",
                "frameBgEnabled", "frameBgMode", "frameBgBrightness", "frameBgTransparency", "frameStyle"};
            // Validate the entire patch before invoking the upstream setters.
            for (auto it = args.begin(); it != args.end(); ++it) {
                if (it.key() == "key") continue;
                if (!fields.contains(it.key())) return {{"error", QStringLiteral("封面图层字段无效：") + it.key()}};
                const auto property = layer->metaObject()->property(layer->metaObject()->indexOfProperty(it.key().toUtf8().constData()));
                const auto type = property.metaType().id();
                if ((type == QMetaType::Bool && !it.value().isBool())
                    || (type == QMetaType::QString && !it.value().isString())
                    || (type == QMetaType::Double && !it.value().isDouble()))
                    return {{"error", QStringLiteral("封面图层字段类型无效：") + it.key()}};
            }
            for (auto it = args.begin(); it != args.end(); ++it)
                if (it.key() != "key") layer->setProperty(it.key().toUtf8().constData(), it.value().toVariant());
            if (key == selectedKey_ && args.contains("frameSeconds")) {
                playback_.pause();
                playback_.setSeconds(layer->frameSeconds());
                layer->setFrameSeconds(playback_.seconds());
            }
        } else if (id == "cover.raiseActiveLayer") {
            layout_.raiseLayer(layout_.indexOfKey(key));
        } else if (id == "cover.lowerActiveLayer") {
            layout_.lowerLayer(layout_.indexOfKey(key));
        } else if (id == "cover.duplicateActiveLayer") {
            added = layout_.duplicateLayer(key);
            if (!added) return {{"error", QStringLiteral("难度卡片保留单个图层")}};
        } else if (id == "cover.removeActiveLayer") {
            const auto nextKey = layout_.selectionAfterRemoval(key);
            if (!layout_.removeLayer(key)) return {{"error", QStringLiteral("难度卡片是固定图层")}};
            if (selectedKey_ == key) selectedKey_ = nextKey;
        } else if (id == "cover.moveLayer") {
            const auto row = args.value("viewRow");
            if (!row.isDouble() || row.toDouble() != row.toInt() || row.toInt() < 0 || row.toInt() > layout_.layers().size())
                return {{"error", QStringLiteral("封面图层排序位置无效")}};
            auto ordered = layout_.layers();
            std::sort(ordered.begin(), ordered.end(), [](const auto* a, const auto* b) { return a->z() > b->z(); });
            layout_.moveByViewRows(ordered.indexOf(layer), row.toInt());
        } else {
            return {{"error", QStringLiteral("封面命令无效：") + id}};
        }
    }
    if (added) selectedKey_ = added->key();
    item_->setProperty("selectedKey", selectedKey_);
    syncSelection();
    syncFrames();
    return snapshot();
}

void WebCoverScene::synchronizePlayback()
{
    if (synchronizingPlayback_ || !playback_.playing() || !playbackClock_.isValid()) return;
    const auto elapsed = playbackClock_.elapsed();
    if (elapsed <= 0) return;
    synchronizingPlayback_ = true;
    playbackClock_.start();
    // Re-arm the upstream clock before advancing so the next Qt tick counts
    // only the interval after this host observation.
    playback_.play();
    playback_.advanceForElapsed(double(elapsed) / 1000.0);
    synchronizingPlayback_ = false;
}

QJsonObject WebCoverScene::snapshot()
{
    synchronizePlayback();
    auto layout = layout_.toJson();
    auto layers = layout.value("layers").toArray();
    for (qsizetype index = 0; index < layers.size(); ++index) {
        auto value = layers[index].toObject();
        if (const auto* layer = layout_.layer(value.value("key").toString())) value.insert("pvFrameRevision", layer->pvFrameRevision());
        layers[index] = value;
    }
    layout.insert("layers", layers);
    return {{QStringLiteral("layout"), layout}, {QStringLiteral("activeLayerKey"), selectedKey_},
        {QStringLiteral("composition"), layoutFile()},
        {QStringLiteral("trackOverrides"), QJsonObject::fromVariantMap(item_->property("trackOverrides").toMap())},
        {QStringLiteral("chartFramePlaying"), playback_.playing()},
        {QStringLiteral("chartFrameDuration"), playback_.duration()},
        {QStringLiteral("outputWidth"), item_ ? item_->width() : 0},
        {QStringLiteral("outputHeight"), item_ ? item_->height() : 0}};
}

QJsonObject WebCoverScene::layoutFile() const
{
    miacode::cover_export::CoverCompositionState composition;
    composition.size = outputSize();
    const auto mode = values_.value("backgroundMode").toInt();
    composition.background = {{"mode", mode == 1 ? "custom" : mode == 2 ? "transparent" : "jacket"},
        {"customPath", QUrl(values_.value("backgroundImage").toString()).toLocalFile()},
        {"blur", values_.value("blurEnabled").toBool(true)}, {"brightness", values_.value("coverBgBrightness").toDouble(0.45)}};
    const auto track = values_.value("trackOverrides").toObject();
    composition.card = {{"mode", track.value("mode").toString("auto")}, {"shadow", values_.value("cardShadowEnabled").toBool()},
        {"levelTextRender", track.value("lvRenderMode").toString() == "text"}, {"longText", track.value("stillTextMode").toString("shrink")},
        {"fontDisplay", values_.value("cardFontDisplayPath").toString()}, {"fontBody", values_.value("cardFontBodyPath").toString()}};
    composition.layout = layout_.toJson();
    composition.outputFile = values_.value("outputFile").toString("card.jpg");
    return composition.toJson();
}

void WebCoverScene::setEditable(bool editable)
{
    if (!editable) { playback_.cancelInput(); playback_.pause(); }
    if (item_) item_->setProperty("editable", editable);
}

QJsonObject webImportCoverImage(const QByteArray& data)
{
    const auto image = QImage::fromData(data);
    if (image.isNull()) return {{"error", "封面图片解码失败"}};
    const auto hash = QString::fromLatin1(QCryptographicHash::hash(data, QCryptographicHash::Sha256).toHex());
    const auto path = QStringLiteral("/web-cover/") + hash;
    QFile file(path);
    if (!file.exists() && (!QDir().mkpath("/web-cover") || !file.open(QIODevice::WriteOnly) || file.write(data) != data.size()))
        return {{"error", "封面图片写入失败"}};
    return {{"path", path}, {"url", QUrl::fromLocalFile(path).toString()}, {"sha256", hash}, {"width", image.width()}, {"height", image.height()}};
}

void WebCoverScene::setVisible(bool visible)
{
    if (!visible) { playback_.cancelInput(); playback_.pause(); }
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
    playback_.cancelInput();
    playback_.pause();
    selectedKey_ = key;
    item_->setProperty("selectedKey", selectedKey_);
    syncSelection();
    emit compositionChanged(snapshot());
}

void WebCoverScene::commitActiveLayerGeometry()
{
    emit compositionChanged(snapshot());
}

void WebCoverScene::setChartState(const miacode::preview::scene::PreviewFrameState& state, double duration)
{
    playback_.cancelInput();
    playback_.pause();
    chartState_ = state;
    chartState_.media = {};
    chartState_.touchPadAuthoringEnabled = false;
    chartState_.render.showDebugInfo = false;
    chartState_.render.showTimestamp = false;
    chartState_.render.showObjectStatsHud = false;
    chartState_.render.showChartInfoHud = false;
    chartState_.render.centerDisplayMode = miacode::preview_gameplay::CenterDisplayMode::Off;
    chartAvailable_ = true;
    if (item_) item_->setProperty("chartFrameDiskDiameter",
        miacode::preview_video::normalizedLayoutSquareScale(chartState_.render.layoutSquareScale)
        * miacode::preview_video::effectiveLayoutRingDiameterRatio(chartState_.assets.layoutRingDiameterRatio));
    playback_.setDuration(duration);
    syncFrames();
    syncSelection();
}

void WebCoverScene::syncSelection()
{
    auto* layer = layout_.layer(selectedKey_);
    if (playbackLayerKey_ != selectedKey_ || !layer || layer->kind() != "chartFrame" || playback_.seconds() != layer->frameSeconds()) {
        playbackLayerKey_ = selectedKey_;
        playback_.cancelInput();
        playback_.pause();
        playback_.setSeconds(layer && layer->kind() == "chartFrame" ? layer->frameSeconds() : 0);
        if (layer && layer->kind() == "chartFrame") layer->setFrameSeconds(playback_.seconds());
    }
}

void WebCoverScene::syncFrames()
{
    if (!item_ || !chartAvailable_) return;
    for (auto it = frames_.begin(); it != frames_.end();) {
        const auto* layer = layout_.layer(it->first);
        if (!layer || layer->kind() != "chartFrame") it = frames_.erase(it);
        else ++it;
    }
    for (auto* layer : layout_.layers()) {
        if (layer->kind() != "chartFrame") continue;
        auto& frame = frames_[layer->key()];
        if (!frame) frame = std::make_unique<ChartFrame>();
        frame->state = chartState_;
        if (!frame->root) {
            QVariant target;
            QMetaObject::invokeMethod(item_, "layerPreviewItem", Q_RETURN_ARG(QVariant, target),
                Q_ARG(QVariant, layer->key()), Q_ARG(QVariant, item_->property("layerPreviewRevision")));
            auto* parent = qobject_cast<QQuickItem*>(target.value<QObject*>());
            if (!parent) continue;
            auto* root = new PreviewQuickSceneRoot(parent);
            frame->root = root;
            root->setEnabled(false);
            root->setClip(true);
            root->setBackgroundColor(Qt::transparent);
            root->setLayerFlags(miacode::preview::scene::kPreviewExportOverlayRenderLayers);
            root->setSize(parent->size());
            connect(parent, &QQuickItem::widthChanged, root, [parent, root] { root->setWidth(parent->width()); });
            connect(parent, &QQuickItem::heightChanged, root, [parent, root] { root->setHeight(parent->height()); });
        }
        updateFrame(layer);
    }
}

void WebCoverScene::updateFrame(miacode::cover_export::CoverLayer* layer)
{
    const auto it = frames_.find(layer->key());
    if (it == frames_.end() || !it->second->root) return;
    auto& frame = *it->second;
    frame.state.playheadSeconds = layer->frameSeconds();
    miacode::preview::scene::refreshPreviewFrameStateHudStatsSnapshot(frame.state);
    frame.root->setOpacity(layer->opacity());
    frame.root->setFrameState(&frame.state);
}

void WebCoverScene::publishPlayback(bool force)
{
    if (!force && playbackPublishClock_.isValid() && playbackPublishClock_.elapsed() < 100) return;
    playbackPublishClock_.start();
    emit playbackChanged({{"activeLayerKey", selectedKey_}, {"frameSeconds", playback_.seconds()},
        {"chartFramePlaying", playback_.playing()}, {"chartFrameDuration", playback_.duration()}});
}

bool WebCoverScene::setPvFrame(const QString& key, const QImage& image, double seconds)
{
    if (key.isEmpty() && image.isNull()) {
        for (auto* layer : layout_.chartFrameLayers()) layout_.clearLayerPvFrame(layer->key());
        return true;
    }
    const auto* layer = layout_.layer(key);
    if (!layer || layer->kind() != "chartFrame" || !layer->frameBgUsesPv()) return false;
    const auto tolerance = playback_.playing() && key == selectedKey_ ? 0.3 : 0.02;
    if (qAbs(layer->frameSeconds() - seconds) > tolerance) return false;
    layout_.setLayerPvFrame(key, image);
    return true;
}

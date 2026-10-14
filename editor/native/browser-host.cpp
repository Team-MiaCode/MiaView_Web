#include <QGuiApplication>
#include <QQuickWindow>
#include <QSurfaceFormat>
#include <QDirIterator>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QHash>
#include <QDir>
#include <QElapsedTimer>
#include <emscripten/emscripten.h>
#include "firework-layer.h"
#include "cover-scene.h"
#include "timeline-bridge.h"
#include "document-bridge.h"
#include <QQmlExtensionPlugin>
#include <QPointer>
#include "preview/quick_scene/PreviewQuickSceneRoot.h"
#include "preview/quick_scene/PreviewQuickHudLayer.h"
#include "preview/runtime/PreviewSceneAssetLoader.h"
#include "core/chart/document/SimaiDocument.h"
#include "core/chart/parser/SimaiParser.h"
#include "core/scene/PreviewFrameState.h"
#include "core/scene/PreviewSfxTimeline.h"
#include "core/scene/PreviewSfxAssets.h"
#include "core/chart/model/TimelineMarkerOffset.h"
#include "core/analysis/MuriAnalyzer.h"
#include "core/video/AssetPaths.h"

using namespace miacode::preview::scene;
Q_IMPORT_QML_PLUGIN(MiaCode_PreviewPlugin)
EM_JS(void, publishCoverChange, (const char* data), {
    Module.onCoverChanged?.(UTF8ToString(data));
});
namespace {
PreviewFrameState state;
PreviewQuickSceneRoot* scene = nullptr;
PreviewQuickHudLayer* hud = nullptr;
QQuickWindow* previewWindow = nullptr;
QPointer<WebCoverScene> coverScene;
QSize renderSize(1920, 1080);
QByteArray response;
PreviewSkinAssets dxSkin, sdSkin;
bool sdSkinLoaded = false;
bool useDxSkin = true;
double presentedFrames = 0;
MuriAnalysisReport cachedAnalysis;
bool analysisReady = false;
quint64 analysisRevision = 0;
QElapsedTimer hudUpdateClock;
constexpr qint64 kHudUpdateIntervalMs = 100;
// Only the active chart/difficulty is retained. Markers and stats already live
// in state; do not accumulate a second set of timelines for visited charts.
WebDocument editorDocument;
bool chartLoaded = false;
int loadedDifficulty = 0;
quint64 renderedRevision = 0;
QByteArray cachedLoadResponse;
WebTimeline timeline;
void applyRenderMode(RenderMode mode) {
    state.muriRenderOptions.renderMode = mode;
    // Hide diagnostic pad/hand overlays, not the analysis used by Slide
    // clearing and the other notes' Perfect/Good effects.
    state.muriRenderOptions.showJudgeMarkers = false;
    state.muriRenderOptions.showTouchTrail = false;
    if (mode == RenderMode::MaimuriDxStyle) {
        if (!analysisReady) {
            cachedAnalysis = MuriAnalyzer::analyze(state.noteMarkers, state.muriRenderOptions);
            cachedAnalysis.revision = ++analysisRevision;
            analysisReady = true;
        }
        state.muriAnalysisReport = cachedAnalysis;
    } else {
        state.muriAnalysisReport = MuriAnalysisReport();
    }
    ++state.sceneContentRevision;
}
const char* json(const QJsonObject& value) {
    response = QJsonDocument(value).toJson(QJsonDocument::Compact);
    return response.constData();
}
QJsonObject settings() {
    return {{"outerBrightness", state.render.backgroundBrightnessOuter},
        {"innerBrightness", state.render.backgroundBrightnessInner},
        {"tapFlowSpeed", state.render.tapFlowSpeed},
        {"touchFlowSpeed", state.render.touchFlowSpeed},
        {"earlierSlideOnTop", state.render.slideEarlierSecondAndTextOnTop},
        {"showJudgeEffects", true},
        {"noteSkin", useDxSkin ? "DX" : "SD"},
        {"previewMode", muriRenderModeToken(state.muriRenderOptions.renderMode)}};
}
void refresh(bool forceHud = true) {
    // Gameplay/Combo still consumes the latest statistics every tick. Only
    // the full-surface painted HUD is throttled; explicit user changes flush it.
    refreshPreviewFrameStateHudStatsSnapshot(state);
    if (scene) scene->setFrameState(&state);
    if (hud && (forceHud || !hudUpdateClock.isValid()
        || hudUpdateClock.elapsed() >= kHudUpdateIntervalMs)) {
        hudUpdateClock.start();
        hud->setFrameState(&state);
    }
}
void mountAssets() {
    QDirIterator files(":/assets", QDir::Files, QDirIterator::Subdirectories);
    while (files.hasNext()) {
        const QString resource = files.next();
        const QString path = resource.mid(1);
        QDir().mkpath(QFileInfo(path).path());
        QFile::copy(resource, path);
    }
}
}

extern "C" {
EMSCRIPTEN_KEEPALIVE const char* miacode_resolution() {
    return json({{"width", renderSize.width()}, {"height", renderSize.height()},
        {"showTimestamp", state.render.showTimestamp},
        {"showChartInfoHud", state.render.showChartInfoHud},
        {"showObjectStatsHud", state.render.showObjectStatsHud}});
}
EMSCRIPTEN_KEEPALIVE int miacode_firework_ready() {
    return scene != nullptr && miaview::firework::ready();
}
EMSCRIPTEN_KEEPALIVE const char* miacode_set_resolution(double width, double height) {
    // Match resolution.mjs, including its bounded allocation budget. Validate
    // before mutating geometry or HUD; malformed private calls leave both intact.
    if (!qIsFinite(width) || !qIsFinite(height) || width <= 0 || height <= 0
        || width > 4096 || height > 4096 || width != int(width) || height != int(height)
        || (width != height && width * 9 != height * 16))
        return json({{"error", "预览分辨率无效"}});
    renderSize = QSize(int(width), int(height));
    const bool wide = width != height;
    state.render.showTimestamp = true;
    state.render.showChartInfoHud = wide;
    state.render.showObjectStatsHud = wide;
    if (previewWindow) previewWindow->resize(renderSize);
    if (scene) scene->setSize(renderSize);
    if (hud) hud->setSize(renderSize);
    refresh();
    return miacode_resolution();
}
EMSCRIPTEN_KEEPALIVE const char* miacode_set_canvas_size(double width, double height) {
    if (!qIsFinite(width) || !qIsFinite(height) || width <= 0 || height <= 0
        || width > 4096 || height > 4096 || width != int(width) || height != int(height))
        return json({{"error", "画布尺寸无效"}});
    renderSize = QSize(int(width), int(height));
    const bool square = width == height;
    state.render.showTimestamp = true;
    state.render.showChartInfoHud = !square;
    state.render.showObjectStatsHud = !square;
    previewWindow->resize(renderSize);
    scene->setSize(renderSize);
    hud->setSize(renderSize);
    refresh();
    return miacode_resolution();
}
EMSCRIPTEN_KEEPALIVE double miacode_frame_count() {
    return presentedFrames;
}
EMSCRIPTEN_KEEPALIVE const char* miacode_settings() {
    return json(settings());
}
EMSCRIPTEN_KEEPALIVE const char* miacode_set_settings(double outer, double inner,
    int earlierOnTop, int dx, double tapSpeed, double touchSpeed, double mode) {
    using namespace miacode::preview_gameplay;
    if (!qIsFinite(outer) || !qIsFinite(inner) || outer < 0 || outer > 1 || inner < 0 || inner > 1
        || !qIsFinite(tapSpeed) || !qIsFinite(touchSpeed)
        || tapSpeed < kPreviewTimingFlowSpeedMin || tapSpeed > kPreviewTimingFlowSpeedMax
        || touchSpeed < kPreviewTimingFlowSpeedMin || touchSpeed > kPreviewTimingFlowSpeedMax
        || (earlierOnTop != 0 && earlierOnTop != 1)
        || (dx != 0 && dx != 1)
        || !qIsFinite(mode) || mode < 0 || mode > 2 || mode != int(mode))
        return json({{"error", "预览设置无效"}});
    if (!dx && !sdSkinLoaded) {
        const auto loaded = miacode::preview::runtime::PreviewSceneAssetLoader::load(
            "/assets/skin/skinSD", PreviewOutlineVariant::Line);
        if (loaded.skinAssets.tapImage.isNull()) return json({{"error", "SD 皮肤加载失败，请刷新后重试"}});
        sdSkin = loaded.skinAssets;
        sdSkinLoaded = true;
    }
    if (useDxSkin != bool(dx)) {
        // Change Note sprites only; the line outline and DX judgment assets stay fixed.
        state.skin = dx ? dxSkin : sdSkin;
        useDxSkin = bool(dx);
        ++state.sceneContentRevision;
    }
    state.render.backgroundBrightnessOuter = outer;
    state.render.backgroundBrightnessInner = inner;
    state.render.tapFlowSpeed = normalizePreviewTimingFlowSpeed(tapSpeed);
    state.render.touchFlowSpeed = normalizePreviewTimingFlowSpeed(touchSpeed);
    state.render.slideEarlierSecondAndTextOnTop = bool(earlierOnTop);
    if (state.muriRenderOptions.renderMode != static_cast<RenderMode>(int(mode)))
        applyRenderMode(static_cast<RenderMode>(int(mode)));
    refresh();
    return json(settings());
}
const char* renderDocument(int difficultyId, bool resetTime) {
    using namespace miacode::timeline::offset;
    const SimaiDocument& doc = editorDocument.workspace.document();
    const auto ids = doc.difficultyIds();
    const auto clearScene = [] {
        state.noteMarkers.clear();
        state.progressStatsCache.reset();
        cachedAnalysis = MuriAnalysisReport();
        analysisReady = false;
        applyRenderMode(state.muriRenderOptions.renderMode);
        ++state.sceneContentRevision;
        refresh();
    };
    if (ids.isEmpty()) {
        clearScene();
        timeline.load(QString(), 0, miacode::simai::SimaiTimingMetadata());
        chartLoaded = false;
        return json({{"error", "没有可预览的 inote 谱面"}});
    }
    if (coverScene) {
        coverScene->setVisible(false);
        previewWindow->resize(renderSize);
        scene->setVisible(true);
        hud->setVisible(true);
    }
    if (!ids.contains(difficultyId)) difficultyId = ids.last();
    editorDocument.workspace.selectDifficulty(difficultyId);
    const auto revision = editorDocument.workspace.snapshot().revision;
    if (chartLoaded && loadedDifficulty == difficultyId && renderedRevision == revision) {
        if (resetTime) state.playheadSeconds = 0;
        refresh();
        return cachedLoadResponse.constData();
    }
    // A failed parse must not make another difficulty reuse the old scene.
    chartLoaded = false;
    cachedLoadResponse.clear();
    const auto* difficulty = doc.difficulty(difficultyId);
    bool firstOk = false;
    const double first = parsedFirstSeconds(doc.first, &firstOk);
    timeline.load(difficulty->chart, firstOk && qIsFinite(first) ? first : 0, miacode::simai::buildTimingMetadata(doc));
    if (!firstOk || !qIsFinite(first)) {
        clearScene();
        return json({{"error", "first 必须是有限的秒数"}});
    }
    const auto parsed = SimaiParser::parseForTimeline(difficulty->chart, miacode::simai::buildTimingMetadata(doc));
    if (!parsed.ok) {
        clearScene();
        QJsonArray errors;
        for (const auto& error : parsed.errors) errors.append(QString("第 %1 行：%2").arg(error.line).arg(error.message));
        return json({{"error", errors.isEmpty() ? QString("谱面解析失败") : errors.first().toString()}, {"errors", errors}});
    }
    state.noteMarkers = shiftedNoteMarkers(parsed.noteMarkers, first, NonFiniteHandling::Propagate);
    cachedAnalysis = MuriAnalysisReport();
    analysisReady = false;
    applyRenderMode(state.muriRenderOptions.renderMode);
    auto stats = std::make_shared<PreviewProgressStatsCache>();
    stats->rebuild(state.noteMarkers);
    state.progressStatsCache = stats;
    state.chartTitle = doc.title;
    state.chartArtist = doc.artist;
    state.chartDesigner = difficulty->designer.isEmpty() ? doc.designer : difficulty->designer;
    state.chartDifficultyLabel = SimaiDocument::difficultyShortName(difficultyId) + " " + difficulty->level;
    if (resetTime) state.playheadSeconds = 0;
    ++state.sceneContentRevision;
    QVector<miacode::preview_sfx_timeline::Event> events;
    QVector<miacode::preview_sfx_timeline::TouchholdSpan> spans;
    miacode::preview_sfx_timeline::buildTimeline(state.noteMarkers, 1.0, PreviewTimingSettings(), &events, &spans);
    QJsonArray playbacks, sustains, charts;
    QHash<QString, QString> sfxFileNames;
    for (const auto& item : miacode::preview_sfx_timeline::buildScheduledPlaybacks(events)) {
        auto found = sfxFileNames.constFind(item.kind);
        if (found == sfxFileNames.cend()) {
            const auto names = miacode::preview_sfx::assetFileNamesForKind(item.kind);
            QString file;
            for (const auto& name : names) {
                if (QFileInfo::exists(":/assets/SFX/" + name)) { file = name; break; }
            }
            if (file.isEmpty() && !names.isEmpty()) file = names.first();
            sfxFileNames.insert(item.kind, file);
            found = sfxFileNames.constFind(item.kind);
        }
        const QString file = found.value();
        playbacks.append(QJsonObject{{"second", item.second}, {"kind", item.kind}, {"file", file},
            {"gain", item.gain * (item.kind == "answer" ? 0.24 : 0.09)},
            {"nextSameKindSecond", qIsFinite(item.nextSameKindSecond) ? item.nextSameKindSecond : -1.0}});
    }
    for (const auto& span : miacode::preview_sfx_timeline::buildTouchholdOwnershipSegments(spans)) {
        sustains.append(QJsonObject{{"startSecond", span.startSecond}, {"endSecond", span.endSecond},
            {"sourceOffsetSecond", span.sourceOffsetSecond}});
    }
    for (const int id : ids) charts.append(QJsonObject{{"id", id}, {"label", SimaiDocument::difficultyShortName(id) + " " + doc.difficulty(id)->level}});
    double duration = qMax(0.0, parsed.durationSeconds + first);
    for (const auto& marker : state.noteMarkers) duration = qMax(duration, qMax(marker.second, marker.endSecond) + 2.0);
    refresh();
    json({{"title", doc.title}, {"artist", doc.artist}, {"difficultyId", difficultyId},
        {"duration", duration}, {"noteCount", state.noteMarkers.size()}, {"charts", charts},
        {"sfx", playbacks}, {"touchholdSegments", sustains}});
    cachedLoadResponse = response;
    loadedDifficulty = difficultyId;
    renderedRevision = revision;
    chartLoaded = true;
    return cachedLoadResponse.constData();
}
EMSCRIPTEN_KEEPALIVE const char* miacode_load(const char* text, int difficultyId, const char* filePath) {
    editorDocument.workspace.openSource(QString::fromUtf8(text), QString::fromUtf8(filePath), difficultyId);
    return renderDocument(editorDocument.workspace.snapshot().activeDifficultyId, true);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_document() {
    return json(editorDocument.snapshot());
}
EMSCRIPTEN_KEEPALIVE const char* miacode_document_command(const char* source) {
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!request.isObject()) return json({{"error", "Document command must be an object"}});
    auto result = editorDocument.command(request.object());
    if (result.contains("error")) return json(result);
    const bool resetTime = request.object().value("id").toString() == QLatin1String("document.selectDifficulty");
    const auto preview = QJsonDocument::fromJson(QByteArray(renderDocument(editorDocument.workspace.snapshot().activeDifficultyId, resetTime)));
    result.insert("preview", preview.object());
    return json(result);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_document_save_text(int section) {
    return json({{"sourceText", editorDocument.workspace.textForSectionSave(section)},
        {"revision", double(editorDocument.workspace.snapshot().revision)}});
}
EMSCRIPTEN_KEEPALIVE const char* miacode_cover(const char* source) {
    QJsonParseError error;
    const auto value = QJsonDocument::fromJson(QByteArray(source), &error);
    if (error.error != QJsonParseError::NoError || !value.isObject())
        return json({{"error", "Cover composition must be a JSON object"}});
    const auto composition = value.object();
    const auto outputSize = coverScene ? coverScene->outputSize() : renderSize;
    const double width = composition.contains("outputWidth") ? composition.value("outputWidth").toDouble(-1) : outputSize.width();
    const double height = composition.contains("outputHeight") ? composition.value("outputHeight").toDouble(-1) : outputSize.height();
    if (!qIsFinite(width) || !qIsFinite(height) || width <= 0 || height <= 0
        || width > 4096 || height > 4096 || width != int(width) || height != int(height))
        return json({{"error", "封面分辨率无效"}});
    if (!coverScene) {
        coverScene = new WebCoverScene(previewWindow->contentItem());
        QObject::connect(coverScene, &WebCoverScene::compositionChanged, coverScene, [](const QJsonObject& changed) {
            const auto bytes = QJsonDocument(changed).toJson(QJsonDocument::Compact);
            publishCoverChange(bytes.constData());
        });
    }
    const auto result = coverScene->configure(composition);
    if (result.contains("error")) return json(result);
    previewWindow->resize(QSize(int(width), int(height)));
    coverScene->setOutputSize(QSize(int(width), int(height)));
    coverScene->setVisible(true);
    scene->setVisible(false);
    hud->setVisible(false);
    return json(coverScene->snapshot());
}
EMSCRIPTEN_KEEPALIVE const char* miacode_cover_state() {
    return json(coverScene ? coverScene->snapshot() : QJsonObject());
}
EMSCRIPTEN_KEEPALIVE const char* miacode_timeline(const char* source) {
    const auto options = QJsonDocument::fromJson(QByteArray(source));
    if (!options.isObject()) return json({{"error", "时间轴参数须为对象"}});
    return json(timeline.build(options.object()));
}
EMSCRIPTEN_KEEPALIVE const char* miacode_timeline_navigate(double x, double y) {
    auto result = timeline.navigate(x, y);
    return json(result);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_timeline_follow(double second) {
    return json(timeline.follow(second));
}
EMSCRIPTEN_KEEPALIVE void miacode_waveform(const float* samples, int count, double duration) {
    timeline.setWaveform(samples, count, duration);
}
EMSCRIPTEN_KEEPALIVE void miacode_seek(double second) {
    if (!qIsFinite(second)) return;
    state.playheadSeconds = qMax(0.0, second);
    refresh();
}
EMSCRIPTEN_KEEPALIVE void miacode_tick(double second) {
    if (!qIsFinite(second)) return;
    state.playheadSeconds = qMax(0.0, second);
    refresh(false);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_statistics() {
    QJsonArray entries;
    if (chartLoaded && state.progressStatsCache) {
        const auto counts = state.progressStatsCache->snapshotAt(state.playheadSeconds);
        const auto append = [&entries](const char* kind, int played, int total) {
            entries.append(QJsonObject{{"kind", QLatin1String(kind)}, {"played", played}, {"total", total},
                {"value", QString::number(played) + "/" + QString::number(total)}});
        };
        append("tap", counts.tapPlayed, counts.tapTotal);
        append("hold", counts.holdPlayed, counts.holdTotal);
        append("slide", counts.slidePlayed, counts.slideTotal);
        append("touch", counts.touchPlayed, counts.touchTotal);
        append("break", counts.breakPlayed, counts.breakTotal);
        append("total", counts.totalPlayed, counts.totalCount);
    }
    return json({{"statistics", entries}, {"statisticsAvailable", chartLoaded}});
}
EMSCRIPTEN_KEEPALIVE int miacode_background(const unsigned char* data, int size) {
    if (!data || size <= 0) {
        state.media = PreviewMediaFrameState();
    } else {
        const QImage image = QImage::fromData(data, size);
        if (image.isNull()) return 0;
        state.media.mediaFrame = image;
        state.media.resolvedStageImage = image;
        state.media.resolvedStageImageCacheable = true;
        state.media.stageMediaAvailable = true;
        ++state.media.stageMediaSerial;
    }
    refresh();
    return 1;
}
EMSCRIPTEN_KEEPALIVE void miacode_external_video(int enabled) {
    // The browser compositor presents the DOM video beneath our transparent
    // canvas. Keep dimming/notes/HUD in Qt, with no per-frame pixel transfer.
    state.media = PreviewMediaFrameState();
    if (enabled) {
        state.media.presentationMode = PreviewStageMediaPresentationMode::ExternalQuickMediaItem;
        state.media.externalMediaType = PreviewExternalStageMediaType::Video;
        state.media.stageMediaAvailable = true;
    }
    refresh();
}
}

int main(int argc, char** argv) {
    qputenv("QSG_RENDER_LOOP", "basic");
    QSurfaceFormat surface;
    surface.setRenderableType(QSurfaceFormat::OpenGLES);
    surface.setVersion(3, 0);
    surface.setAlphaBufferSize(8);
    surface.setDepthBufferSize(24);
    surface.setStencilBufferSize(8);
    QSurfaceFormat::setDefaultFormat(surface);
    QGuiApplication app(argc, argv);
    mountAssets();
    miacode::assets::setAssetRoot(QStringLiteral("/assets"));
    const auto loaded = miacode::preview::runtime::PreviewSceneAssetLoader::load("/assets/skin/skinDX", PreviewOutlineVariant::Line);
    state.assets = loaded.assetState;
    state.skin = loaded.skinAssets;
    dxSkin = state.skin;
    state.judgeOverlay = loaded.judgeOverlayAssets;
    state.judgeEffect = loaded.judgeEffectAssets;
    state.render.layoutSquareScale = 0.95;
    state.render.tapFlowSpeed = 7.5;
    state.render.touchFlowSpeed = 8.0;
    state.render.showTimestamp = true;
    state.render.showObjectStatsHud = true;
    state.render.showChartInfoHud = true;
    state.render.smoothBrightness = false;
    state.render.fixHudTextLayout = false;
    state.render.judgeEffectStyle = PreviewJudgeEffectStyle::Starry;
    state.render.centerDisplayMode = miacode::preview_gameplay::CenterDisplayMode::Combo;
    state.framePacingTargetFps = 60;
    QQuickWindow window;
    previewWindow = &window;
    QObject::connect(&window, &QQuickWindow::frameSwapped, &window, [] {
        ++presentedFrames;
        // Sync the retained node after the warm-up draw so the adapter can
        // block its idle subtree. window.update() alone need not sync an item.
        if (scene != nullptr && !miaview::firework::ready()) scene->update();
    });
    window.setFlags(Qt::Window | Qt::FramelessWindowHint);
    window.setColor(Qt::transparent);
    window.resize(renderSize);
    scene = new PreviewQuickSceneRoot(window.contentItem());
    hud = new PreviewQuickHudLayer(window.contentItem());
    scene->setSize(renderSize);
    hud->setSize(renderSize);
    hud->setZ(1);
    refresh();
    window.show();
    return app.exec();
}

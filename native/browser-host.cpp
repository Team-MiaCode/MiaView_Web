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
#include <QTemporaryFile>
#include <QBuffer>
#include <emscripten/emscripten.h>
#include "firework-layer.h"
#include "cover-scene.h"
#include "timeline-bridge.h"
#include "document-bridge.h"
#include "editor-bridge.h"
#include "touch-bridge.h"
#include "latency-bridge.h"
#include "preferences-bridge.h"
#include "appearance-bridge.h"
#include "export-bridge.h"
#include <optional>
#include "app/services/Id3TagReader.h"
#include "common/InputShortcutGesture.h"
#include "app/runtime/latency/LatencyTestChartBuilder.h"
#include "audio/PreviewAudioSettings.h"
#include <QQmlExtensionPlugin>
#include <QPointer>
#include "preview/quick_scene/PreviewQuickSceneRoot.h"
#include "preview/quick_scene/PreviewQuickHudLayer.h"
#include "preview/runtime/PreviewSceneAssetLoader.h"
#include "core/chart/document/SimaiDocument.h"
#include "core/chart/parser/SimaiParser.h"
#include "core/scene/PreviewFrameState.h"
#include "core/scene/PreviewSceneGeometry.h"
#include "core/scene/PreviewSfxTimeline.h"
#include "core/scene/PreviewSfxAssets.h"
#include "core/chart/model/TimelineMarkerOffset.h"
#include "core/analysis/MuriAnalyzer.h"
#include "core/analysis/MuriPanelEntries.h"
#include "core/analysis/MuriStaticChecker.h"
#include "core/video/AssetPaths.h"

using namespace miacode::preview::scene;
Q_IMPORT_QML_PLUGIN(MiaCode_PreviewPlugin)
EM_JS(void, publishCoverChange, (const char* data), {
    Module.onCoverChanged?.(UTF8ToString(data));
});
EM_JS(void, publishCoverPlayback, (const char* data), {
    Module.onCoverPlaybackChanged?.(UTF8ToString(data));
});
EM_JS(void, publishExportFrame, (), {
    Module.onExportFrame?.();
});
namespace {
PreviewFrameState state;
WebExportScene* exportScene = nullptr;
std::optional<PreviewFrameState> exportSavedState;
bool exportFramePending = false;
bool exportSavedPlaying = false;
bool exportSavedSceneVisible = true, exportSavedHudVisible = true, exportSavedCoverVisible = false;
PreviewQuickSceneRoot* scene = nullptr;
PreviewQuickHudLayer* hud = nullptr;
QQuickWindow* previewWindow = nullptr;
QPointer<WebCoverScene> coverScene;
QSize renderSize(1920, 1080);
QByteArray response;
QString skinDirectoryName = QStringLiteral("skinDX"), customOutlineFileName, effectiveOutlinePath;
miacode::preview::runtime::PreviewOutlineImageMode effectiveOutlineImageMode = miacode::preview::runtime::PreviewOutlineImageMode::Direct;
double presentedFrames = 0;
MuriAnalysisReport cachedAnalysis;
bool analysisReady = false;
quint64 analysisRevision = 0;
QElapsedTimer hudUpdateClock;
constexpr qint64 kHudUpdateIntervalMs = 100;
// Only the active chart/difficulty is retained. Markers and stats already live
// in state; do not accumulate a second set of timelines for visited charts.
WebDocument editorDocument;
WebEditor editor;
WebTouchInput touchInput(state);
WebLatency latency;
PreviewAudioSettings audioSettings;
struct AudioChannel {
    const char* key;
    int (PreviewAudioSettings::*percent)() const;
    bool (PreviewAudioSettings::*muted)() const;
    void (PreviewAudioSettings::*setPercent)(int);
    void (PreviewAudioSettings::*toggleMuted)();
};
const AudioChannel audioChannels[] = {
    {"global", &PreviewAudioSettings::globalPercent, &PreviewAudioSettings::globalMuted, &PreviewAudioSettings::setGlobalPercent, &PreviewAudioSettings::toggleGlobalMuted},
    {"track", &PreviewAudioSettings::trackPercent, &PreviewAudioSettings::trackMuted, &PreviewAudioSettings::setTrackPercent, &PreviewAudioSettings::toggleTrackMuted},
    {"answer", &PreviewAudioSettings::answerPercent, &PreviewAudioSettings::answerMuted, &PreviewAudioSettings::setAnswerPercent, &PreviewAudioSettings::toggleAnswerMuted},
    {"tap", &PreviewAudioSettings::tapPercent, &PreviewAudioSettings::tapMuted, &PreviewAudioSettings::setTapPercent, &PreviewAudioSettings::toggleTapMuted},
    {"ex", &PreviewAudioSettings::exPercent, &PreviewAudioSettings::exMuted, &PreviewAudioSettings::setExPercent, &PreviewAudioSettings::toggleExMuted},
    {"break", &PreviewAudioSettings::breakPercent, &PreviewAudioSettings::breakMuted, &PreviewAudioSettings::setBreakPercent, &PreviewAudioSettings::toggleBreakMuted},
    {"breakSlide", &PreviewAudioSettings::breakSlidePercent, &PreviewAudioSettings::breakSlideMuted, &PreviewAudioSettings::setBreakSlidePercent, &PreviewAudioSettings::toggleBreakSlideMuted},
    {"slide", &PreviewAudioSettings::slidePercent, &PreviewAudioSettings::slideMuted, &PreviewAudioSettings::setSlidePercent, &PreviewAudioSettings::toggleSlideMuted},
    {"touch", &PreviewAudioSettings::touchPercent, &PreviewAudioSettings::touchMuted, &PreviewAudioSettings::setTouchPercent, &PreviewAudioSettings::toggleTouchMuted},
    {"firework", &PreviewAudioSettings::fireworkPercent, &PreviewAudioSettings::fireworkMuted, &PreviewAudioSettings::setFireworkPercent, &PreviewAudioSettings::toggleFireworkMuted},
    {"intro", &PreviewAudioSettings::introPercent, &PreviewAudioSettings::introMuted, &PreviewAudioSettings::setIntroPercent, &PreviewAudioSettings::toggleIntroMuted},
};
QJsonObject audioSnapshot() {
    QJsonObject channels, gains;
    for (const auto& channel : audioChannels) channels.insert(channel.key, QJsonObject{
        {"percent", (audioSettings.*channel.percent)()}, {"muted", (audioSettings.*channel.muted)()}});
    for (const char* kind : {"answer", "judge", "judge_break", "break_touch", "break", "break_slide",
         "break_slide_start", "break_slide_finish", "break_slide_tail_break", "judge_break_slide", "slide", "ex",
         "touch", "touchhold", "firework", "clock", "track_start"})
        gains.insert(kind, previewSfxVolumeForKind(audioSettings, QString::fromLatin1(kind)));
    gains.insert("track", previewTrackVolume(audioSettings));
    return {{"channels", channels}, {"gains", gains}, {"settings", audioSettings.toJson()},
        {"breakSlideTailCheerMuted", audioSettings.breakSlideTailCheerMuted}};
}
bool chartLoaded = false;
bool previewPlaying = false;
bool forceLabeledWhenPaused = false;
bool pauseDisplayAltHoldActive = false;
bool touchPadAuthoringShortcut = false;
bool touchPadAuthoringContext = false;
PreviewOutlineVariant selectedOutline = PreviewOutlineVariant::Line;
PreviewOutlineVariant effectiveOutline = PreviewOutlineVariant::Line;
QByteArray cachedEditorAnalysis;
quint64 editorAnalysisGeneration = 0, editorAnalysisRevision = 0;
QString editorAnalysisLanguage;
int loadedDifficulty = 0;
quint64 renderedRevision = 0;
QByteArray cachedLoadResponse;
WebTimeline timeline;
QJsonObject sceneAudioData() {
    QVector<miacode::preview_sfx_timeline::Event> events;
    QVector<miacode::preview_sfx_timeline::TouchholdSpan> spans;
    miacode::preview_sfx_timeline::buildTimeline(state.noteMarkers, 1.0, PreviewTimingSettings(), &events, &spans);
    QJsonArray playbacks, mutedTailPlaybacks, sustains;
    QHash<QString, QString> sfxFileNames;
    const auto appendPlaybacks = [&](bool muteTail, QJsonArray& result) {
        for (const auto& item : miacode::preview_sfx_timeline::buildScheduledPlaybacks(events, muteTail)) {
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
            result.append(QJsonObject{{"second", item.second}, {"kind", item.kind}, {"file", file},
                {"gain", item.gain},
                {"nextSameKindSecond", qIsFinite(item.nextSameKindSecond) ? item.nextSameKindSecond : -1.0}});
        }
    };
    appendPlaybacks(false, playbacks);
    appendPlaybacks(true, mutedTailPlaybacks);
    for (const auto& span : miacode::preview_sfx_timeline::buildTouchholdOwnershipSegments(spans)) {
        sustains.append(QJsonObject{{"startSecond", span.startSecond}, {"endSecond", span.endSecond},
            {"sourceOffsetSecond", span.sourceOffsetSecond}});
    }
    return {{"sfx", playbacks}, {"sfxMutedTail", mutedTailPlaybacks}, {"touchholdSegments", sustains}};
}
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
        {"layoutSquareScale", state.render.layoutSquareScale}, {"scaleMode", int(state.render.backgroundScaleMode)},
        {"smoothBrightness", state.render.smoothBrightness}, {"showTimestamp", state.render.showTimestamp},
        {"showDebugInfo", state.render.showDebugInfo}, {"showChartInfoHud", state.render.showChartInfoHud},
        {"showObjectStatsHud", state.render.showObjectStatsHud}, {"centerDisplay", int(state.render.centerDisplayMode)},
        {"tapJudgeTextDistance", int(state.render.tapJudgeTextDistance)}, {"skinJudgeEffectIndex", int(state.render.judgeEffectStyle)},
        {"outlineIndex", int(selectedOutline)}, {"touchPadAuthoringShortcut", touchPadAuthoringShortcut},
        {"touchPadAuthoringContext", touchPadAuthoringContext},
        {"forceLabeledJudgeLineWhenPaused", forceLabeledWhenPaused},
        {"pauseDisplayAltHoldActive", pauseDisplayAltHoldActive},
        {"hudFontPaths", webHudFontPaths(state.hudFontSettings)},
        {"judgeEffectSlide", state.muriRenderOptions.showChartReviewSlideJudgeOverlay},
        {"judgeEffectTap", state.muriRenderOptions.showChartReviewTapJudgeOverlay},
        {"judgeEffectBreak", state.muriRenderOptions.showChartReviewBreakJudgeOverlay},
        {"judgeEffectTouch", state.muriRenderOptions.showChartReviewTouchJudgeOverlay},
        {"noteSkin", skinDirectoryName == "skinSD" ? "SD" : "DX"},
        {"skinDirectoryName", skinDirectoryName}, {"customOutlineFileName", customOutlineFileName},
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
void applyPausedOutline() {
    const auto outline = (forceLabeledWhenPaused != pauseDisplayAltHoldActive) && !previewPlaying ? PreviewOutlineVariant::JudgeAreaLabeled : selectedOutline;
    const auto path = miacode::assets::customOutlinePathForFileName(customOutlineFileName);
    const auto mode = !previewPlaying && (forceLabeledWhenPaused != pauseDisplayAltHoldActive) && !path.isEmpty()
        ? miacode::preview::runtime::PreviewOutlineImageMode::PausedJudgeAreaComposite
        : miacode::preview::runtime::PreviewOutlineImageMode::Direct;
    if (outline == effectiveOutline && path == effectiveOutlinePath && mode == effectiveOutlineImageMode) return;
    state.assets = miacode::preview::runtime::PreviewSceneAssetLoader::loadAssetState(outline, path, mode);
    effectiveOutline = outline; effectiveOutlinePath = path; effectiveOutlineImageMode = mode;
    ++state.sceneContentRevision;
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
void ensureCoverScene() {
    if (!coverScene) {
        coverScene = new WebCoverScene(previewWindow->contentItem());
        QObject::connect(coverScene, &WebCoverScene::compositionChanged, coverScene, [](const QJsonObject& changed) {
            const auto bytes = QJsonDocument(changed).toJson(QJsonDocument::Compact);
            publishCoverChange(bytes.constData());
        });
        QObject::connect(coverScene, &WebCoverScene::playbackChanged, coverScene, [](const QJsonObject& changed) {
            const auto bytes = QJsonDocument(changed).toJson(QJsonDocument::Compact);
            publishCoverPlayback(bytes.constData());
        });
    }
}

}

extern "C" {
EMSCRIPTEN_KEEPALIVE const char* miacode_export_asset(const char* kind, const char* name, const unsigned char* data, int count) {
    if (!exportScene || !data || count <= 0) return json({{"error", "Export asset is empty"}});
    return json(exportScene->storeAsset(QString::fromUtf8(kind), QString::fromUtf8(name), QByteArray(reinterpret_cast<const char*>(data), count)));
}
EMSCRIPTEN_KEEPALIVE const char* miacode_export_prepare(const char* source) {
    if (!chartLoaded || !exportScene) return json({{"error", "Load a chart before exporting"}});
    if (exportSavedState) return json({{"error", "An export is running"}});
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!request.isObject()) return json({{"error", "Export settings must be an object"}});
    const auto plan = exportScene->configure(request.object(), state, editorDocument.snapshot(), audioSettings);
    if (!plan.contains("error")) {
        exportSavedState = state;
        exportSavedPlaying = previewPlaying;
        exportSavedSceneVisible = scene->isVisible();
        exportSavedHudVisible = hud->isVisible();
        exportSavedCoverVisible = coverScene && coverScene->isVisible();
        if (coverScene) coverScene->setVisible(false);
        scene->setVisible(true);
        hud->setVisible(true);
        previewPlaying = true;
        applyPausedOutline();
    }
    return json(plan);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_export_frame(int index) {
    if (!exportSavedState) return json({{"error", "Prepare an export before rendering"}});
    const auto result = exportScene->frame(index, state);
    if (!result.contains("error")) {
        scene->setVisible(result.value("chartVisible").toBool());
        exportFramePending = true;
        refresh();
        previewWindow->update();
    }
    return json(result);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_export_reconfigure(const char* source) {
    if (!exportSavedState) return json({{"error", "Prepare the scene before changing its intro"}});
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!request.isObject()) return json({{"error", "Intro settings must be an object"}});
    return json(exportScene->configure(request.object(), *exportSavedState, editorDocument.snapshot(), audioSettings));
}
EMSCRIPTEN_KEEPALIVE void miacode_export_still(int still) {
    if (!exportSavedState) return;
    exportScene->setStillFrame(still != 0);
    previewWindow->update();
}
EMSCRIPTEN_KEEPALIVE const char* miacode_export_frame_info(int index) {
    if (!exportSavedState) return json({{"error", "Prepare an export before reading frames"}});
    return json(exportScene->frameInfo(index));
}
EMSCRIPTEN_KEEPALIVE void miacode_export_finish() {
    exportFramePending = false;
    if (exportScene) exportScene->finish();
    if (!exportSavedState) return;
    state = std::move(*exportSavedState);
    exportSavedState.reset();
    previewPlaying = exportSavedPlaying;
    applyPausedOutline();
    scene->setVisible(exportSavedSceneVisible);
    hud->setVisible(exportSavedHudVisible);
    if (coverScene) coverScene->setVisible(exportSavedCoverVisible);
    refresh();
    previewWindow->update();
}
EMSCRIPTEN_KEEPALIVE const char* miacode_audio_command(const char* source) {
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!request.isObject()) return json({{"error", "Audio command must be an object"}});
    const auto object = request.object();
    const auto id = object.value("id").toString();
    const auto args = object.value("args").toObject();
    if (id == "audio.restoreSettings") {
        const auto settings = args.value("settings");
        if (!settings.isObject()) return json({{"error", "Audio settings must be an object"}});
        const auto values = settings.toObject();
        const auto defaults = audioSettings.toJson();
        for (auto value = values.begin(); value != values.end(); ++value) {
            if (!defaults.contains(value.key())) return json({{"error", "Unknown audio setting: " + value.key()}});
            if (defaults.value(value.key()).isBool()) {
                if (!value.value().isBool()) return json({{"error", "Audio flag must be a boolean"}});
            } else if (!value.value().isDouble() || !qIsFinite(value.value().toDouble())
                || value.value().toDouble() < 0 || value.value().toDouble() > 1)
                return json({{"error", "Audio volume must be between 0 and 1"}});
        }
        audioSettings = PreviewAudioSettings::fromJson(values);
    } else if (id == "audio.breakSlideTailCheerMuted") {
        if (!args.value("value").isBool()) return json({{"error", "Tail cheer mute must be a boolean"}});
        audioSettings.breakSlideTailCheerMuted = args.value("value").toBool();
    } else if (id == "audio.channelPercent" || id == "audio.channelMuted") {
        const auto key = args.value("key").toString();
        const AudioChannel* selected = nullptr;
        for (const auto& channel : audioChannels) if (key == QLatin1String(channel.key)) { selected = &channel; break; }
        if (!selected) return json({{"error", "Unknown audio channel: " + key}});
        if (id == "audio.channelPercent") {
            const auto percent = args.value("percent");
            const double value = percent.toDouble(-1);
            if (!percent.isDouble() || !qIsFinite(value) || value < 0 || value > 100 || value != qRound(value))
                return json({{"error", "Audio percent must be an integer between 0 and 100"}});
            (audioSettings.*selected->setPercent)(qRound(value));
        } else {
            if (!args.value("muted").isBool()) return json({{"error", "Audio mute must be a boolean"}});
            if ((audioSettings.*selected->muted)() != args.value("muted").toBool())
                (audioSettings.*selected->toggleMuted)();
        }
    } else if (id != "audio.getSettings") return json({{"error", "Unknown audio command: " + id}});
    return json(audioSnapshot());
}
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
EMSCRIPTEN_KEEPALIVE const char* miacode_appearance_image(const char* source, const unsigned char* data, int count) {
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!request.isObject() || !data || count <= 0) return json({{"error", "请选择外观素材"}});
    return json(webImportAppearanceImage(request.object(), QByteArray(reinterpret_cast<const char*>(data), count)));
}
EMSCRIPTEN_KEEPALIVE const char* miacode_appearance_skin(const char* operation, const char* name) {
    return json(webSkinImport(QString::fromUtf8(operation), QString::fromUtf8(name)));
}
EMSCRIPTEN_KEEPALIVE const char* miacode_settings() {
    return json(settings());
}
EMSCRIPTEN_KEEPALIVE const char* miacode_set_settings(const char* source) {
    using namespace miacode::preview_gameplay;
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!request.isObject()) return json({{"error", "预览设置必须为对象"}});
    auto values = settings();
    auto hudFonts = state.hudFontSettings;
    const QHash<QString, QPair<double, double>> ranges{
        {"outerBrightness", {0, 1}}, {"innerBrightness", {0, 1}},
        {"tapFlowSpeed", {kPreviewTimingFlowSpeedMin, kPreviewTimingFlowSpeedMax}},
        {"touchFlowSpeed", {kPreviewTimingFlowSpeedMin, kPreviewTimingFlowSpeedMax}}, {"layoutSquareScale", {.5, 1}},
        {"scaleMode", {0, 3}}, {"outlineIndex", {0, 3}}, {"centerDisplay", {0, 7}},
        {"tapJudgeTextDistance", {0, 2}}, {"skinJudgeEffectIndex", {0, 1}}};
    const auto supplied = request.object();
    for (auto it = supplied.begin(); it != supplied.end(); ++it) {
        if (!values.contains(it.key())) return json({{"error", "未知预览设置：" + it.key()}});
        if (it.key() == "hudFontPaths") {
            QString error;
            if (!it.value().isObject() || !webSetHudFontPaths(it.value().toObject(), hudFonts, error))
                return json({{"error", error.isEmpty() ? QStringLiteral("HUD 字体设置需要对象") : error}});
            values.insert(it.key(), webHudFontPaths(hudFonts));
            continue;
        }
        const auto value = it.value();
        const auto current = values.value(it.key());
        bool valid = current.isBool() ? value.isBool() : value.type() == current.type();
        if (current.isDouble()) {
            const auto bounds = ranges.value(it.key());
            const double number = value.toDouble(-1);
            valid = valid && qIsFinite(number) && number >= bounds.first && number <= bounds.second;
            if (it.key() != "outerBrightness" && it.key() != "innerBrightness" && it.key() != "layoutSquareScale"
                && it.key() != "tapFlowSpeed" && it.key() != "touchFlowSpeed") valid = valid && number == int(number);
        }
        if (it.key() == "noteSkin") valid = value.isString() && (value.toString() == "SD" || value.toString() == "DX");
        if (it.key() == "previewMode") valid = value.isString() && (value.toString() == "native" || value.toString() == "maimuri_dx_style" || value.toString() == "erase_by_area");
        if (!valid) return json({{"error", "预览设置无效：" + it.key()}});
        values.insert(it.key(), value);
    }
    const auto nextSkin = supplied.contains("skinDirectoryName") ? values.value("skinDirectoryName").toString()
        : supplied.contains("noteSkin") ? (values.value("noteSkin").toString() == "SD" ? QStringLiteral("skinSD") : QStringLiteral("skinDX")) : skinDirectoryName;
    const auto skinPath = webSkinDirectory(nextSkin);
    if (skinPath.isEmpty()) return json({{"error", "皮肤目录无效"}});
    const auto nextOutline = supplied.contains("customOutlineFileName") ? values.value("customOutlineFileName").toString()
        : supplied.contains("outlineIndex") ? QString() : customOutlineFileName;
    if (!nextOutline.isEmpty() && miacode::assets::customOutlinePathForFileName(nextOutline).isEmpty()) return json({{"error", "请导入所选判定线"}});
    if (skinDirectoryName != nextSkin) {
        const auto loaded = miacode::preview::runtime::PreviewSceneAssetLoader::load(skinPath, PreviewOutlineVariant::Line);
        if (loaded.skinAssets.tapImage.isNull()) return json({{"error", "皮肤目录需要 tap.png"}});
        state.skin = loaded.skinAssets; state.judgeOverlay = loaded.judgeOverlayAssets; state.judgeEffect = loaded.judgeEffectAssets;
        skinDirectoryName = nextSkin;
        ++state.sceneContentRevision;
    }
    customOutlineFileName = nextOutline;
    state.render.backgroundBrightnessOuter = values.value("outerBrightness").toDouble();
    state.render.backgroundBrightnessInner = values.value("innerBrightness").toDouble();
    state.render.tapFlowSpeed = normalizePreviewTimingFlowSpeed(values.value("tapFlowSpeed").toDouble());
    state.render.touchFlowSpeed = normalizePreviewTimingFlowSpeed(values.value("touchFlowSpeed").toDouble());
    state.render.slideEarlierSecondAndTextOnTop = values.value("earlierSlideOnTop").toBool();
    state.render.layoutSquareScale = miacode::preview_video::normalizedLayoutSquareScale(values.value("layoutSquareScale").toDouble());
    state.render.backgroundScaleMode = static_cast<PreviewBackgroundScaleMode>(values.value("scaleMode").toInt());
    state.render.smoothBrightness = values.value("smoothBrightness").toBool();
    state.render.showTimestamp = values.value("showTimestamp").toBool();
    state.render.showDebugInfo = values.value("showDebugInfo").toBool();
    state.render.showChartInfoHud = values.value("showChartInfoHud").toBool();
    state.render.showObjectStatsHud = values.value("showObjectStatsHud").toBool();
    state.render.centerDisplayMode = static_cast<CenterDisplayMode>(values.value("centerDisplay").toInt());
    state.render.tapJudgeTextDistance = static_cast<PreviewTapJudgeTextDistance>(values.value("tapJudgeTextDistance").toInt());
    state.render.judgeEffectStyle = static_cast<PreviewJudgeEffectStyle>(values.value("skinJudgeEffectIndex").toInt());
    state.muriRenderOptions.showChartReviewSlideJudgeOverlay = values.value("judgeEffectSlide").toBool();
    state.muriRenderOptions.showChartReviewTapJudgeOverlay = values.value("judgeEffectTap").toBool();
    state.muriRenderOptions.showChartReviewBreakJudgeOverlay = values.value("judgeEffectBreak").toBool();
    state.muriRenderOptions.showChartReviewTouchJudgeOverlay = values.value("judgeEffectTouch").toBool();
    selectedOutline = static_cast<PreviewOutlineVariant>(values.value("outlineIndex").toInt());
    forceLabeledWhenPaused = values.value("forceLabeledJudgeLineWhenPaused").toBool();
    state.hudFontSettings = hudFonts;
    pauseDisplayAltHoldActive = values.value("pauseDisplayAltHoldActive").toBool();
    touchPadAuthoringShortcut = values.value("touchPadAuthoringShortcut").toBool();
    touchPadAuthoringContext = values.value("touchPadAuthoringContext").toBool();
    if (!touchPadAuthoringShortcut || !touchPadAuthoringContext) touchInput.reset();
    applyPausedOutline();
    const auto mode = muriRenderModeFromToken(values.value("previewMode").toString());
    if (state.muriRenderOptions.renderMode != mode) applyRenderMode(mode);
    ++state.sceneContentRevision;
    refresh();
    return json(settings());
}
EMSCRIPTEN_KEEPALIVE void miacode_set_playing(int playing) {
    previewPlaying = playing != 0;
    applyPausedOutline();
    refresh();
}
EMSCRIPTEN_KEEPALIVE const char* miacode_touch_pointer(const char* source) {
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    const auto identity = editorDocument.workspace.snapshot();
    auto result = touchInput.pointer(request.object(), renderSize,
        touchPadAuthoringShortcut && touchPadAuthoringContext && identity.hasDocument && identity.activeDifficultyId > 0,
        identity.documentOpenGeneration, identity.activeDifficultyId);
    if (result.value("changed").toBool()) { ++state.sceneContentRevision; refresh(false); }
    if (result.contains("action")) {
        result.insert("documentOpenGeneration", double(identity.documentOpenGeneration));
        result.insert("difficulty", identity.activeDifficultyId);
    }
    return json(result);
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
    QJsonArray charts;
    for (const int id : ids) charts.append(QJsonObject{{"id", id}, {"label", SimaiDocument::difficultyShortName(id) + " " + doc.difficulty(id)->level}});
    double duration = qMax(0.0, parsed.durationSeconds + first);
    for (const auto& marker : state.noteMarkers) duration = qMax(duration, qMax(marker.second, marker.endSecond) + 2.0);
    refresh();
    auto data = sceneAudioData();
    data.insert("title", doc.title); data.insert("artist", doc.artist); data.insert("difficultyId", difficultyId);
    data.insert("duration", duration); data.insert("noteCount", state.noteMarkers.size()); data.insert("charts", charts);
    json(data);
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
EMSCRIPTEN_KEEPALIVE const char* miacode_editor_command(const char* source) {
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!request.isObject()) return json({{"error", "Editor command must be an object"}});
    const auto state = editorDocument.workspace.snapshot();
    return json(editor.command(request.object(), state.activeDifficultyId, state.documentOpenGeneration));
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
EMSCRIPTEN_KEEPALIVE const char* miacode_analysis(const char* language) {
    const auto identity = editorDocument.workspace.snapshot();
    const QString localeToken = QString::fromUtf8(language);
    if (!cachedEditorAnalysis.isEmpty() && identity.documentOpenGeneration == editorAnalysisGeneration
        && identity.revision == editorAnalysisRevision && localeToken == editorAnalysisLanguage)
        return cachedEditorAnalysis.constData();
    const auto& doc = editorDocument.workspace.document();
    const auto* difficulty = doc.difficulty(identity.activeDifficultyId);
    QJsonArray validationRows, muriRows;
    int errors = 0, warnings = 0;
    const auto locale = localeToken.startsWith("zh") ? SimaiValidationLocale::Chinese
        : localeToken.startsWith("ja") ? SimaiValidationLocale::Japanese : SimaiValidationLocale::English;
    if (identity.hasDocument && difficulty) {
        const auto timing = miacode::simai::buildTimingMetadata(doc);
        const auto parsed = SimaiParser::parseForTimeline(difficulty->chart, timing);
        const auto validation = SimaiParser::buildValidationReport(difficulty->chart, locale, &parsed, timing);
        errors = validation.errorCount;
        warnings = validation.warningCount;
        for (const auto& issue : validation.issues) {
            validationRows.append(QJsonObject{{"line", issue.line}, {"column", issue.col}, {"endColumn", issue.endCol},
                {"second", -1}, {"severity", issue.severity == SimaiValidationSeverity::Warning ? "warning" : "error"},
                {"detail", issue.displayMessage}, {"difficultyId", identity.activeDifficultyId},
                {"revision", double(identity.revision)}, {"documentOpenGeneration", double(identity.documentOpenGeneration)}});
        }
        if (parsed.ok) {
            bool firstOk = false;
            const double first = miacode::timeline::offset::parsedFirstSeconds(doc.first, &firstOk);
            if (firstOk && qIsFinite(first)) {
                const auto markers = miacode::timeline::offset::shiftedNoteMarkers(parsed.noteMarkers, first,
                    miacode::timeline::offset::NonFiniteHandling::Propagate);
                const auto report = analysisReady ? cachedAnalysis : MuriAnalyzer::analyze(markers, state.muriRenderOptions);
                const auto references = miacode::muri::buildStaticMuriReferences(markers,
                    miacode::muri::kStaticTapOnSlideThresholdDefaultMs / 1000.0);
                for (const auto& entry : miacode::muri::buildVisibleMuriPanelEntries(report, references)) {
                    const bool warning = entry.alertLevel == MuriAlertLevel::Warning;
                    QString detail = renderMuriDetail(entry.detailKind, entry.detailArgs, locale).trimmed();
                    if (detail.isEmpty()) detail = entry.rawDetail;
                    muriRows.append(QJsonObject{{"line", qMax(1, entry.line)}, {"column", qMax(1, entry.col)},
                        {"endColumn", qMax(1, entry.col)}, {"second", entry.second}, {"severity", warning ? "warning" : "error"},
                        {"alert", warning ? "warning" : "muri"}, {"title", muriKindDisplayName(entry.kind, locale == SimaiValidationLocale::Chinese)},
                        {"detail", detail}, {"difficultyId", identity.activeDifficultyId}, {"revision", double(identity.revision)},
                        {"documentOpenGeneration", double(identity.documentOpenGeneration)}});
                }
            }
        }
    }
    const QJsonObject result{{"available", identity.hasDocument && difficulty != nullptr}, {"pending", false},
        {"revision", double(identity.revision)}, {"documentOpenGeneration", double(identity.documentOpenGeneration)},
        {"difficultyId", identity.activeDifficultyId}, {"validationRows", validationRows}, {"muriRows", muriRows},
        {"syntaxErrorCount", errors}, {"syntaxWarningCount", warnings}};
    cachedEditorAnalysis = QJsonDocument(result).toJson(QJsonDocument::Compact);
    editorAnalysisGeneration = identity.documentOpenGeneration;
    editorAnalysisRevision = identity.revision;
    editorAnalysisLanguage = localeToken;
    return cachedEditorAnalysis.constData();
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
    ensureCoverScene();
    const auto result = coverScene->configure(composition);
    if (result.contains("error")) return json(result);
    previewWindow->resize(QSize(int(width), int(height)));
    coverScene->setOutputSize(QSize(int(width), int(height)));
    coverScene->setVisible(true);
    scene->setVisible(false);
    hud->setVisible(false);
    return json(coverScene->snapshot());
}
EMSCRIPTEN_KEEPALIVE const char* miacode_cover_chart(double duration) {
    if (!chartLoaded || !qIsFinite(duration) || duration < 0) return json({{"error", "请载入封面谱面"}});
    ensureCoverScene();
    auto frame = state;
    frame.assets = miacode::preview::runtime::PreviewSceneAssetLoader::loadAssetState(
        selectedOutline, miacode::assets::customOutlinePathForFileName(customOutlineFileName));
    coverScene->setChartState(frame, duration);
    return json(coverScene->snapshot());
}
EMSCRIPTEN_KEEPALIVE const char* miacode_cover_state() {
    return json(coverScene ? coverScene->snapshot() : QJsonObject());
}
EMSCRIPTEN_KEEPALIVE const char* miacode_cover_command(const char* source) {
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!coverScene || !request.isObject()) return json({{"error", "请打开封面编辑器"}});
    const auto value = request.object();
    if (!value.value("id").isString() || !value.value("args").isObject())
        return json({{"error", "封面命令参数无效"}});
    const auto result = coverScene->command(value.value("id").toString(), value.value("args").toObject());
    if (!result.contains("error")) previewWindow->resize(coverScene->outputSize());
    return json(result);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_cover_image(const unsigned char* data, int size) {
    return json(webImportCoverImage(QByteArray(reinterpret_cast<const char*>(data), size)));
}
EMSCRIPTEN_KEEPALIVE int miacode_cover_pv_frame(const char* key, const unsigned char* data, int count, int width, int height, double seconds) {
    if (!coverScene) return 0;
    if (!data && count == 0) return coverScene->setPvFrame(QString(), QImage(), 0);
    if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || count != width * height * 4 || !qIsFinite(seconds)) return 0;
    const QImage image(data, width, height, width * 4, QImage::Format_RGBA8888);
    return coverScene->setPvFrame(QString::fromUtf8(key), image.copy(), seconds);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_cover_capture(int clean) {
    if (!coverScene || !coverScene->isVisible()) return json({{"error", "请打开封面编辑器"}});
    coverScene->setEditable(!clean);
    if (clean) exportFramePending = true;
    previewWindow->update();
    return json(coverScene->snapshot());
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
EMSCRIPTEN_KEEPALIVE const char* miacode_background_settings(const char* source) {
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!request.isObject()) return json({{"error", "应用背景设置需要对象"}});
    return json(webBackgroundSettings(request.object()));
}
EMSCRIPTEN_KEEPALIVE const char* miacode_import_font(const char* bytes, int count, const char* name) {
    return json(webImportFont(QByteArray(bytes, count), QString::fromUtf8(name)));
}
EMSCRIPTEN_KEEPALIVE const char* miacode_shortcuts(const char* source) {
    const auto input = QJsonDocument::fromJson(QByteArray(source));
    if (!input.isObject()) return json({{"error", "快捷键配置需要对象"}});
    QJsonObject result;
    const auto shortcuts = input.object();
    for (auto item = shortcuts.begin(); item != shortcuts.end(); ++item) {
        if (!item.value().isString()) return json({{"error", "快捷键需要字符串"}});
        const auto text = item.value().toString().trimmed();
        const auto gesture = miacode::input_shortcut::parseGesture(text);
        if (!text.isEmpty() && !gesture.isValid()) return json({{"error", QStringLiteral("快捷键无效：%1").arg(text)}});
        QJsonObject binding{{"canonicalText", gesture.canonicalText},
            {"displayText", miacode::input_shortcut::gestureDisplayText(gesture.canonicalText)},
            {"modifiers", int(gesture.modifiers)}, {"key", 0}, {"wheelDirection", 0}};
        if (gesture.isWheel()) binding.insert("wheelDirection", gesture.wheelDirection == miacode::input_shortcut::WheelDirection::Up ? -1 : 1);
        else if (!gesture.keySequence.isEmpty()) {
            if (gesture.keySequence.count() != 1) return json({{"error", "请录制一个组合键"}});
            const auto key = gesture.keySequence[0];
            binding.insert("key", int(key.key())); binding.insert("modifiers", int(key.keyboardModifiers()));
        }
        result.insert(item.key(), binding);
    }
    return json(result);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_audio_info(const char* bytes, int count) {
    QTemporaryFile file;
    if (!file.open() || file.write(bytes, count) != count || !file.flush())
        return json({{"error", "音频标签读取失败"}});
    const auto tag = miacode::id3::readTagFromFile(file.fileName());
    QJsonObject result{{"valid", tag.valid}, {"title", tag.title.trimmed()},
        {"artist", tag.artist.trimmed()}, {"album", tag.album.trimmed()}};
    if (!tag.pictureBytes.isEmpty()) {
        QImage cover;
        QByteArray jpeg;
        QBuffer output(&jpeg);
        output.open(QIODevice::WriteOnly);
        if (cover.loadFromData(tag.pictureBytes) && cover.save(&output, "JPG"))
            result.insert("cover", QJsonObject{{"mimeType", "image/jpeg"}, {"base64", QString::fromLatin1(jpeg.toBase64())}});
        else result.insert("coverError", "内嵌封面解码失败");
    }
    return json(result);
}
EMSCRIPTEN_KEEPALIVE void miacode_latency_samples(const float* samples, int count, int rate) {
    latency.setSamples(samples, count, rate);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_latency_detect(const char* source) {
    const auto request = QJsonDocument::fromJson(QByteArray(source));
    if (!request.isObject()) return json({{"error", "Latency request must be an object"}});
    return json(latency.detect(request.object()));
}
EMSCRIPTEN_KEEPALIVE const char* miacode_latency_scene(const char* source) {
    const auto request = QJsonDocument::fromJson(QByteArray(source)).object();
    if (!request.value("onPage").isBool()) return json({{"error", "Audition page state must be a boolean"}});
    if (!request.value("onPage").toBool()) {
        chartLoaded = false;
        return renderDocument(editorDocument.workspace.snapshot().activeDifficultyId, false);
    }
    const double bpm = request.value("bpm").toDouble(), offset = request.value("offsetSeconds").toDouble();
    const double duration = request.value("duration").toDouble();
    const int subdivision = request.value("subdivision").toInt();
    if (!qIsFinite(bpm) || bpm <= 0 || !qIsFinite(offset) || !qIsFinite(duration) || duration < 0
        || (subdivision != 4 && subdivision != 8 && subdivision != 16)) return json({{"error", "Invalid audition parameters"}});
    const auto text = miacode::latency::buildTestChartText(bpm, subdivision, duration);
    const auto parsed = SimaiParser::parseForTimeline(text);
    if (!parsed.ok) return json({{"error", "试听谱面解析失败"}});
    state.noteMarkers = miacode::timeline::offset::shiftedNoteMarkers(parsed.noteMarkers, offset,
        miacode::timeline::offset::NonFiniteHandling::Propagate);
    cachedAnalysis = {}; analysisReady = false;
    applyRenderMode(state.muriRenderOptions.renderMode);
    auto stats = std::make_shared<PreviewProgressStatsCache>(); stats->rebuild(state.noteMarkers); state.progressStatsCache = stats;
    timeline.load(text, offset, miacode::simai::SimaiTimingMetadata());
    ++state.sceneContentRevision; chartLoaded = true; refresh();
    auto result = sceneAudioData();
    result.insert("duration", duration > 0 ? duration : 180); result.insert("noteCount", state.noteMarkers.size());
    result.insert("title", editorDocument.workspace.document().title); result.insert("artist", editorDocument.workspace.document().artist);
    result.insert("difficultyId", editorDocument.workspace.snapshot().activeDifficultyId); result.insert("charts", QJsonArray());
    return json(result);
}
EMSCRIPTEN_KEEPALIVE const char* miacode_latency_mix(int percent) {
    const auto mix = makePreviewLatencyAuditionLevels(audioSettings, percent);
    QJsonObject gains;
    for (const char* kind : {"answer", "judge", "judge_break", "break_touch", "break", "break_slide", "break_slide_start",
         "break_slide_finish", "break_slide_tail_break", "judge_break_slide", "slide", "ex", "touch", "touchhold", "firework", "clock", "track_start"})
        gains.insert(kind, previewSfxVolumeForKind(mix, QString::fromLatin1(kind)));
    gains.insert("track", previewTrackVolume(mix));
    return json(gains);
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
    static quint64 mediaSerial = 0;
    if (!data || size <= 0) {
        state.media = PreviewMediaFrameState();
    } else {
        const QImage image = QImage::fromData(data, size);
        if (image.isNull()) return 0;
        state.media = PreviewMediaFrameState();
        state.media.mediaFrame = image;
        state.media.resolvedStageImage = image;
        state.media.resolvedStageImageCacheable = true;
        state.media.stageMediaAvailable = true;
        state.media.stageMediaSerial = ++mediaSerial;
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
EMSCRIPTEN_KEEPALIVE const char* miacode_media_geometry(int width, int height) {
    const auto rectJson = [](const QRectF& rect) {
        return QJsonArray{rect.x(), rect.y(), rect.width(), rect.height()};
    };
    const QRectF stage = stageRectForSize(renderSize);
    const QSize source(width, height);
    const bool circle = state.render.backgroundScaleMode == PreviewBackgroundScaleMode::InnerCircleFitOuterFill;
    QJsonObject result{{"outer", rectJson(mediaPlacement(source, stage,
        circle ? PreviewBackgroundScaleMode::FillCrop : state.render.backgroundScaleMode).targetRect)}};
    if (circle) {
        const QRectF clip = playfieldRectForStage(stage, state.render.layoutSquareScale);
        result.insert("clip", rectJson(clip));
        result.insert("inner", rectJson(mediaPlacement(source, clip, PreviewBackgroundScaleMode::FitContain).targetRect));
    }
    return json(result);
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
        if (exportFramePending) {
            exportFramePending = false;
            publishExportFrame();
        }
        // Sync the retained node after the warm-up draw so the adapter can
        // block its idle subtree. window.update() alone need not sync an item.
        if (scene != nullptr && !miaview::firework::ready()) scene->update();
    });
    window.setFlags(Qt::Window | Qt::FramelessWindowHint);
    window.setColor(Qt::transparent);
    window.resize(renderSize);
    scene = new PreviewQuickSceneRoot(window.contentItem());
    hud = new PreviewQuickHudLayer(window.contentItem());
    WebExportScene exportRenderer(window.contentItem());
    exportScene = &exportRenderer;
    scene->setSize(renderSize);
    hud->setSize(renderSize);
    hud->setZ(1);
    refresh();
    window.show();
    return app.exec();
}

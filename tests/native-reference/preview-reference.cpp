#include "preview-reference.h"
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QDebug>
#include <QQuickRenderControl>
#include <QQuickWindow>
#include "core/chart/document/SimaiDocument.h"
#include "core/chart/model/TimelineMarkerOffset.h"
#include "core/chart/parser/SimaiParser.h"
#include "core/scene/PreviewFrameState.h"
#include "core/video/AssetPaths.h"
#include "core/analysis/MuriAnalyzer.h"
#include "preview/quick_scene/PreviewQuickSceneRoot.h"
#include "preview/quick_scene/PreviewQuickHudLayer.h"
#include "preview/runtime/PreviewSceneAssetLoader.h"

int captureSurface(QQuickWindow&, QQuickRenderControl&, const QSize&, const QString&);

int capturePreview(const QJsonObject& fixture, const QSize& size, const QString& path)
{
    using namespace miacode::preview::scene;
    using namespace miacode::timeline::offset;
    const auto document = SimaiDocument::fromText(fixture.value("sourceText").toString());
    const auto* difficulty = document.difficulty(fixture.value("difficultyId").toInt(5));
    if (!difficulty) { qCritical() << "Reference difficulty missing"; return 2; }
    const auto parsed = SimaiParser::parseForTimeline(difficulty->chart, miacode::simai::buildTimingMetadata(document));
    if (!parsed.ok) { for (const auto& error : parsed.errors) qCritical() << error.line << error.col << error.message; return 2; }
    miacode::assets::setAssetRoot(fixture.value("assetRoot").toString());
    const auto skin = fixture.value("assetRoot").toString() + "/skin/skin" + fixture.value("noteSkin").toString("DX");
    const auto assets = miacode::preview::runtime::PreviewSceneAssetLoader::load(skin, PreviewOutlineVariant::Line);
    PreviewFrameState state;
    state.assets = assets.assetState; state.skin = assets.skinAssets;
    state.judgeOverlay = assets.judgeOverlayAssets; state.judgeEffect = assets.judgeEffectAssets;
    state.noteMarkers = shiftedNoteMarkers(parsed.noteMarkers, parsedFirstSeconds(document.first), NonFiniteHandling::Propagate);
    state.render.layoutSquareScale = .95;
    state.render.tapFlowSpeed = 7.5; state.render.touchFlowSpeed = 8;
    const bool showHud = fixture.value("hud").toBool();
    state.render.showTimestamp = showHud; state.render.showChartInfoHud = showHud;
    state.render.showObjectStatsHud = showHud; state.render.showDebugInfo = false;
    state.render.smoothBrightness = false; state.render.fixHudTextLayout = false;
    state.render.centerDisplayMode = showHud ? miacode::preview_gameplay::CenterDisplayMode::Combo : miacode::preview_gameplay::CenterDisplayMode::Off;
    state.render.judgeEffectStyle = PreviewJudgeEffectStyle::Starry;
    state.playheadSeconds = fixture.value("currentTime").toDouble();
    state.chartTitle = document.title; state.chartArtist = document.artist;
    state.chartDesigner = difficulty->designer.isEmpty() ? document.designer : difficulty->designer;
    state.chartDifficultyLabel = SimaiDocument::difficultyShortName(fixture.value("difficultyId").toInt(5)) + " " + difficulty->level;
    state.framePacingTargetFps = 60;
    state.muriRenderOptions.renderMode = muriRenderModeFromToken(fixture.value("previewMode").toString("native"));
    if (state.muriRenderOptions.renderMode == RenderMode::MaimuriDxStyle)
        state.muriAnalysisReport = MuriAnalyzer::analyze(state.noteMarkers, state.muriRenderOptions);
    auto statistics = std::make_shared<PreviewProgressStatsCache>(); statistics->rebuild(state.noteMarkers);
    state.progressStatsCache = statistics; refreshPreviewFrameStateHudStatsSnapshot(state);
    ++state.sceneContentRevision;

    QQuickWindow::setGraphicsApi(QSGRendererInterface::Direct3D11);
    QQuickRenderControl control;
    QQuickWindow window(&control);
    window.setColor(Qt::transparent); window.setGeometry(0, 0, size.width(), size.height());
    PreviewQuickSceneRoot scene(window.contentItem()); scene.setSize(size); scene.setFrameState(&state);
    PreviewQuickHudLayer hud(window.contentItem()); hud.setSize(size); hud.setZ(1); hud.setFrameState(&state);
    const int captured = captureSurface(window, control, size, path);
    // Deliver windowChanged while the derived items and their window observers are alive.
    hud.setParentItem(nullptr); scene.setParentItem(nullptr);
    if (captured) { qCritical() << "Reference surface capture failed"; return captured; }
    const auto counts = statistics->snapshotAt(state.playheadSeconds);
    QJsonArray entries;
    const auto append = [&entries](const char* kind, int played, int total) {
        entries.append(QJsonObject{{"kind", QLatin1String(kind)}, {"played", played}, {"total", total}});
    };
    append("tap", counts.tapPlayed, counts.tapTotal); append("hold", counts.holdPlayed, counts.holdTotal);
    append("slide", counts.slidePlayed, counts.slideTotal); append("touch", counts.touchPlayed, counts.touchTotal);
    append("break", counts.breakPlayed, counts.breakTotal); append("total", counts.totalPlayed, counts.totalCount);
    QFile metadata(path + ".json");
    if (!metadata.open(QIODevice::WriteOnly)) return 2;
    metadata.write(QJsonDocument(QJsonObject{{"noteCount", state.noteMarkers.size()}, {"statistics", entries}}).toJson());
    scene.setFrameState(nullptr);
    hud.setFrameState(nullptr);
    return 0;
}

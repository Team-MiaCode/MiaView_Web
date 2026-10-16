import {
  createPreview,
  type MiaCodePreview,
  type ChartInput,
  type PreviewState,
} from "../sdk/index.mjs";
const chart: ChartInput = {
  maidata: "&inote_5=(120)1,E",
  audio: { url: "/track.mp3" },
  difficulty: 5,
};
const preview: MiaCodePreview = createPreview(document.createElement("div"), {
  resolution: { width: 720, height: 720 },
  maxFps: 120,
  theme: "light",
  layout: "fit",
});
void preview.setTheme("legacy_light");
// @ts-expect-error Only original theme tokens are accepted.
void preview.setTheme("system");
// @ts-expect-error Unknown layout modes are rejected.
createPreview(document.createElement("div"), { layout: "fluid" });
void preview.load(chart);
void preview.seek(1);
void preview.setSettings({ tapFlowSpeed: 8, noteSkin: "SD" });
void preview.setSettings({ previewMode: "maimuri_dx_style" });
// @ts-expect-error Unknown preview modes are rejected.
void preview.setSettings({ previewMode: "unknown" });
void preview.getState().then((state: PreviewState) => state.resolution.width);
void preview.getState().then((state: PreviewState) => state.maxFps);
createPreview(document.createElement("div"), { maxFps: "unlimited" });
// @ts-expect-error Unknown themes are rejected by the interface.
createPreview(document.createElement("div"), { theme: "system" });
// @ts-expect-error Numeric strings are not frame rates.
createPreview(document.createElement("div"), { maxFps: "120" });
preview.on("paused", (event) => event.elapsedMs);
preview.destroy();
// @ts-expect-error Judgment effects are fixed and not configurable.
void preview.setSettings({ showJudgeEffects: false });
// @ts-expect-error Unsupported skins are rejected by the interface.
void preview.setSettings({ noteSkin: "other" });
createPreview(document.createElement("div"), { diagnostics: true });
preview.on("performance", report => report.metrics.wasmTick?.p95Ms);
void preview.getDiagnostics().then(snapshot => snapshot.reports[0]?.presentedFps);
void preview.resetDiagnostics();
void preview.setDiagnostics(false);
// @ts-expect-error Diagnostic enable flag must be boolean.
void preview.setDiagnostics("true");

createPreview(document.createElement("div"), { pvTimeoutMs: 10000 });
createPreview(document.createElement("div"), { pvTimeoutMs: "unlimited" });
// @ts-expect-error Only unlimited is accepted as a timeout string.
createPreview(document.createElement("div"), { pvTimeoutMs: "10000" });
void preview.getState().then((state) => state.pvTimeoutMs);
void preview.setCoverComposition({ outputWidth: 960, outputHeight: 720, activeLayerKey: "card" });
void preview.setCoverComposition({ sourceText: "&inote_5=(120){4}A1,E", difficulty: 5, trackOverrides: { mode: "auto" } });
void preview.getCoverComposition().then(state => state.trackOverrides.mode);
createPreview(document.createElement("div"), { audioContextOwner: "opener" });
void preview.setPerformance({ canvasFrameRateMode: 0, stageMediaFrameRateMode: 3, videoDecodePrefersSoftware: true });
void preview.getState().then(state => state.videoPresentation.decoder);
// @ts-expect-error Frame rate modes preserve the existing integer enum.
void preview.setPerformance({ canvasFrameRateMode: 4 });
// @ts-expect-error Software decoding preference uses a boolean.
void preview.setPerformance({ videoDecodePrefersSoftware: 1 });
// @ts-expect-error Audio ownership follows the renderer or its same-origin opener.
createPreview(document.createElement("div"), { audioContextOwner: "parent" });
void preview.getCoverComposition().then(state => state.layout.layers[0]?.text);
void preview.coverCommand("cover.addTextLayer", { text: "MiaCode" });
void preview.coverCommand("cover.layer", { key: "text", textColor: "#ffffff", opacity: .5 });
void preview.importCoverImage(new Blob()).then(image => image.sha256);
void preview.exportCover({ type: "image/png" }).then(image => image.blob);
void preview.getCoverComposition().then(state => preview.coverCommand("cover.importLayout", { composition: state.composition }));
preview.on("coverChanged", state => state.outputWidth);
createPreview(document.createElement("div"), { controls: false });
void preview.setPlayback({ rate: .5, rangePlaybackEnabled: true, exportStartSeconds: 2, exportEndSeconds: 5 });
void preview.setMediaSettings({ hidePv: true });
void preview.setResources({ audio: new Blob(), cover: "./bg.png", video: null });
void preview.setLatency({ onPage: true, subdivision: 16 });
void preview.detectLatency("bpm").then(result => result.candidates.map(item => item.bpm));
void preview.detectLatency("offset", { bpm: 120, offsetSeconds: -.25 });
// @ts-expect-error Media replacement preserves the chart source.
void preview.setResources({ maidata: "&inote_5=1,E" });
void preview.audioCommand("audio.channelPercent", { key: "track", percent: 50 });
void preview.audioCommand("audio.channelMuted", { key: "breakSlide", muted: true });
void preview.audioCommand("audio.getSettings").then(audio => audio.channels.global.percent);
// @ts-expect-error Audio channel names use the editor's channel identifiers.
void preview.audioCommand("audio.channelMuted", { key: "typo", muted: true });
void preview.setCanvasSize({ width: 1200, height: 800 });
void preview.getTimeline({ width: 600, height: 180, colors: {} }).then(state => state.noteSprites[0]?.imageKey);
void preview.navigateTimeline({ x: 300, y: 50 }).then(target => target.position);
void preview.getTimelineFollow(1).then(state => state.caret);
void preview.getDocument().then(state => state.dirtyDifficultyIds);
void preview.readAudioInfo(new Blob()).then(info => info.cover?.mimeType);
void preview.importFont(new Blob(),"font.ttf").then(font=>font.family);
void preview.getExportCapabilities({width:1920,height:1080,fps:60,audioBitrateKbps:192}).then(info=>info.videoCodec);
void preview.startExport({exportStartSeconds:1,exportEndSeconds:2,introBackground:new Blob()}).then(job=>job.jobId);
void preview.cancelExport();
void preview.setIntroAudition({playing:true,introAuditionLoop:true,introPvStartSeconds:.5}).then(state=>state?.elapsed);
preview.on("introAuditionChanged",state=>state.playing);
void preview.getExportStatus().then(status=>status?.stage);
preview.on("exportCompleted",result=>result.blob?.size);
preview.on("exportFailed",result=>result.cancelled);
// @ts-expect-error Export accepts the supported frame-rate choices.
void preview.startExport({fps:50});
void preview.normalizeBackground({sizeMode:"cover"}).then(settings=>settings.panelAlpha);
void preview.setSettings({hudFontPaths:{chart_info:"/web-fonts/font.ttf"}});
void preview.normalizeShortcuts({ play: "Ctrl+Shift+X" }).then(bindings => bindings.play.wheelDirection);
void preview.getAnalysis("zh").then(state => state.validationRows.map(row => row.column));
void preview.documentCommand("document.metadataTitle", { value: "MiaCode" }).then(result => result.document.revision);
void preview.getDocumentSaveText(5).then(result => result.sourceText);
preview.on("timeupdate", state => state.currentTime);
preview.on("timeupdate", state => state.statistics.map(item => item.played));
void preview.getState().then(state => state.statisticsAvailable && state.statistics.map(item => item.total));
void preview.setCoverChart({maidata:"&inote_5=1,E",difficulty:5},{duration:12}).then(state=>state.chartFrameDuration);
void preview.coverCommand("cover.beginActiveLayerKeySeek",{direction:1});
preview.on("coverPlaybackChanged",state=>state.frameSeconds);
void preview.importSkin([{path:"tap.png",image:new Blob()}]).then(skin=>preview.setSettings({skinDirectoryName:skin.skinDirectoryName}));
void preview.importJudgeLine(new Blob()).then(outline=>preview.setSettings({customOutlineFileName:outline.customOutlineFileName}));
void preview.selectDifficulty(5).then(state => "hasDocument" in state ? state.chartText : state.noteCount);
// @ts-expect-error Range enablement uses a boolean.
void preview.setPlayback({ rangePlaybackEnabled: "true" });

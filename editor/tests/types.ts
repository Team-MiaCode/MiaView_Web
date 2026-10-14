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
void preview.getCoverComposition().then(state => state.layout.layers[0]?.text);
preview.on("coverChanged", state => state.outputWidth);
createPreview(document.createElement("div"), { controls: false });
void preview.setPlayback({ rate: .5, rangePlaybackEnabled: true, exportStartSeconds: 2, exportEndSeconds: 5 });
void preview.setMediaSettings({ hidePv: true });
void preview.setCanvasSize({ width: 1200, height: 800 });
void preview.getTimeline({ width: 600, height: 180, colors: {} }).then(state => state.noteSprites[0]?.imageKey);
void preview.navigateTimeline({ x: 300, y: 50 }).then(target => target.position);
void preview.getTimelineFollow(1).then(state => state.caret);
void preview.getDocument().then(state => state.dirtyDifficultyIds);
void preview.documentCommand("document.metadataTitle", { value: "MiaCode" }).then(result => result.document.revision);
void preview.getDocumentSaveText(5).then(result => result.sourceText);
preview.on("timeupdate", state => state.currentTime);
preview.on("timeupdate", state => state.statistics.map(item => item.played));
void preview.getState().then(state => state.statisticsAvailable && state.statistics.map(item => item.total));
void preview.selectDifficulty(5).then(state => "hasDocument" in state ? state.chartText : state.noteCount);
// @ts-expect-error Range enablement uses a boolean.
void preview.setPlayback({ rangePlaybackEnabled: "true" });

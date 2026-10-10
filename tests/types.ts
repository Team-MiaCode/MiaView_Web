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
});
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

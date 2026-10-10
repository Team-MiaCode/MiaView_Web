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

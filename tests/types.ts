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
});
void preview.load(chart);
void preview.seek(1);
void preview.setSettings({ tapFlowSpeed: 8, noteSkin: "SD" });
void preview.setSettings({ previewMode: "maimuri_dx_style" });
// @ts-expect-error Unknown preview modes are rejected.
void preview.setSettings({ previewMode: "unknown" });
void preview.getState().then((state: PreviewState) => state.resolution.width);
preview.on("paused", (event) => event.elapsedMs);
preview.destroy();
// @ts-expect-error Judgment effects are fixed and not configurable.
void preview.setSettings({ showJudgeEffects: false });
// @ts-expect-error Unsupported skins are rejected by the interface.
void preview.setSettings({ noteSkin: "other" });

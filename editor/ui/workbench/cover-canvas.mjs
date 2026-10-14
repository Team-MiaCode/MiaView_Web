import { createPreview } from "../../sdk/index.mjs";

export const COVER_RESOLUTIONS = [[720, 720], [960, 720], [1280, 720], [1080, 1080], [1440, 1080], [1920, 1080], [1440, 1440], [1920, 1440], [2560, 1440]];

export class CoverCanvas {
  constructor(container, documentSession, changed, error, theme) {
    this.document = documentSession;
    this.preview = createPreview(container, { resolution: { width: 1080, height: 1080 }, layout: "fit", diagnostics: false, theme });
    this.preview.on("error", value => error?.(value.message));
    this.preview.on("coverChanged", changed);
    this.ready = this.preview.ready.then(() => this.update());
    this.ready.catch(value => error?.(value.message));
  }
  async update() {
    const doc = this.document;
    const values = doc.coverValues || {};
    const chart = doc.charts?.find(chart => chart.id === (values.selectedDifficultyId ?? doc.activeDifficultyId));
    const [outputWidth, outputHeight] = COVER_RESOLUTIONS[values.resolutionIndex ?? 3];
    if (this.jacketSource !== doc.metadataCoverSource) {
      this.jacketSource = doc.metadataCoverSource;
      this.jacketImage = doc.metadataCoverSource ? fetch(doc.metadataCoverSource).then(response => response.blob()).then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      })) : Promise.resolve("");
    }
    const jacketImage = await this.jacketImage || "";
    return this.preview.setCoverComposition({
      outputWidth, outputHeight,
      layout: doc.coverLayers ? { layers: doc.coverLayers } : undefined,
      activeLayerKey: values.activeLayerKey ?? "card",
      trackOverrides: { title: doc.metadataTitle ?? doc.title ?? "", artist: doc.metadataArtist ?? doc.artist ?? "", designer: doc.metadataDesigner ?? "",
        difficulty: chart?.name || ["EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "ReMASTER", "UTAGE"][(values.selectedDifficultyId ?? doc.activeDifficultyId ?? 5) - 1],
        level: doc.currentDifficultyLevel ?? chart?.level ?? "", mode: values.cardMode ?? "DX", bpm: doc.bpm ?? "" },
      jacketImage,
      backgroundMode: values.backgroundMode ?? 0,
      blurEnabled: values.blurBackground ?? true,
      coverBgBrightness: values.backgroundBrightness ?? .45,
      cardShadowEnabled: values.cardShadow ?? false,
    });
  }
  destroy() { this.preview.destroy(); }
}

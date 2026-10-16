import { createPreview } from "../../sdk/index.mjs";
import { previewSettingsFromValues } from "../../services/preview-appearance.mjs";
import { restorePreviewAppearance } from "../../services/user-appearance.mjs";
import { PreferenceAssets } from "../../services/preference-assets.mjs";
import { COVER_RESOLUTIONS, coverResolution, coverValuesFromComposition, coverAssetPaths, remapCoverAssets, portableCoverLayout } from "../../services/cover-files.mjs";

export { COVER_RESOLUTIONS };

export class CoverCanvas {
  constructor(container, documentSession, changed, error, theme, preferences = {}, playback) {
    this.document = documentSession;
    this.preferences = preferences;
    this.assets = new PreferenceAssets();
    this.imported = new Set();
    this.importedAppearance = new Set();
    this.thumbnailURLs = new Map();
    this.preview = createPreview(container, { resolution: { width: 1080, height: 1080 }, layout: "fit", diagnostics: false, theme });
    this.preview.on("error", value => { if (!this.destroyed) error?.(value.message); });
    this.preview.on("coverChanged", changed);
    this.preview.on("coverPlaybackChanged", state => {
      if (this.destroyed) return;
      this.document.chartFramePlaying = state.chartFramePlaying;
      const layer = this.document.coverLayers?.find(layer => layer.key === state.activeLayerKey);
      if (layer) layer.frameSeconds = state.frameSeconds;
      playback?.(state);
    });
    this.pending = this.preview.ready;
    this.ready = this.update();
    this.ready.catch(value => { if (!this.destroyed) error?.(value.message); });
  }
  run(action) {
    const result = this.pending.then(() => {
      if (this.destroyed) throw new DOMException("封面编辑器关闭", "AbortError");
      return action();
    });
    this.pending = result.catch(() => {});
    return result;
  }
  command(id, args = {}) { return this.run(async () => {
    if (id === "cover.addChartFrameLayer") { await this.ensureChart(); await this.configure(); }
    return this.preview.coverCommand(id, args);
  }); }
  async ensureChart() {
    const doc = this.document;
    if (!doc.sourceText) return;
    const difficulty = doc.coverValues?.selectedDifficultyId ?? doc.activeDifficultyId;
    const video = doc.folderFiles?.get(doc.metadataResolvedVideoPath);
    const settings = previewSettingsFromValues(this.preferences.previewValues || {}), key = JSON.stringify(settings);
    if (this.chartSource === doc.sourceText && this.chartDifficulty === difficulty && this.chartSettings === key && this.chartDuration === doc.duration && this.chartVideo === video) return;
    await this.ensureFonts(Object.values(settings.hudFontPaths || {}));
    await restorePreviewAppearance(this.preview,this.assets,settings,this.importedAppearance);
    await this.preview.setPerformance({ videoDecodePrefersSoftware: this.preferences.videoDecodePrefersSoftware ?? false,
      canvasFrameRateMode: this.preferences.canvasFrameRateMode ?? 1, stageMediaFrameRateMode: this.preferences.stageMediaFrameRateMode ?? 1 });
    await this.preview.setSettings(settings);
    await this.preview.setCoverChart({ maidata: doc.sourceText, difficulty, filePath: doc.filePath, video }, { duration: doc.duration });
    this.chartSource = doc.sourceText; this.chartDifficulty = difficulty; this.chartSettings = key; this.chartDuration = doc.duration; this.chartVideo = video;
  }
  updateLayerPreviews(layers) {
    const previews = {}, retained = new Set();
    for (const layer of layers.filter(layer => layer.kind === "image")) {
      const record = this.document.coverFiles?.find(asset => asset.path === layer.imagePath);
      if (!record) continue;
      retained.add(record.path);
      if (!this.thumbnailURLs.has(record.path)) this.thumbnailURLs.set(record.path, URL.createObjectURL(record.file));
      previews[layer.key] = this.thumbnailURLs.get(record.path);
    }
    for (const [path, url] of this.thumbnailURLs) if (!retained.has(path)) { URL.revokeObjectURL(url); this.thumbnailURLs.delete(path); }
    this.document.coverLayerPreviews = previews;
  }
  async loadAsset(file) {
    const kind = /\.(ttf|otf)$/i.test(file.name) ? "font" : "image";
    const asset = kind === "font" ? await this.preview.importFont(file, file.name) : await this.preview.importCoverImage(file);
    this.imported.add(asset.path);
    return { ...asset, kind, file };
  }
  async ensureFonts(paths) {
    for (const path of paths.filter(Boolean)) {
      if (this.imported.has(path)) continue;
      const record = this.document.coverFiles?.find(asset => asset.path === path) || await this.assets.get(`font:${path}`);
      if (!record) throw new Error(`请导入字体素材：${path}`);
      await this.loadAsset(record.file);
    }
  }
  importFile(file) { return this.run(async () => {
    const record = await this.loadAsset(file);
    const files = new Map((this.document.coverFiles || []).map(asset => [asset.path, asset]));
    files.set(record.path, record); this.document.coverFiles = [...files.values()];
    return record;
  }); }
  layoutFile() { return this.run(async () => {
    const state = await this.preview.getCoverComposition();
    const files = new Map((this.document.coverFiles || []).map(asset => [asset.path, asset.file]));
    for (const path of coverAssetPaths(state.composition)) if (!files.has(path)) {
      const record = await this.assets.get(`font:${path}`);
      if (record) files.set(path, record.file);
    }
    const { outputFile, ...composition } = state.composition;
    return portableCoverLayout(composition, files);
  }); }
  importLayout(composition) { return this.run(async () => {
    const mapping = new Map(), imported = [];
    for (const path of coverAssetPaths(composition)) {
      const embedded = composition.assets?.[path];
      const existing = this.document.coverFiles?.find(asset => asset.path === path) || await this.assets.get(`font:${path}`);
      const matches = [...(this.document.folderFiles?.values() || [])].filter(file => file.name === path.split(/[\\/]/).at(-1));
      let file = existing?.file || (matches.length === 1 ? matches[0] : null);
      if (embedded) file = new File([Uint8Array.from(atob(embedded.data), value => value.charCodeAt(0))], embedded.name, { type: embedded.type });
      if (!file) throw new Error(`请导入布局素材：${path}`);
      const asset = await this.loadAsset(file);
      mapping.set(path, asset.path); imported.push(asset);
    }
    if (composition.layout.layers.some(layer => layer.kind === "chartFrame")) await this.ensureChart();
    const result = await this.preview.coverCommand("cover.importLayout", { composition: remapCoverAssets(composition, mapping) });
    this.document.coverFiles = imported;
    Object.assign(this.document.coverValues, coverValuesFromComposition(result.composition));
    await this.preview.setCoverComposition({});
    return result;
  }); }
  exportImage(options) { return this.run(() => this.preview.exportCover(options)); }
  update() { return this.run(() => this.configure()); }
  async configure() {
    const doc = this.document;
    const values = doc.coverValues || {};
    if (doc.coverLayers?.some(layer => layer.kind === "chartFrame")) await this.ensureChart();
    const chart = doc.charts?.find(chart => chart.id === (values.selectedDifficultyId ?? doc.activeDifficultyId));
    const [outputWidth, outputHeight] = coverResolution(values);
    for (const record of doc.coverFiles || []) if (!this.imported.has(record.path)) await this.loadAsset(record.file);
    await this.ensureFonts([values.cardFontDisplayPath, values.cardFontBodyPath, ...(doc.coverLayers || []).map(layer => layer.fontPath)]);
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
    const result = await this.preview.setCoverComposition({
      outputWidth, outputHeight,
      sourceText: doc.sourceText || "", difficulty: values.selectedDifficultyId ?? doc.activeDifficultyId,
      layout: !this.configured && doc.coverLayers ? { layers: doc.coverLayers } : undefined,
      activeLayerKey: values.activeLayerKey ?? "card",
      trackOverrides: { title: doc.metadataTitle ?? doc.title ?? "", artist: doc.metadataArtist ?? doc.artist ?? "", designer: doc.metadataDesigner ?? "",
        difficulty: chart?.name || ["EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "ReMASTER", "UTAGE"][(values.selectedDifficultyId ?? doc.activeDifficultyId ?? 5) - 1],
        level: chart?.level ?? doc.currentDifficultyLevel ?? "", mode: values.cardMode ?? "auto", bpm: doc.bpm ?? "",
        lvRenderMode: values.levelTextRender ? "text" : "atlas", stillTextMode: values.longTextMode ?? "shrink" },
      jacketImage,
      backgroundImage: values.backgroundPath ? `file://${values.backgroundPath}` : "",
      backgroundMode: values.backgroundMode ?? 0,
      blurEnabled: values.blurBackground ?? true,
      coverBgBrightness: values.backgroundBrightness ?? .45,
      cardShadowEnabled: values.cardShadow ?? false,
      cardFontDisplayPath: values.cardFontDisplayPath ?? "", cardFontBodyPath: values.cardFontBodyPath ?? "",
      outputFile: values.outputFile ?? "card.jpg",
    });
    this.configured = true;
    return result;
  }
  destroy() {
    this.destroyed = true; this.preview.destroy(); void this.assets.close();
    for (const url of this.thumbnailURLs.values()) URL.revokeObjectURL(url);
    this.thumbnailURLs.clear(); delete this.document.coverLayerPreviews;
  }
}

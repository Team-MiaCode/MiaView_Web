import { PreviewTransport } from "../ui/workbench/preview-transport.mjs";
import { NoteStatistics } from "../ui/workbench/note-statistics.mjs";
import { PopupHost } from "../ui/components/popup-host.mjs";
import { restorePreviewAppearance } from "./user-appearance.mjs";
import { previewSettingsFromValues } from "./preview-appearance.mjs";

const presentationEvents = new Set(["timeupdate", "playing", "paused", "ended", "seeked", "playbackChanged", "introAuditionChanged", "shortcutInput", "touchPadAuthoring"]);
const activeMethods = new Set(["getState", "play", "pause", "seek", "setIntroAudition", "detectLatency"]);
const mirroredMethods = new Set(["setSettings", "setPlayback", "setPerformance", "setMediaSettings", "setLatency", "audioCommand", "importFont", "importSkin", "importJudgeLine", "setInputShortcuts", "setTheme"]);

// The editor keeps its native document owner. The window owns playback while
// detached, and receives chart transactions through the same public SDK.
export function createWorkbenchPreview(owner, options) {
  const router = new PreviewWindow(owner, options);
  return new Proxy(owner, { get(target, key) {
    if (key === "windowRouter") return router;
    if (key === "iframe") return router.active.iframe;
    if (["load", "setResources", "setCanvasSize", "destroy", "on"].includes(key)) return router[key].bind(router);
    if (activeMethods.has(key)) return (...args) => router.active[key](...args);
    if (mirroredMethods.has(key)) return (...args) => router.mirror(key, args);
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
}

class PreviewWindow {
  constructor(owner, options) {
    this.owner = owner; this.options = options; this.listeners = new Map(); this.pending = Promise.resolve();
    owner.on("documentChanged", doc => { this.latestDocument = doc; this.updateDocument(); });
  }
  get active() { return this.presenting ? this.popup.preview : this.owner; }
  on(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
      this.owner.on(type, value => { if (!presentationEvents.has(type) || !this.presenting) this.emit(type, value); });
      if (this.popup) this.listen(this.popup, type);
    }
    this.listeners.get(type).add(listener); return () => this.listeners.get(type)?.delete(listener);
  }
  emit(type, value) { for (const listener of this.listeners.get(type) || []) listener(value); }
  listen(popup, type) {
    popup.preview.on(type, value => {
      if (this.popup !== popup || !this.presenting) return;
      if (type === "touchPadAuthoring") {
        if (popup.document?.sourceText !== this.latestDocument?.sourceText) return;
        value = { ...value, documentOpenGeneration: this.latestDocument.documentOpenGeneration };
      }
      if (presentationEvents.has(type) || type === "error" || type === "progress") this.emit(type, value);
    });
  }
  async prepare(preview, settings) {
    const fonts = await this.options.assets.fonts();
    for (const font of fonts) if (!this.popup.fonts.has(font.path)) {
      await preview.importFont(font.file, font.file.name); this.popup.fonts.add(font.path);
    }
    await restorePreviewAppearance(preview, this.options.assets, settings, this.popup.appearance);
    await preview.setSettings(settings);
  }
  async load(input) {
    this.input = { ...input };
    if (this.presenting) await this.popup.preview.pause();
    const result = await this.owner.load(input);
    this.latestDocument = await this.owner.getDocument();
    if (this.presenting) {
      await this.popup.preview.load(input);
      this.popup.document = await this.popup.preview.getDocument();
      this.paintDocument();
    }
    return result;
  }
  async setResources(changes) {
    const result = await this.owner.setResources(changes); Object.assign(this.input, changes);
    if (this.presenting) await this.popup.preview.setResources(changes);
    return this.presenting ? this.popup.preview.getState() : result;
  }
  async mirror(method, args) {
    if (method === "setInputShortcuts") this.inputShortcuts = args[0];
    const result = await this.owner[method](...args);
    const popup = this.popup;
    if (this.presenting && popup) {
      if (method === "setSettings" && Object.keys(args[0]).some(key => key !== "touchPadAuthoringContext")) await this.prepare(popup.preview, result);
      else await popup.preview[method](...args);
    }
    return this.presenting && method === "setLatency" ? popup.preview.getState() : result;
  }
  async setCanvasSize(size) {
    const result = await this.owner.setCanvasSize(size); if (this.presenting) await this.fit(); return result;
  }
  updateDocument() {
    if (!this.latestDocument?.hasDocument) {
      this.input = null;
      const popup = this.popup;
      if (popup) { this.popup = null; this.presenting = false; this.closePopup(popup); this.options.changed(false); }
      return;
    }
    if (!this.presenting || this.documentQueued) return;
    this.documentQueued = true;
    const task = this.pending.then(async () => {
      this.documentQueued = false;
      const popup = this.popup, doc = this.latestDocument;
      if (!this.presenting || !popup || !doc) return;
      if (popup.document.sourceText !== doc.sourceText) {
        const result = await popup.preview.documentCommand("document.replaceSource", {
          sourceText: doc.sourceText, documentOpenGeneration: popup.document.documentOpenGeneration });
        popup.document = result.document;
      }
      if (popup.document.activeDifficultyId !== doc.activeDifficultyId) {
        await popup.preview.selectDifficulty(doc.activeDifficultyId); popup.document = await popup.preview.getDocument();
      }
      this.paintDocument();
    });
    this.pending = task.catch(error => { if (this.popup && !this.popup.window.closed) this.options.error(error); });
  }
  paintDocument() {
    const popup = this.popup; if (!popup || popup.window.closed) return;
    popup.window.document.title = `${this.latestDocument?.title || "MiaCode"} · 预览`;
    popup.transport.setDocument(this.latestDocument || {});
  }
  async toggle() {
    if (this.popup) return this.attach();
    if (!this.input) throw new Error("请打开谱面工程");
    const window = globalThis.window.open(new URL("../preview-window.html", import.meta.url).href, "", "popup,width=800,height=900");
    if (!window) throw new Error("浏览器需要允许打开预览窗口");
    const popup = this.popup = { window, abort: new AbortController(), fonts: new Set(), appearance: new Set() };
    try {
      const [snapshot] = await Promise.all([
        this.owner.pause().then(state => { popup.snapshot = state; return state; }),
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("预览窗口载入超时")), 15000);
          window.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
        }),
      ]);
      if (window.closed || this.destroyed) throw new DOMException("预览窗口关闭", "AbortError");
      const document = window.document, root = document.getElementById("preview-window");
      const execute = (id, args) => Promise.resolve(this.options.command(id, args)).catch(this.options.error);
      popup.menus = new PopupHost(root, execute);
      popup.transport = new PreviewTransport(execute, (...args) => popup.menus.showMenu(...args), this.options.viewState);
      popup.transport.setDocument({ hasDocument: false });
      popup.transport.setDetached(true);
      popup.statistics = new NoteStatistics(() => this.options.viewState.preferences.languageToken || "zh");
      document.getElementById("preview-window-controls").append(popup.transport.root);
      document.getElementById("preview-window-statistics").append(popup.statistics.root);
      document.getElementById("preview-window-attach").addEventListener("click", () => { void this.attach().catch(this.options.error); });
      for (const event of ["keydown", "keyup", "wheel"]) document.addEventListener(event,
        event => this.options.shortcut(event, root), { signal: popup.abort.signal, capture: true, passive: false });
      window.addEventListener("blur", this.options.releaseShortcuts, { signal: popup.abort.signal });
      window.addEventListener("beforeunload", () => {
        // Child documents can release their audio before the parent pagehide.
        popup.closingState = { clock: { ...popup.clock }, intro: popup.intro };
      }, { signal: popup.abort.signal });
      window.addEventListener("pagehide", () => {
        if (this.popup !== popup || this.destroyed) return;
        if (this.presenting) void this.attach(true).catch(this.options.error);
        else {
          this.popup = null; this.closePopup(popup);
          if (popup.snapshot) void this.restore(this.owner, popup.snapshot).catch(this.options.error);
          this.options.changed(false);
        }
      }, { once: true });
      if (snapshot.introAudition?.active) { await this.owner.setIntroAudition({ enabled: false }); await this.owner.pause(); }
      popup.preview = window.miacodePreviewWindow.createPreview(document.getElementById("preview-window-stage"), { ...this.options.preview,
        resolution: this.options.resolution, controls: false, layout: "fit", diagnostics: false, audioContextOwner: "opener", theme: this.options.viewState.activeThemeToken });
      for (const type of this.listeners.keys()) this.listen(popup, type);
      popup.preview.on("timeupdate", state => {
        popup.clock = { ...state, observedAt: performance.now() };
        popup.transport.update(state); popup.statistics.update(state.statistics || [], { dataAvailable: state.statisticsAvailable, noteSkin: popup.settings?.noteSkin });
      });
      popup.preview.on("introAuditionChanged", state => { popup.intro = state; });
      for (const type of ["playing", "paused"]) popup.preview.on(type, state => {
        popup.clock = { ...popup.clock, currentTime: state.elapsedMs / 1000, playing: type === "playing", observedAt: performance.now() };
      });
      popup.preview.on("seeked", state => { popup.clock = { ...popup.clock, currentTime: state.currentTime, observedAt: performance.now() }; });
      popup.preview.on("playbackChanged", playback => {
        popup.clock = { ...popup.clock, playback, rate: playback.rate }; popup.transport.update({ playback });
      });
      popup.preview.on("settingsChanged", settings => { popup.settings = settings; });
      await popup.preview.ready;
      await this.prepare(popup.preview, snapshot.settings);
      await popup.preview.setPerformance(snapshot.performance);
      this.latestDocument = await this.owner.getDocument();
      await popup.preview.load({ ...this.input, maidata: this.latestDocument.sourceText, difficulty: this.latestDocument.activeDifficultyId || null, filePath: this.latestDocument.filePath });
      popup.document = await popup.preview.getDocument();
      await popup.preview.audioCommand("audio.restoreSettings", { settings: (await this.owner.audioCommand("audio.getSettings")).settings });
      await popup.preview.setMediaSettings({ hidePv: snapshot.media.hidePv });
      await popup.preview.setInputShortcuts(this.inputShortcuts || {});
      await this.restore(popup.preview, snapshot);
      const resized = () => { void this.fit().catch(this.options.error); };
      popup.resize = new window.ResizeObserver(resized); popup.resize.observe(document.getElementById("preview-window-stage"));
      this.updateAppearance(); await this.fit(); window.focus();
      this.presenting = true; this.paintDocument(); this.options.changed(true);
      this.emit("timeupdate", await popup.preview.getState());
      if (snapshot.introAudition?.active) this.emit("introAuditionChanged", await popup.preview.getState().then(state => state.introAudition));
    } catch (error) {
      if (this.popup === popup) { this.closePopup(popup); this.popup = null; this.presenting = false; this.options.changed(false); }
      if (popup.snapshot && !this.destroyed) await this.restore(this.owner, popup.snapshot);
      throw error;
    }
  }
  async restore(preview, state) {
    if (state.latency?.onPage) await preview.setLatency(state.latency);
    await preview.setPlayback(state.playback);
    await preview.seek(state.currentTime);
    if (state.introAudition?.active) await preview.setIntroAudition({ ...this.options.introSettings(),
      introPvStartSeconds: state.introAudition.introPvStartSeconds, introAuditionLoop: state.introAudition.introAuditionLoop,
      playing: false, elapsed: state.introAudition.elapsed });
  }
  updateAppearance() {
    const popup = this.popup; if (!popup || popup.window.closed) return;
    popup.window.document.documentElement.dataset.theme = this.options.viewState.activeThemeToken;
    popup.window.document.getElementById("preview-window").style.cssText = this.options.root.style.cssText;
  }
  async fit() {
    const popup = this.popup; if (!popup?.preview || popup.window.closed) return;
    const bounds = popup.window.document.getElementById("preview-window-stage").getBoundingClientRect(), limit = Math.max(this.options.resolution.width, this.options.resolution.height);
    const scale = Math.min(1, limit / Math.max(1, bounds.width, bounds.height));
    const size = this.options.viewState.preferences.previewCanvasFreeAspect
      ? { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) }
      : { width: Math.max(1, Math.round(Math.min(bounds.width, bounds.height, limit))), height: Math.max(1, Math.round(Math.min(bounds.width, bounds.height, limit))) };
    const key = `${size.width}x${size.height}`; if (popup.size === key) return;
    popup.size = key; await popup.preview.setCanvasSize(size);
    if (popup.intro?.active) return;
    const settings = previewSettingsFromValues(this.options.viewState.preferences.previewValues || {});
    if (Object.keys(settings).length) await popup.preview.setSettings(settings);
  }
  async attach(closed = false) {
    const popup = this.popup; if (!popup || !this.presenting || this.attaching) return;
    this.attaching = true;
    try {
      if (closed) popup.preview.destroy();
      await this.pending;
      let state;
      if (!closed && !popup.window.closed) state = await popup.preview.pause();
      else {
        const clock = popup.closingState?.clock || popup.clock || {};
        state = { ...clock, playback: clock.playback || (await this.owner.getState()).playback, introAudition: popup.closingState?.intro || popup.intro };
        if (clock.playing && !state.introAudition?.active) state.currentTime = Math.min(clock.duration, clock.currentTime + (performance.now() - clock.observedAt) / 1000 * clock.rate);
      }
      this.presenting = false; this.popup = null; this.closePopup(popup);
      this.options.changed(false);
      await this.restore(this.owner, state);
    } finally { this.attaching = false; }
  }
  closePopup(popup) {
    popup.abort.abort(); popup.resize?.disconnect(); popup.menus?.destroy(); popup.preview?.destroy();
    if (!popup.window.closed) popup.window.close();
  }
  destroy() { this.destroyed = true; if (this.popup) this.closePopup(this.popup); this.popup = null; this.presenting = false; this.owner.destroy(); }
}

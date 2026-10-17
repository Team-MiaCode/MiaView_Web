import { previewResolution, canvasResolution } from "./resolution.mjs";
import { TRANSPORT_HEIGHT } from "./layout.mjs";
import { previewPvTimeout, scheduleTimeout } from "../renderer/pv-timeout.mjs";
import { previewMaxFps } from "./frame-rate.mjs";
import { performanceSettings } from "../renderer/performance-settings.mjs";
import {
  SDK_PROTOCOL,
  HOST_SOURCE,
  httpUrl,
  validIdentity,
  trustedResponse,
  normalizeChart,
  normalizeResources,
  normalizeSettings,
  normalizeSkinFiles,
  difficultyId,
  previewTheme,
} from "./protocol.mjs";
export { previewResolution, DEFAULT_RESOLUTION } from "./resolution.mjs";
export { previewMaxFps, DEFAULT_MAX_FPS } from "./frame-rate.mjs";

export function createPreview(container, options = {}) {
  return new MiaCodePreview(container, options);
}

class MiaCodePreview {
  constructor(container, options) {
    if (
      !container?.ownerDocument ||
      typeof container.appendChild !== "function"
    )
      throw new Error("A DOM container is required");
    const document = container.ownerDocument;
    this.window = document.defaultView;
    if (!this.window || !this.window.crypto?.randomUUID)
      throw new Error("MiaView Web requires HTTPS or localhost");
    const resolution = previewResolution(options.resolution);
    const maxFps = previewMaxFps(options.maxFps);
    const theme = previewTheme(options.theme);
    const layout = options.layout ?? "intrinsic";
    if (layout !== "intrinsic" && layout !== "fit") throw new Error("layout must be intrinsic or fit");
    this.layout = layout;
    this.resolution = resolution;
    this.controls = options.controls ?? true;
    if (typeof this.controls !== "boolean") throw new Error("controls must be a boolean");
    const allow = options.allow ?? "autoplay; fullscreen";
    const sandbox = options.sandbox ?? "allow-scripts allow-same-origin";
    if (typeof allow !== "string" || typeof sandbox !== "string") throw new Error("Iframe allow and sandbox must be strings");
    this.pvTimeoutMs = previewPvTimeout(options.pvTimeoutMs);
    if (
      options.diagnostics !== undefined &&
      typeof options.diagnostics !== "boolean"
    )
      throw new Error("diagnostics must be a boolean");
    this.timeout = options.timeoutMs ?? 120000;
    if (!Number.isFinite(this.timeout) || this.timeout <= 0)
      throw new Error("timeoutMs must be positive");
    this.url = new URL(
      httpUrl(
        options.rendererUrl ??
          new URL("../renderer/index.html", import.meta.url).href,
        document.baseURI,
      ),
    );
    this.url.searchParams.set("width", String(resolution.width));
    this.url.searchParams.set("height", String(resolution.height));
    this.url.searchParams.set("maxFps", String(maxFps));
    this.url.searchParams.set("theme", theme);
    this.url.searchParams.set("controls", this.controls ? "1" : "0");
    this.url.searchParams.set("pvTimeoutMs", String(this.pvTimeoutMs));
    this.url.searchParams.set(
      "diagnostics",
      options.diagnostics === false ? "0" : "1",
    );
    this.url.searchParams.set("hostOrigin", this.window.location.origin);
    const audioContextOwner = options.audioContextOwner ?? "renderer";
    if (!["renderer", "opener"].includes(audioContextOwner)) throw new Error("Invalid audio context owner");
    this.url.searchParams.set("audioContextOwner", audioContextOwner);
    this.origin = this.url.origin;
    this.sessionId = this.window.crypto.randomUUID();
    this.pending = new Map();
    this.listeners = new Map();
    this.destroyed = false;
    this.failed = null;
    this.queue = Promise.resolve();
    this.abort = new AbortController();
    this.wrapper = document.createElement("div");
    Object.assign(this.wrapper.style, {
      position: "relative",
      width: "100%",
      paddingTop: `${(resolution.height / resolution.width) * 100}%`,
      paddingBottom: this.controls ? `${TRANSPORT_HEIGHT}px` : "0",
      overflow: "hidden",
      background: "#000",
      boxSizing: "content-box",
    });
    if (layout === "fit") Object.assign(this.wrapper.style, { paddingTop: "0", paddingBottom: "0", height: "100%", boxSizing: "border-box" });
    this.iframe = document.createElement("iframe");
    Object.assign(this.iframe.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      border: "0",
    });
    this.iframe.title = "MiaView Web 谱面预览";
    this.iframe.allow = allow;
    this.iframe.allowFullscreen = true;
    this.iframe.setAttribute("sandbox", sandbox);
    this.iframe.referrerPolicy = "no-referrer";
    this.wrapper.appendChild(this.iframe);
    this.receive = (event) => this.handleMessage(event);
    this.window.addEventListener("message", this.receive);
    const loaded = new Promise((resolve, reject) => {
      this.rejectStartup = reject;
      this.iframe.onload = resolve;
      this.iframe.onerror = () =>
        reject(new Error("Renderer document could not be loaded"));
    });
    void loaded.catch(() => {});
    this.ready = this.boot(loaded).catch((error) => {
      this.failed = error;
      this.emit("error", {
        code: "SDK_STARTUP_FAILED",
        message: error.message,
      });
      this.destroy();
      throw error;
    });
    // Consumers may attach ready/error handling after constructing the widget.
    void this.ready.catch(() => {});
    this.iframe.src = this.url.href;
    container.appendChild(this.wrapper);
  }
  async boot(loaded) {
    const timer = setTimeout(
      () => this.rejectStartup(new Error("Renderer startup timed out")),
      this.timeout,
    );
    const identityTimer = setTimeout(() => this.abort.abort(), this.timeout);
    try {
      const response = await this.window.fetch(
        new URL("./build-identity.json", this.url),
        { cache: "no-store", credentials: "omit", signal: this.abort.signal },
      );
      if (!response.ok) throw new Error("Renderer build identity unavailable");
      this.identity = await response.json();
      if (!validIdentity(this.identity))
        throw new Error("Invalid renderer build identity");
      await loaded;
      if (this.destroyed) throw new Error("Preview has been destroyed");
      await this.request("initialize", {
        playerVersion: this.identity.version,
        sourceRevision: this.identity.sourceRevision,
      });
      return this;
    } finally {
      clearTimeout(timer);
      clearTimeout(identityTimer);
    }
  }
  emit(type, payload) {
    for (const listener of this.listeners.get(type) ?? []) {
      try {
        listener(payload);
      } catch (error) {
        console.error("MiaView Web event handler failed", error);
      }
    }
  }
  watchCoverPlayback(playing) {
    clearTimeout(this.coverPlaybackTimer);
    if (!playing || this.destroyed) return;
    // An offscreen renderer can suspend Qt timers. The visible host observes
    // its native clock when the normal playback event stream falls silent.
    this.coverPlaybackTimer = setTimeout(() => {
      this.coverPlaybackTimer = null;
      void this.command("getCoverComposition").then(state => {
        if (!this.coverPlaybackTimer) this.watchCoverPlayback(state.chartFramePlaying);
      }).catch(error => {
        if (!this.destroyed) this.emit("error", { code: "SDK_COVER_PLAYBACK_FAILED", message: error.message });
      });
    }, 250);
  }
  on(type, listener) {
    if (this.destroyed) throw new Error("Preview has been destroyed");
    if (typeof listener !== "function")
      throw new Error("Listener must be a function");
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }
  handleMessage(event) {
    const message = trustedResponse(
      event,
      this.iframe.contentWindow,
      this.origin,
      this.sessionId,
    );
    if (!message || this.destroyed || !this.identity) return;
    if (
      message.playerVersion !== this.identity.version ||
      message.sourceRevision !== this.identity.sourceRevision
    ) {
      for (const { reject, timer } of this.pending.values()) {
        timer();
        reject(new Error("Renderer build identity mismatch"));
      }
      this.pending.clear();
      return;
    }
    if (message.type !== "response") {
      if (message.type === "coverPlaybackChanged") this.watchCoverPlayback(message.payload.chartFramePlaying);
      this.emit(message.type, message.payload);
      return;
    }
    const request = this.pending.get(message.requestId);
    if (!request) return;
    this.pending.delete(message.requestId);
    request.timer();
    if (message.ok) request.resolve(message.value);
    else
      request.reject(
        new Error(message.error?.message ?? "Preview command failed"),
      );
  }
  request(type, payload = {}) {
    if (this.destroyed)
      return Promise.reject(new Error("Preview has been destroyed"));
    const requestId = this.window.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const loading = type === "load" || type === "setCoverChart" || type === "selectDifficulty" || type === "setResources";
      const waitMs = loading ? (this.pvTimeoutMs === "unlimited" ? "unlimited" : Math.min(Number.MAX_SAFE_INTEGER, this.timeout + this.pvTimeoutMs)) : this.timeout;
      const timer = waitMs === "unlimited" ? () => {} : scheduleTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Preview command timed out: ${type}`));
      }, waitMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.iframe.contentWindow.postMessage(
          {
            source: HOST_SOURCE,
            protocolVersion: SDK_PROTOCOL,
            sessionId: this.sessionId,
            requestId,
            type,
            payload,
          },
          this.origin,
        );
      } catch (error) {
        timer();
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }
  command(type, payload) {
    const next = this.queue.then(async () => {
      await this.ready;
      if (this.failed) throw this.failed;
      return this.request(type, payload);
    });
    if (type !== "getAnalysis") this.queue = next.catch(() => {});
    return next;
  }
  load(chart) {
    try {
      return this.command(
        "load",
        normalizeChart(chart, this.wrapper.ownerDocument.baseURI),
      ).then(value => { this.setIntrinsicSurface(this.resolution, false); return value; });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  setResources(resources) {
    try { return this.command("setResources", normalizeResources(resources, this.wrapper.ownerDocument.baseURI)); }
    catch (error) { return Promise.reject(error); }
  }
  play() {
    return this.command("play");
  }
  pause() {
    return this.command("pause");
  }
  restart() {
    return this.command("restart");
  }
  seek(second) {
    if (!Number.isFinite(second) || second < 0)
      return Promise.reject(
        new Error("Seek time must be finite and non-negative"),
      );
    return this.command("seek", { second });
  }
  setSettings(settings) {
    try {
      return this.command("setSettings", normalizeSettings(settings));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  setPlayback(settings) {
    return this.command("setPlayback", settings);
  }
  setMediaSettings(settings) {
    return this.command("setMediaSettings", settings);
  }
  setCanvasSize(size) {
    try { size=canvasResolution(size); } catch(error) { return Promise.reject(error); }
    return this.command("setCanvasSize", size).then(value => {
      this.resolution = { width: value.width, height: value.height };
      this.setIntrinsicSurface(this.resolution, false);
      return this.resolution;
    });
  }
  getTimeline(options) { return this.command("getTimeline", options); }
  navigateTimeline(point) { return this.command("navigateTimeline", point); }
  getTimelineFollow(second) {
    if (!Number.isFinite(second)) return Promise.reject(new Error("Timeline time must be finite"));
    return this.command("getTimelineFollow", { second });
  }
  getDocument() { return this.command("getDocument"); }
  getAnalysis(language = "zh") { return this.command("getAnalysis", { language }); }
  documentCommand(id, args = {}) { return this.command("documentCommand", { id, args }); }
  editorCommand(id, args = {}) { return this.command("editorCommand", { id, args }).then(result => {
    if (result.error) throw new Error(result.error);
    return result;
  }); }
  audioCommand(id, args = {}) { return this.command("audioCommand", { id, args }); }
  setLatency(settings) { return this.command("setLatency", settings); }
  detectLatency(kind, parameters = {}) { return this.command("detectLatency", { kind, ...parameters }); }
  readAudioInfo(audio) {
    try { return this.command("readAudioInfo", { audio: normalizeResources({ audio },this.wrapper.ownerDocument.baseURI).audio }); }
    catch (error) { return Promise.reject(error); }
  }
  normalizeShortcuts(sequences) { return this.command("normalizeShortcuts", sequences); }
  setInputShortcuts(sequences) { return this.command("setInputShortcuts", sequences); }
  normalizeBackground(settings = {}) { return this.command("normalizeBackground", settings); }
  getExportCapabilities(settings = {}) { return this.command("getExportCapabilities", settings); }
  setIntroAudition(settings = {}) {
    try { return this.command("setIntroAudition", {...settings,...(settings.introBackground?{introBackground:normalizeResources({cover:settings.introBackground},this.wrapper.ownerDocument.baseURI).cover}:{})}); }
    catch(error){return Promise.reject(error);}
  }
  startExport(settings = {}) {
    try { return this.command("startExport", { ...settings, ...(settings.introBackground ? {introBackground:normalizeResources({cover:settings.introBackground},this.wrapper.ownerDocument.baseURI).cover} : {}) }); }
    catch(error) { return Promise.reject(error); }
  }
  cancelExport() { return this.command("cancelExport"); }
  getExportStatus() { return this.command("getExportStatus"); }
  importFont(font, name = font?.name || "font.ttf") {
    try { return this.command("importFont", { font: normalizeResources({audio:font},this.wrapper.ownerDocument.baseURI).audio, name }); }
    catch (error) { return Promise.reject(error); }
  }
  importSkin(files) {
    try { return this.command("importSkin", { files: normalizeSkinFiles(files, this.wrapper.ownerDocument.baseURI) }); }
    catch (error) { return Promise.reject(error); }
  }
  importJudgeLine(image) {
    try { return this.command("importJudgeLine", { image: normalizeResources({ cover: image }, this.wrapper.ownerDocument.baseURI).cover }); }
    catch (error) { return Promise.reject(error); }
  }
  getDocumentSaveText(section = 0) { return this.command("getDocumentSaveText", { section }); }
  setTheme(theme) {
    try { return this.command("setTheme", { theme: previewTheme(theme) }); }
    catch (error) { return Promise.reject(error); }
  }
  setCoverChart(chart, options = {}) {
    try { return this.command("setCoverChart", { chart: normalizeChart(chart, this.wrapper.ownerDocument.baseURI), duration: options.duration }); }
    catch (error) { return Promise.reject(error); }
  }
  setCoverComposition(composition) {
    return this.command("setCoverComposition", composition).then(value => {
      this.setIntrinsicSurface({ width: value.outputWidth, height: value.outputHeight }, true);
      return value;
    });
  }
  coverCommand(id, args = {}) {
    return this.command("coverCommand", { id, args }).then(value => {
      this.setIntrinsicSurface({ width: value.outputWidth, height: value.outputHeight }, true);
      return value;
    });
  }
  importCoverImage(image) {
    try { return this.command("importCoverImage", { image: normalizeResources({ cover: image }, this.wrapper.ownerDocument.baseURI).cover }); }
    catch (error) { return Promise.reject(error); }
  }
  exportCover(options = {}) { return this.command("exportCover", options); }
  setIntrinsicSurface(resolution, cover) {
    if (this.layout === "intrinsic") Object.assign(this.wrapper.style, {
      paddingTop: `${resolution.height / resolution.width * 100}%`,
      paddingBottom: cover || !this.controls ? "0" : `${TRANSPORT_HEIGHT}px`,
    });
  }
  getCoverComposition() {
    return this.command("getCoverComposition");
  }
  selectDifficulty(difficulty) {
    try {
      if (difficulty == null) throw new Error("Difficulty is required");
      return this.command("selectDifficulty", {
        difficulty: difficultyId(difficulty),
      }).then(value => { this.setIntrinsicSurface(this.resolution, false); return value; });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  getState() {
    return this.command("getState");
  }
  setPerformance(changes) {
    try { return this.command("setPerformance", performanceSettings({}, changes)); }
    catch (error) { return Promise.reject(error); }
  }
  getDiagnostics() {
    return this.command("getDiagnostics");
  }
  resetDiagnostics() {
    return this.command("resetDiagnostics");
  }
  setDiagnostics(enabled) {
    if (typeof enabled !== "boolean")
      return Promise.reject(new Error("diagnostics must be a boolean"));
    return this.command("setDiagnostics", { enabled });
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.coverPlaybackTimer);
    const error = new Error("Preview has been destroyed");
    this.abort.abort();
    this.rejectStartup(error);
    for (const request of this.pending.values()) {
      request.timer();
      request.reject(error);
    }
    this.pending.clear();
    this.window.removeEventListener("message", this.receive);
    this.iframe.onload = this.iframe.onerror = null;
    this.wrapper.remove();
    this.listeners.clear();
  }
}

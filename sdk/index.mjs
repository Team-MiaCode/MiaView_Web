import { previewResolution } from "./resolution.mjs";
import { previewMaxFps } from "./frame-rate.mjs";
import { TRANSPORT_HEIGHT } from "./layout.mjs";
import {
  SDK_PROTOCOL,
  HOST_SOURCE,
  httpUrl,
  validIdentity,
  trustedResponse,
  normalizeChart,
  normalizeSettings,
  difficultyId,
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
    const theme = options.theme ?? "dark";
    if (!["dark", "light"].includes(theme)) throw new Error("theme must be dark or light");
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
    this.url.searchParams.set("hostOrigin", this.window.location.origin);
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
      paddingBottom: `${TRANSPORT_HEIGHT}px`,
      overflow: "hidden",
      background: "#000",
      boxSizing: "content-box",
    });
    this.iframe = document.createElement("iframe");
    Object.assign(this.iframe.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      border: "0",
    });
    this.iframe.title = "MiaView Web 谱面预览";
    this.iframe.allow = "autoplay; fullscreen";
    this.iframe.allowFullscreen = true;
    this.iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
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
        clearTimeout(timer);
        reject(new Error("Renderer build identity mismatch"));
      }
      this.pending.clear();
      return;
    }
    if (message.type !== "response") {
      this.emit(message.type, message.payload);
      return;
    }
    const request = this.pending.get(message.requestId);
    if (!request) return;
    this.pending.delete(message.requestId);
    clearTimeout(request.timer);
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
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Preview command timed out: ${type}`));
      }, this.timeout);
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
        clearTimeout(timer);
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
    this.queue = next.catch(() => {});
    return next;
  }
  load(chart) {
    try {
      return this.command(
        "load",
        normalizeChart(chart, this.wrapper.ownerDocument.baseURI),
      );
    } catch (error) {
      return Promise.reject(error);
    }
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
  selectDifficulty(difficulty) {
    try {
      if (difficulty == null) throw new Error("Difficulty is required");
      return this.command("selectDifficulty", {
        difficulty: difficultyId(difficulty),
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  getState() {
    return this.command("getState");
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const error = new Error("Preview has been destroyed");
    this.abort.abort();
    this.rejectStartup(error);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.window.removeEventListener("message", this.receive);
    this.iframe.onload = this.iframe.onerror = null;
    this.wrapper.remove();
    this.listeners.clear();
  }
}

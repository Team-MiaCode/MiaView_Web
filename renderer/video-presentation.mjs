import { SoftwareVideoFrames } from "./software-video.mjs";
import { PreviewFrameLimiter } from "./frame-rate.mjs";
import { frameRateForMode } from "./performance-settings.mjs";
import { drawStageVideo } from "./video-geometry.mjs";
import { BrowserVideoFrames } from "./browser-video.mjs";

export class VideoPresentation {
  constructor(canvas, geometry, failed, frameReady) {
    this.canvas = canvas; this.context = canvas.getContext("2d", { alpha: false }); this.geometry = geometry; this.failed = failed;
    this.limiter = new PreviewFrameLimiter(60); this.frames = 0; this.frameRateMode = 1; this.generation = 0; this.software = false;
    this.frameReady = frameReady;
  }
  async prepare(blob, software = this.software) { return blob && software ? SoftwareVideoFrames.open(blob) : null; }
  commit(video, blob, decoder) {
    ++this.generation; this.decoder?.close(); this.browserFrames?.close();
    this.decoder = decoder; this.video = video; this.blob = blob;
    this.browserFrames = decoder || !blob ? null : new BrowserVideoFrames(video, () => {
      this.stamp = null; queueMicrotask(() => this.frameReady?.());
    }, this.failed);
    this.stamp = null; this.frames = 0; this.timestamp = undefined;
    if (decoder) video.pause();
  }
  async configure(settings) {
    const decoder = settings.videoDecodePrefersSoftware === this.software ? this.decoder : await this.prepare(this.blob, settings.videoDecodePrefersSoftware);
    if (decoder !== this.decoder) this.commit(this.video, this.blob, decoder);
    this.software = settings.videoDecodePrefersSoftware; this.frameRateMode = settings.stageMediaFrameRateMode;
    this.limiter = new PreviewFrameLimiter(frameRateForMode(this.frameRateMode)); this.stamp = null;
  }
  async ready(second, signal) {
    signal.throwIfAborted();
    await this.pending;
    signal.throwIfAborted();
    if (this.decoder) await this.decoder.at(second);
    else if (this.browserFrames) await this.browserFrames.ready(signal);
    signal.throwIfAborted();
  }
  beginSeek() { this.browserFrames?.beginSeek(); }
  tick(now, second, visible, width, height, force = false, rate = 1) {
    this.canvas.hidden = !visible;
    document.body.classList.toggle("pv-surface-active", visible);
    if (!visible) return;
    if (this.busy) return this.pending;
    if (!force && !this.limiter.accept(now)) return;
    this.canvas.style.opacity = this.video.style.opacity;
    const frame = this.decoder ? null : this.browserFrames?.at(second, rate);
    if (!this.decoder && !frame) return;
    const stamp = `${this.decoder ? second : frame.timestamp}:${width}:${height}:${this.placementRevision}`;
    if (this.stamp === stamp || !this.decoder && (this.video.readyState < 2 || this.video.seeking)) return;
    const generation = this.generation;
    this.busy = true;
    this.pending = this.present(second, width, height, frame).then(source => { if (source && generation === this.generation) this.stamp = stamp; }, error => {
      if (generation === this.generation && error.name !== "AbortError") this.failed(error);
    }).finally(() => { this.busy = false; });
    return this.pending;
  }
  async present(second, width, height, frame) {
    const generation = this.generation;
    const source = this.decoder ? await this.decoder.at(second) : frame.image;
    if (!source) return null;
    if (generation !== this.generation) return this.canvas;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.context.fillStyle = "black"; this.context.fillRect(0, 0, width, height);
    drawStageVideo(this.context, source, this.geometry(this.video)); ++this.frames;
    this.timestamp = this.decoder?.timestamp ?? frame.timestamp;
    return this.canvas;
  }
  invalidatePlacement() { this.placementRevision = (this.placementRevision || 0) + 1; }
  clear() {
    ++this.generation; this.decoder?.close(); this.browserFrames?.close(); this.browserFrames = null;
    this.decoder = null; this.blob = null; this.stamp = null; this.frames = 0; this.timestamp = undefined;
    this.canvas.hidden = true; document.body.classList.remove("pv-surface-active");
    this.canvas.width = this.canvas.height = 0;
  }
}

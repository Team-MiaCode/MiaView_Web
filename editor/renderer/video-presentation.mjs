import { SoftwareVideoFrames } from "./software-video.mjs";
import { PreviewFrameLimiter } from "./frame-rate.mjs";
import { frameRateForMode } from "./performance-settings.mjs";
import { drawStageVideo } from "./video-geometry.mjs";

export class VideoPresentation {
  constructor(canvas, geometry, failed) {
    this.canvas = canvas; this.context = canvas.getContext("2d", { alpha: false }); this.geometry = geometry; this.failed = failed;
    this.limiter = new PreviewFrameLimiter(60); this.frames = 0; this.frameRateMode = 1; this.generation = 0; this.software = false;
  }
  async prepare(blob, software = this.software) { return blob && software ? SoftwareVideoFrames.open(blob) : null; }
  commit(video, blob, decoder) {
    ++this.generation; this.decoder?.close(); this.decoder = decoder; this.video = video; this.blob = blob;
    this.stamp = null; this.frames = 0;
    if (decoder) video.pause();
  }
  async configure(settings) {
    const decoder = settings.videoDecodePrefersSoftware === this.software ? this.decoder : await this.prepare(this.blob, settings.videoDecodePrefersSoftware);
    if (decoder !== this.decoder) this.commit(this.video, this.blob, decoder);
    this.software = settings.videoDecodePrefersSoftware; this.frameRateMode = settings.stageMediaFrameRateMode;
    this.limiter = new PreviewFrameLimiter(frameRateForMode(this.frameRateMode)); this.stamp = null;
  }
  tick(now, second, visible, width, height) {
    this.canvas.hidden = !visible;
    document.body.classList.toggle("pv-surface-active", visible);
    if (!visible || this.busy || !this.limiter.accept(now)) return;
    this.canvas.style.opacity = this.video.style.opacity;
    const stamp = `${this.decoder ? second : this.video.currentTime}:${width}:${height}:${this.placementRevision}`;
    if (this.stamp === stamp || !this.decoder && (this.video.readyState < 2 || this.video.seeking)) return;
    const generation = this.generation;
    this.busy = true;
    void this.present(second, width, height).then(() => { if (generation === this.generation) this.stamp = stamp; }, error => {
      if (generation === this.generation && error.name !== "AbortError") this.failed(error);
    }).finally(() => { this.busy = false; });
  }
  async present(second, width, height) {
    const generation = this.generation;
    const source = this.decoder ? await this.decoder.at(second) : this.video;
    if (generation !== this.generation) return this.canvas;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.context.fillStyle = "black"; this.context.fillRect(0, 0, width, height);
    drawStageVideo(this.context, source, this.geometry(source)); ++this.frames;
    return this.canvas;
  }
  invalidatePlacement() { this.placementRevision = (this.placementRevision || 0) + 1; }
  clear() {
    ++this.generation; this.decoder?.close(); this.decoder = null; this.blob = null; this.stamp = null; this.frames = 0;
    this.canvas.hidden = true; document.body.classList.remove("pv-surface-active");
  }
}

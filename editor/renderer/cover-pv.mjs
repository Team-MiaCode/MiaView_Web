import { seekVideo } from "./video-export.mjs";
import { SoftwareVideoFrames } from "./software-video.mjs";
import { PreviewFrameLimiter } from "./frame-rate.mjs";
import { frameRateForMode } from "./performance-settings.mjs";

const usesPv = layer => layer.kind === "chartFrame" && layer.visible !== false && ["pv", "pvFit"].includes(layer.frameBgMode);

// Native owns the composition and chart clock. The browser supplies decoded
// frames to the upstream cover image provider, including each inactive layer.
export class CoverPvFrames {
  constructor({ load, upload, failed }) {
    Object.assign(this, { load, upload, failed });
    this.pending = Promise.resolve();
    this.decoders = []; this.software = false; this.limiter = new PreviewFrameLimiter(60); this.liveGeneration = 0;
    this.frames = 0; this.rejectedFrames = 0; this.timestamp = 0; this.requestedTime = 0;
    this.images = new Map();
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
    this.videos = [0, 1].map(() => {
      const video = document.createElement("video");
      video.muted = true; video.playsInline = true;
      return video;
    });
  }
  async setSource(blob) {
    this.clear();
    if (!blob) return;
    this.blob = blob;
    const controller = this.controller = new AbortController();
    try {
      for (const video of this.videos) this.urls.push(await this.load(blob, controller.signal, video));
      if (this.software) this.decoders = await this.openDecoders();
      controller.signal.throwIfAborted();
      this.available = true;
    } catch (error) {
      controller.abort(); this.clear(); throw error;
    }
  }
  async openDecoders() {
    const results = await Promise.allSettled(this.videos.map(() => SoftwareVideoFrames.open(this.blob)));
    const failed = results.find(result => result.status === "rejected");
    if (failed) { for (const result of results) if (result.status === "fulfilled") result.value.close(); throw failed.reason; }
    return results.map(result => result.value);
  }
  async configure(settings) {
    const software = settings.videoDecodePrefersSoftware;
    if (software !== this.software) {
      const decoders = software && this.blob ? await this.openDecoders() : [];
      this.stopLive(); for (const decoder of this.decoders) decoder.close();
      this.decoders = decoders; this.software = software; this.images.clear();
    }
    this.limiter = new PreviewFrameLimiter(frameRateForMode(settings.stageMediaFrameRateMode));
    if (this.available && this.state) await this.update(this.state);
  }
  update(state) {
    this.state = state;
    this.observedAt = performance.now();
    if (this.queued) return this.pending;
    this.queued = true;
    const task = this.pending.then(async () => {
      this.queued = false;
      if (this.available) await this.refresh(this.state, false);
    });
    this.pending = task.catch(() => {});
    return task;
  }
  async refresh(state, exporting) {
    const signal = this.controller.signal;
    const layers = state.layout.layers.filter(usesPv).map(layer => ({ ...layer }));
    const active = state.chartFramePlaying && !exporting ? layers.find(layer => layer.key === state.activeLayerKey) : null;
    if (this.liveKey !== active?.key) this.stopLive();
    const still = this.videos[1];
    for (const layer of layers) {
      if (layer === active) continue;
      const side = exporting ? Math.min(4096, Math.ceil(Math.min(state.outputWidth, state.outputHeight) * layer.sizeFraction)) : 1024;
      const stamp = `${layer.frameSeconds}:${side}`;
      if (this.images.get(layer.key) === stamp && layer.pvFrameRevision >= 0) continue;
      const source = this.software ? await this.decoders[1].at(layer.frameSeconds) : still;
      if (!this.software) await seekVideo(still, layer.frameSeconds, signal);
      signal.throwIfAborted();
      const current = this.state.layout.layers.find(item => item.key === layer.key);
      if (!current || current.frameSeconds !== layer.frameSeconds || !usesPv(current)) continue;
      if (this.copy(source, layer.key, layer.frameSeconds, side, this.software ? this.decoders[1].timestamp : still.currentTime)) {
        this.images.set(layer.key, stamp);
        current.pvFrameRevision = Math.max(0, (current.pvFrameRevision ?? -1) + 1);
      }
    }
    for (const key of this.images.keys()) if (!layers.some(layer => layer.key === key)) this.images.delete(key);
    if (!active) return;
    const video = this.videos[0], time = Math.min(active.frameSeconds, Math.max(0, video.duration - .000001));
    if (!this.software && Math.abs(video.currentTime - time) > .15) await seekVideo(video, time, signal);
    signal.throwIfAborted();
    if (this.state.activeLayerKey !== active.key || !this.state.chartFramePlaying) return;
    this.images.delete(active.key);
    if (!this.liveKey) {
      this.liveKey = active.key;
      if (!this.software) await video.play();
      this.liveFrame();
    }
  }
  copy(video, key, seconds, side, timestamp = seconds) {
    const sourceWidth = video.videoWidth || video.width, sourceHeight = video.videoHeight || video.height;
    const ratio = Math.min(1, side / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio)), height = Math.max(1, Math.round(sourceHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.context.drawImage(video, 0, 0, width, height);
    this.timestamp = timestamp; this.requestedTime = seconds;
    const accepted = this.upload(key, this.context.getImageData(0, 0, width, height), seconds);
    if (accepted) ++this.frames; else ++this.rejectedFrames;
    return accepted;
  }
  liveFrame() {
    const video = this.videos[0];
    const generation = this.liveGeneration;
    const present = async now => {
      if (!this.liveKey || generation !== this.liveGeneration) return;
      const layer = this.state?.layout.layers.find(layer => layer.key === this.liveKey);
      if (!layer || !this.state.chartFramePlaying || !usesPv(layer)) { this.stopLive(); return; }
      if (this.limiter.accept(now)) {
        try {
          const second = this.software ? layer.frameSeconds + (now - this.observedAt) / 1000 : video.ended ? layer.frameSeconds : video.currentTime;
          this.requestedTime = second; this.pendingFrame = generation;
          const source = this.software ? await this.decoders[0].at(second) : video;
          if (generation !== this.liveGeneration || this.liveKey !== layer.key || !this.state.chartFramePlaying) return;
          this.copy(source, layer.key, second, 1024, this.software ? this.decoders[0].timestamp : video.currentTime);
        } catch (error) { if (generation === this.liveGeneration) { this.stopLive(); if (error.name !== "AbortError") this.failed(error); } return; }
        finally { if (this.pendingFrame === generation) this.pendingFrame = null; }
      }
      this.scheduleFrame(present);
    };
    this.scheduleFrame(present);
  }
  scheduleFrame(present) {
    const video = this.videos[0];
    this.frameCallback = !this.software && video.requestVideoFrameCallback ? video.requestVideoFrameCallback(present) : requestAnimationFrame(present);
  }
  stopLive() {
    ++this.liveGeneration;
    this.liveKey = null;
    const video = this.videos[0]; video.pause();
    if (this.frameCallback !== undefined) {
      if (!this.software && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(this.frameCallback);
      else cancelAnimationFrame(this.frameCallback);
      this.frameCallback = undefined;
    }
  }
  async prepareExport(state) {
    this.state = state; this.stopLive();
    await this.pending;
    if (this.available) await this.refresh(state, true);
  }
  snapshot() { return { decoder: this.decoders.length ? "software" : "browser", frames: this.frames, rejectedFrames: this.rejectedFrames,
    timestamp: this.timestamp, requestedTime: this.requestedTime, pending: this.pendingFrame != null }; }
  clear() {
    this.controller?.abort(new DOMException("封面 PV 资源切换", "AbortError"));
    this.available = false; this.stopLive(); this.images.clear();
    this.state = null;
    for (const decoder of this.decoders) decoder.close(); this.decoders = []; this.blob = null;
    this.frames = this.rejectedFrames = this.timestamp = this.requestedTime = 0; this.pendingFrame = null;
    for (const video of this.videos) { video.removeAttribute("src"); video.load(); }
    for (const url of this.urls || []) URL.revokeObjectURL(url);
    this.urls = [];
    this.upload("", null, 0);
  }
}

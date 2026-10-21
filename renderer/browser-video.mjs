// Keep immutable decoded images across Qt's deferred render and composition.
export class BrowserVideoFrames {
  constructor(video, changed, failed) {
    this.video = video; this.changed = changed; this.frames = []; this.waiters = new Set();
    this.pendingSeek = video.seeking;
    this.fail = error => {
      this.failure = error; video.cancelVideoFrameCallback(this.callback); this.releaseFrames();
      for (const waiter of this.waiters) waiter.finish(error);
      failed(error);
    };
    this.error = () => this.fail(new Error(video.error?.message || "PV 视频帧读取失败"));
    this.onFrame = () => {
      if (this.failure) return;
      try {
        if (this.capture()) {
          if (video.seeking) this.frameDuringSeek = true;
          else this.finishSeek();
        }
      } catch (error) { this.fail(error); return; }
      this.callback = video.requestVideoFrameCallback(this.onFrame);
    };
    this.seeking = () => { if (video.seeking && !this.pendingSeek) this.beginSeek(); };
    this.seeked = () => {
      try {
        this.capture();
        // The first frame callback can precede the seek-completed event.
        if (this.frameDuringSeek) this.finishSeek();
      }
      catch (error) { this.fail(error); }
    };
    video.addEventListener("seeking", this.seeking); video.addEventListener("seeked", this.seeked);
    video.addEventListener("error", this.error);
    this.capture(); this.callback = video.requestVideoFrameCallback(this.onFrame);
  }
  beginSeek() {
    if (this.failure) return;
    this.video.cancelVideoFrameCallback(this.callback); this.releaseFrames(); this.pendingSeek = true; this.frameDuringSeek = false;
    this.changed(); this.callback = this.video.requestVideoFrameCallback(this.onFrame);
  }
  finishSeek() {
    this.pendingSeek = false; this.frameDuringSeek = false;
    for (const waiter of this.waiters) waiter.finish();
  }
  capture() {
    if (this.video.readyState < 2) return false;
    let image;
    try { image = new VideoFrame(this.video); }
    catch (error) {
      // Loaded data and seek completion can precede a decoded image's availability.
      if (error.name === "InvalidStateError") return false;
      throw error;
    }
    const timestamp = image.timestamp / 1e6;
    if (this.frames.at(-1)?.timestamp === timestamp) { image.close(); return true; }
    this.frames.push({ image, timestamp });
    if (this.frames.length > 3) this.frames.shift().image.close();
    this.changed();
    return true;
  }
  at(second, rate = 1) {
    if (this.video.seeking || this.pendingSeek || !this.frames.length) return null;
    let selected;
    for (const frame of this.frames) {
      if (frame.timestamp - second > rate / 60) continue;
      if (!selected || Math.abs(frame.timestamp - second) < Math.abs(selected.timestamp - second)) selected = frame;
    }
    return selected || this.frames.reduce((first, frame) => frame.timestamp < first.timestamp ? frame : first);
  }
  async ready(signal) {
    signal.throwIfAborted();
    if (this.failure) throw this.failure;
    if (!this.pendingSeek && !this.video.seeking && this.frames.length) return;
    const document = this.video.ownerDocument;
    const frame = document?.defaultView?.frameElement;
    if (document?.hidden || frame?.checkVisibility({ visibilityProperty: true }) === false) return;
    await new Promise((resolve, reject) => {
      const waiter = { finish: error => {
        this.waiters.delete(waiter); signal.removeEventListener("abort", abort);
        document?.removeEventListener("visibilitychange", visibility);
        error ? reject(error) : resolve();
      } };
      const abort = () => waiter.finish(signal.reason);
      // Hidden documents suspend video presentation callbacks until visible.
      const visibility = () => { if (document.hidden) waiter.finish(); };
      this.waiters.add(waiter); signal.addEventListener("abort", abort, { once: true });
      document?.addEventListener("visibilitychange", visibility);
    });
  }
  releaseFrames() { for (const { image } of this.frames) image.close(); this.frames.length = 0; }
  close() {
    this.video.cancelVideoFrameCallback(this.callback);
    this.video.removeEventListener("seeking", this.seeking); this.video.removeEventListener("seeked", this.seeked);
    this.video.removeEventListener("error", this.error);
    this.releaseFrames();
    this.failure = new DOMException("视频帧缓存关闭", "AbortError");
    for (const waiter of this.waiters) waiter.finish(this.failure);
  }
}

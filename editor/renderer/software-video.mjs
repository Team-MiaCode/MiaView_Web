// Each cursor retains its current frame and one look-ahead frame. Sequential
// playback reuses the decoder; seeking starts a new cursor at the target frame.
export class SoftwareVideoFrames {
  static async open(blob) {
    const media = await import("./vendor/mediabunny/index.mjs");
    const input = new media.Input({ source: new media.BlobSource(blob), formats: media.ALL_FORMATS });
    const frames = new SoftwareVideoFrames(input);
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("PV 文件需要视频轨道");
      frames.colorSpace = await track.getColorSpace(); frames.VideoSample = media.VideoSample;
      frames.firstTimestamp = await track.getFirstTimestamp();
      const last = await new media.EncodedPacketSink(track).getPacket(Infinity, { metadataOnly: true });
      if (!last) throw new Error("PV 文件需要视频帧");
      frames.lastTimestamp = last.timestamp;
      frames.sink = new media.VideoSampleSink(track, { hardwareAcceleration: "prefer-software" });
      await frames.at(0);
      return frames;
    } catch (error) { frames.close(); throw error; }
  }
  constructor(input) {
    this.input = input; this.canvas = document.createElement("canvas");
    // Keep software frames in CPU memory before the presentation surface uploads them.
    this.context = this.canvas.getContext("2d", { willReadFrequently: true }); this.pending = Promise.resolve();
  }
  at(second) {
    const task = this.pending.then(() => this.read(second));
    this.pending = task.catch(() => {}); return task;
  }
  async read(second) {
    if (this.closed) throw new DOMException("视频解码器关闭", "AbortError");
    const target = Math.min(Math.max(this.firstTimestamp, second), this.lastTimestamp);
    try {
      if (!this.current || target < this.current.timestamp || target > this.current.timestamp + 1) {
        await this.cursor?.return(); this.cursor = null; this.ended = false;
        this.current?.close(); this.next?.close(); this.current = this.next = null;
        const frame = await this.sink.getSample(target);
        if (this.closed) { frame?.close(); throw new DOMException("视频解码器关闭", "AbortError"); }
        this.current = frame;
        if (!this.current) throw new Error("PV 帧解码失败");
        this.cursor = this.sink.samples(this.current.timestamp);
      }
      if (this.current.timestamp >= this.lastTimestamp - .000001) this.ended = true;
      while (!this.ended) {
        if (!this.next) {
          const value = await this.cursor.next();
          if (this.closed) { value.value?.close(); throw new DOMException("视频解码器关闭", "AbortError"); }
          this.ended = value.done;
          if (value.done) break;
          this.next = value.value;
        }
        if (this.next.timestamp > target) break;
        this.current.close(); this.current = this.next; this.next = null;
        if (this.current.timestamp >= this.lastTimestamp - .000001) this.ended = true;
      }
      if (this.closed) throw new DOMException("视频解码器关闭", "AbortError");
      const frame = this.current;
      if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
        this.canvas.width = frame.displayWidth; this.canvas.height = frame.displayHeight;
      }
      // The container's color profile also governs HTML video. Preserve that
      // profile when a software decoder returns different range/transfer tags.
      const colorSpace = { ...frame.colorSpace };
      for (const key of ["primaries", "transfer", "matrix", "fullRange"])
        if (this.colorSpace[key] != null) colorSpace[key] = this.colorSpace[key];
      let image = frame;
      if (frame.format && !/RGB|BGR/.test(frame.format) && Object.keys(colorSpace).some(key => colorSpace[key] !== frame.colorSpace[key])) {
        const count = frame.allocationSize();
        if (!this.colorPixels || this.colorPixels.byteLength < count) this.colorPixels = new Uint8Array(count);
        const layout = await frame.copyTo(this.colorPixels);
        if (this.closed) throw new DOMException("视频解码器关闭", "AbortError");
        image = new this.VideoSample(this.colorPixels, { format: frame.format, layout,
          codedWidth: frame.visibleRect.width, codedHeight: frame.visibleRect.height,
          displayWidth: frame.squarePixelWidth, displayHeight: frame.squarePixelHeight,
          rotation: frame.rotation, flip: frame.flip, timestamp: frame.timestamp, duration: frame.duration, colorSpace });
      }
      try { image.draw(this.context, 0, 0, this.canvas.width, this.canvas.height); }
      finally { if (image !== frame) image.close(); }
      this.timestamp = frame.timestamp; return this.canvas;
    } catch (error) { if (this.closed) throw new DOMException("视频解码器关闭", "AbortError"); throw error; }
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.input.dispose();
    this.current?.close(); this.next?.close(); this.current = this.next = null;
    this.colorPixels = null;
    void this.cursor?.return().catch(() => {});
  }
}

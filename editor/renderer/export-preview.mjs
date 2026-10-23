import { introTrackGain } from "./intro-audition.mjs";

// The export page uses chart seconds; only its intro occupies negative time.
export class ExportPreview {
  constructor({ audio, video, frame, changed, still, presentVideo, positionVideo, softwareVideo, hidePv, ended, failed }) {
    Object.assign(this, { audio, video, frame, changed, still, presentVideo, positionVideo, softwareVideo, hidePv, ended, failed });
    this.playing = false;
    this.second = 0;
    this.request = 0;
    this.entry = 0;
    this.mediaGeneration = 0;
  }
  configure(plan, settings, second) {
    this.pause();
    this.plan = plan;
    this.settings = settings;
    this.minimum = plan.introLeadSeconds > 0 ? -plan.introLeadSeconds : 0;
    this.lastFrame = null;
    this.seek(Math.abs(second) <= .01 && this.minimum < 0 ? this.minimum : second);
  }
  position() {
    if (!this.playing) return this.second;
    if (this.second >= 0) return this.audio.currentSecond();
    const elapsed = Math.max(0, this.audio.context.currentTime - this.startedAt);
    const musicEnd = this.minimum + this.plan.introAuditionSeconds;
    if (this.settings.introPvPreview && this.audio.track && this.second < musicEnd) {
      const musicSeconds = (musicEnd - this.second) / this.audio.rate;
      return elapsed < musicSeconds ? this.second + elapsed * this.audio.rate : musicEnd + elapsed - musicSeconds;
    }
    return this.second + elapsed;
  }
  state() {
    return { active: true, currentTime: this.position(), minimum: this.minimum, duration: this.audio.duration,
      playing: this.playing, playbackEntrySeconds: this.entry, auditionPlaying: Boolean(this.audition && this.playing),
      introPvStartSeconds: this.settings.introPvStartSeconds ?? 0, fps: this.settings.fps,
      clockCountEnabled: this.settings.clockCountEnabled, clockCount: this.plan.clockCount, clockBpm: this.plan.clockBpm };
  }
  auditionState() {
    return this.audition ? { active: true, playing: this.playing, elapsed: this.position() - this.minimum,
      duration: this.plan.introAuditionSeconds, introAuditionLoop: this.audition.loop,
      introPvStartSeconds: this.settings.introPvStartSeconds ?? 0 } : null;
  }
  publish() { this.changed(this.state()); }
  stopSources() {
    ++this.mediaGeneration;
    this.audio.pause();
    this.video.pause();
    if (this.source) { this.source.stop(); this.source.disconnect(); this.source = null; }
    if (this.gain) { this.gain.disconnect(); this.gain = null; }
    this.cancelPlay?.(); this.cancelPlay = null;
  }
  pause() {
    ++this.request;
    this.second = this.position();
    this.playing = false;
    this.stopSources();
    this.still(true);
    this.lastFrame = null;
    if (this.plan) { this.tick(); this.publish(); }
  }
  clamp(second) {
    const start = this.rangeEnabled ? this.rangeStart <= .01 ? this.minimum : this.rangeStart : this.minimum;
    return Math.max(start, Math.min(this.rangeEnabled ? this.rangeEnd : this.audio.duration, second));
  }
  seek(second) {
    this.pause();
    this.audition = null;
    this.second = this.clamp(second);
    this.audio.seek(Math.max(0, this.second));
    this.lastFrame = null;
    this.tick(); this.publish();
  }
  async play() {
    if (this.playing) return;
    const request = ++this.request;
    const cancelled = new Promise(resolve => { this.cancelPlay = () => resolve(false); });
    const resumed = await Promise.race([this.audio.context.resume().then(() => true), cancelled]);
    if (!resumed || request !== this.request) return;
    this.cancelPlay = null;
    const end = this.rangeEnabled ? this.rangeEnd : this.audio.duration;
    if (this.second >= end) this.seek(this.rangeEnabled ? this.rangeStart : this.minimum);
    this.entry = this.second;
    this.start();
  }
  start() {
    this.playing = true;
    this.lastFrame = null;
    this.startedAt = this.audio.context.currentTime;
    this.still(false);
    this.startSources(); this.tick(); this.publish();
  }
  startSources() {
    if (this.second >= 0) { this.audio.seek(this.second); this.audio.start(); this.startVideo(this.second); return; }
    const elapsed = this.second - this.minimum;
    const pv = this.settings.introPvPreview;
    if (pv) this.startVideo((this.settings.introPvStartSeconds ?? 0) + elapsed);
    const clip = pv ? this.plan.introPreviewTrack : { enabled: true, sourceStartSecond: 0, durationSeconds: -this.minimum, gain: this.audio.mixBuses.get("track_start")?.gain.value ?? 1 };
    const track = pv ? this.audio.track : this.audio.buffers.get("track_start.wav");
    if (!pv && elapsed > .1) return;
    if (!track || !clip.enabled || elapsed >= clip.durationSeconds || clip.sourceStartSecond + elapsed >= track.duration) return;
    const source = this.source = this.audio.context.createBufferSource(), gain = this.gain = this.audio.context.createGain();
    source.buffer = track; source.playbackRate.value = pv ? this.audio.rate : 1;
    source.connect(gain); gain.connect(this.audio.context.destination);
    gain.gain.value = pv ? introTrackGain(this.plan, elapsed) : clip.gain;
    source.start(this.audio.context.currentTime, clip.sourceStartSecond + elapsed,
      Math.min(clip.durationSeconds - elapsed, track.duration - clip.sourceStartSecond - elapsed));
  }
  startVideo(second) {
    if (!this.video.src || this.hidePv() || this.softwareVideo()) return;
    this.positionVideo(second);
    this.video.playbackRate = this.audio.rate;
    const generation = this.mediaGeneration;
    if (second < this.video.duration - .02) void this.video.play().catch(error => {
      if (this.playing && generation === this.mediaGeneration) this.failed(error);
    });
  }
  stop() {
    const entry = this.entry;
    this.seek(entry);
  }
  setRange(enabled, start, end) {
    this.rangeEnabled = enabled; this.rangeStart = start; this.rangeEnd = end;
    if (enabled && (this.position() < (start <= .01 ? this.minimum : start) || this.position() > end)) this.seek(start <= .01 ? this.minimum : start);
    this.publish();
  }
  setRate(rate) {
    const playing = this.playing;
    this.pause(); this.audio.setRate(rate);
    if (playing) this.start();
  }
  async auditionIntro(loop = false) {
    if (this.audition) {
      const restore = this.audition.restore;
      this.seek(restore); return;
    }
    const restore = this.position();
    const start = restore < 0 && restore < this.minimum + this.plan.introPvSegmentSeconds ? restore : this.minimum;
    this.seek(start);
    await this.play();
    if (this.playing) this.audition = { restore, start, end: this.minimum + this.plan.introAuditionSeconds, loop };
    this.publish();
  }
  tick() {
    let second = this.position();
    if (this.playing && this.audition && second >= this.audition.end) {
      const { restore, start, loop } = this.audition;
      if (loop) {
        const audition = this.audition;
        this.seek(start);
        this.audition = audition; this.start();
      } else this.seek(restore);
      return;
    }
    if (this.playing && this.second < 0 && second >= 0) {
      this.stopSources(); this.second = Math.max(0, second); this.startSources();
    }
    const end = this.rangeEnabled ? this.rangeEnd : this.audio.duration;
    if (this.playing && second >= end) {
      this.seek(this.rangeEnabled ? this.rangeStart <= .01 ? this.minimum : this.rangeStart : end);
      this.ended(); return;
    }
    const frame = Math.floor(second * this.settings.fps);
    if (this.lastFrame !== frame) {
      this.lastFrame = frame;
      const info = this.frame(second);
      this.mediaSecond = info.mediaSecond;
      this.presentVideo(info.mediaSecond);
      if (this.video.src && !this.hidePv()) {
        this.video.style.opacity = String(second < 0 && this.playing ? info.mediaOpacity : 1);
        const target = Math.min(info.mediaSecond, Math.max(0, this.video.duration - .000001));
        if (!this.softwareVideo() && Math.abs(this.video.currentTime - target) > (this.playing ? .1 : .000001)) this.positionVideo(target);
      }
    }
    if (second < 0 && this.gain && this.settings.introPvPreview) this.gain.gain.value = introTrackGain(this.plan, second - this.minimum);
    if (this.playing && second >= 0) this.audio.schedule();
  }
  destroy() { this.pause(); this.video.style.opacity = ""; }
}

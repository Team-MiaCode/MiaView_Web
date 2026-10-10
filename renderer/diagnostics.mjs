const initializationMetrics = new Set([
  "engineLoad",
  "engineInit",
  "chartLoad",
  "maidataRead",
  "audioRead",
  "audioDecode",
  "coverRead",
  "videoAssetRead",
  "videoReady",
  "musicAndSfxReady",
  "chartParse",
  "backgroundDecode",
]);
// Opt-in, bounded diagnostics. Timing samples describe synchronous host work;
// Qt frameSwapped counts are reported separately from RAF callbacks.
export class PreviewDiagnostics {
  constructor({
    clock = () => performance.now(),
    context = () => ({}),
    publish = () => {},
    historyLimit = 600,
    initializationOnly = false,
    playbackOnly = false,
    playbackActive,
  } = {}) {
    this.initializationOnly = initializationOnly;
    this.playbackOnly = playbackOnly;
    this.playbackActive = playbackActive;
    this.clock = clock;
    this.context = context;
    this.publish = publish;
    this.historyLimit = historyLimit;
    this.enabled = false;
    this.reset();
  }
  reset() {
    this.observer?.takeRecords();
    this.history = [];
    this.sequence = 0;
    this.startedAt = new Date().toISOString();
    this.metrics = new Map();
    this.counters = {};
    this.errors = [];
    this.loadingSteps = [];
    this.lastHostFrame = null;
    this.windowStart = this.clock();
    this.captureStart = this.windowStart;
    this.previousPresented = this.context().presentedFrames ?? 0;
    return this.snapshot();
  }
  setEnabled(enabled) {
    if (typeof enabled !== "boolean")
      throw new Error("diagnostics must be a boolean");
    if (enabled === this.enabled) return this.snapshot();
    if (!enabled && !this.playbackOnly) this.flush();
    if (this.playbackOnly) {
      this.metrics.clear();
      this.counters = {};
      this.lastHostFrame = null;
    }
    this.enabled = enabled;
    clearInterval(this.timer);
    this.timer = undefined;
    this.observer?.disconnect();
    this.observer = null;
    this.lastHostFrame = null;
    this.windowStart = this.clock();
    this.captureStart = this.windowStart;
    this.previousPresented = this.context().presentedFrames ?? 0;
    if (enabled && !this.initializationOnly) {
      if (
        globalThis.PerformanceObserver?.supportedEntryTypes?.includes(
          "longtask",
        )
      ) {
        this.observer = new PerformanceObserver((list) =>
          this.longTasks(list.getEntries()),
        );
        this.observer.observe({ type: "longtask" });
      }
      this.timer = setInterval(() => this.flush(), 1000);
    }
    return this.snapshot();
  }
  record(name, ms) {
    if (
      !this.enabled ||
      (this.playbackOnly && !this.isPlaying()) ||
      (this.initializationOnly && !initializationMetrics.has(name)) ||
      !Number.isFinite(ms) ||
      ms < 0
    )
      return;
    let metric = this.metrics.get(name);
    if (!metric)
      this.metrics.set(
        name,
        (metric = { count: 0, sum: 0, max: 0, samples: [] }),
      );
    metric.sum += ms;
    metric.max = Math.max(metric.max, ms);
    metric.samples[metric.count % 4096] = ms;
    metric.count++;
  }
  measure(name, action) {
    if (
      !this.enabled ||
      (this.playbackOnly && !this.isPlaying()) ||
      (this.initializationOnly && !initializationMetrics.has(name))
    )
      return action();
    const start = this.clock();
    try {
      return action();
    } finally {
      this.record(name, this.clock() - start);
    }
  }
  async measureAsync(name, action) {
    if (
      !this.enabled ||
      (this.playbackOnly && !this.isPlaying()) ||
      (this.initializationOnly && !initializationMetrics.has(name))
    )
      return action();
    const start = this.clock();
    const enabled = this.enabled;
    try {
      return await action();
    } finally {
      if (enabled) this.record(name, this.clock() - start);
    }
  }
  async measureLoadingStep(kind, resource, loadId, loadStart, action) {
    if (!this.enabled) return action();
    const start = this.clock();
    let status = "ok",
      result;
    try {
      result = await action();
      return result;
    } catch (error) {
      status =
        error?.name === "TimeoutError"
          ? "timeout"
          : error?.name === "AbortError"
            ? "cancelled"
            : "error";
      throw error;
    } finally {
      const end = this.clock();
      if (this.enabled && this.loadingSteps.length < 64) {
        this.loadingSteps.push({
          kind,
          resource: String(resource)
            .replace(/[^a-zA-Z0-9_.-]/g, "_")
            .slice(0, 128),
          loadId,
          startMs: start - loadStart,
          durationMs: end - start,
          endMs: end - loadStart,
          status,
          ...(Number.isFinite(result?.byteLength ?? result?.size)
            ? { byteSize: result.byteLength ?? result.size }
            : {}),
        });
      }
    }
  }
  error(stage, error) {
    if (!this.enabled) return;
    const message = String(error?.message ?? error ?? "Unknown error")
      .replace(/https?:\/\/[^\s]+/g, "[resource URL]")
      .replace(/[\r\n\t]/g, " ")
      .slice(0, 512);
    if (this.errors.length < 8) this.errors.push({ stage, message });
  }
  count(name, amount = 1) {
    if (
      this.enabled &&
      (!this.playbackOnly || this.isPlaying()) &&
      (!this.initializationOnly || name === "videoLoadTimeouts")
    )
      this.counters[name] = (this.counters[name] ?? 0) + amount;
  }
  hostFrame(now, playing) {
    if (this.initializationOnly || !this.enabled) return;
    if (!playing) {
      this.lastHostFrame = null;
      return;
    }
    if (this.lastHostFrame !== null) {
      const interval = now - this.lastHostFrame;
      this.record("hostInterval", interval);
      if (interval > 50) this.count("hostGapsOver50ms");
    }
    this.lastHostFrame = now;
    this.count("hostFrames");
  }
  longTasks(entries) {
    for (const entry of entries) {
      // Do not carry buffered entries from before a reset into the new window.
      if (entry.startTime >= this.captureStart)
        this.record("longTask", entry.duration);
    }
  }
  isPlaying() {
    if (this.playbackActive) return this.playbackActive();
    const context = this.context();
    return context.loaded === true && context.playing === true;
  }
  flush() {
    if (!this.enabled || (this.playbackOnly && !this.isPlaying())) return null;
    if (
      this.initializationOnly &&
      !this.metrics.size &&
      !this.errors.length &&
      !this.loadingSteps.length &&
      !Object.keys(this.counters).length
    )
      return null;
    if (this.observer) this.longTasks(this.observer.takeRecords());
    const now = this.clock(),
      durationMs = now - this.windowStart;
    if (durationMs <= 0) return null;
    const context = this.context();
    const metrics = {};
    for (const [name, value] of this.metrics) {
      const samples = value.samples.slice().sort((a, b) => a - b);
      metrics[name] = {
        count: value.count,
        meanMs: value.sum / value.count,
        p95Ms: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)],
        maxMs: value.max,
        sampledCount: samples.length,
      };
    }
    const presented = context.presentedFrames ?? this.previousPresented;
    const report = {
      schemaVersion: 1,
      ...(this.initializationOnly ? { logKind: "initialization" } :
        this.playbackOnly ? { logKind: "performance" } : {}),
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      durationMs,
      ...context,
      presentedFps:
        (Math.max(0, presented - this.previousPresented) * 1000) / durationMs,
      metrics,
      counters: { ...this.counters },
      errors: this.errors.slice(),
      loadingSteps: this.loadingSteps.slice(),
    };
    this.previousPresented = presented;
    this.windowStart = now;
    this.metrics.clear();
    this.counters = {};
    this.errors = [];
    this.loadingSteps = [];
    this.history.push(report);
    if (this.history.length > this.historyLimit) this.history.shift();
    this.publish(report);
    return report;
  }
  snapshot() {
    return {
      schemaVersion: 1,
      enabled: this.enabled,
      startedAt: this.startedAt,
      historyLimit: this.historyLimit,
      reports: this.history.slice(),
      definitions: {
        hostInterval:
          "Accepted host ticks during playback; not GPU presentation intervals. Long gaps exceed 50ms.",
        hostWork:
          "Synchronous JS frame work and WASM calls; excludes browser video composition and deferred Qt render/GPU work.",
        wasmTick:
          "Synchronous miacode_tick; excludes deferred scene graph rendering.",
        videoPipeline:
          "browser-compositor means the DOM video is composed below the transparent Qt canvas; no video pixels are copied into WASM.",
        presentedFps:
          "Qt frameSwapped delta / actual sample duration; may include paused redraws.",
        audioScheduleLate:
          "Scheduling lateness versus chart time, not measured speaker latency; late events exceed 5ms.",
        wasmHeapBytes:
          "WASM linear memory capacity, not live allocation usage.",
        p95: "Nearest-rank percentile; at most the latest 4096 samples per metric per report.",
      },
    };
  }
  dispose() {
    if (this.enabled && !this.playbackOnly) this.flush();
    this.enabled = false;
    clearInterval(this.timer);
    this.timer = undefined;
    this.observer?.disconnect();
  }
}

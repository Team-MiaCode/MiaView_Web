export class PreviewAnalysis {
  constructor(identity, manifest, { WorkerClass = Worker, baseUrl = import.meta.url } = {}) {
    this.pending = new Map(); this.sequence = 0;
    const workerUrl = new URL("analysis-worker.mjs", baseUrl);
    workerUrl.searchParams.set("build", identity.version);
    const resources = ["miacode-analysis.js", "miacode-analysis.wasm"].map(path => {
      const file = manifest.files.find(file => file.path === path);
      if (!file) throw new Error("谱面分析运行时资源缺失");
      const url = new URL(path, baseUrl); url.searchParams.set("build", identity.version);
      return { url: url.href, sha256: file.sha256, byteSize: file.byteSize };
    });
    this.worker = new WorkerClass(workerUrl, { type: "module", name: "MiaCode analysis" });
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.value);
    };
    this.worker.onerror = event => {
      event.preventDefault();
      this.close(new Error(event.message || "谱面分析任务中断"));
    };
    this.ready = this.request("initialize", resources);
    void this.ready.catch(() => {});
  }
  request(type, payload) {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }
  analyze(input) {
    const key = [input.documentOpenGeneration, input.revision, input.difficultyId, input.language, input.renderMode,
      input.handRadiusPx, input.wifiNeedC, input.staticTapOnSlideThresholdMs].join(":");
    if (this.cache?.key === key) return this.cache.result;
    const result = this.ready.then(() => this.request("analyze", input));
    this.cache = { key, result }; return result;
  }
  close(error = new Error("谱面分析实例关闭")) {
    if (this.closed) return;
    this.closed = error;
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear(); this.cache = null;
  }
}

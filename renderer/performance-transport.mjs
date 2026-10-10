// Logs go to the renderer's own backend, even when its iframe is cross-origin.
// Failures are surfaced to the Dev panel, never printed in browser consoles.
export class PerformanceTransport {
  constructor({
    url = new URL("../__performance", import.meta.url),
    fetcher = (...args) => globalThis.fetch(...args),
    publish = () => {},
  } = {}) {
    this.url = url;
    this.fetcher = fetcher;
    this.publish = publish;
    this.sessionId = crypto.randomUUID();
    this.pending = 0;
    this.queue = Promise.resolve();
    this.retryAfter = 0;
  }
  send(report) {
    if (this.pending >= 60 || Date.now() < this.retryAfter) {
      this.publish({
        ...report,
        backendLog: { ok: false, message: "后台日志暂不可用或写入队列已满" },
      });
      return Promise.resolve();
    }
    ++this.pending;
    this.queue = this.queue
      .then(async () => {
        if (Date.now() < this.retryAfter) {
          this.publish({
            ...report,
            backendLog: { ok: false, message: "等待后台日志连接恢复" },
          });
          return;
        }
        const response = await this.fetcher(this.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ sessionId: this.sessionId, report }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const log = await response.json();
        if (typeof log.text !== "string") throw new Error("后台日志响应无效");
        this.publish({ ...report, backendLog: { ok: true, ...log } });
      })
      .catch((error) => {
        this.retryAfter = Date.now() + 30000;
        this.publish({
          ...report,
          backendLog: { ok: false, message: error.message },
        });
      })
      .finally(() => {
        --this.pending;
      });
    return this.queue;
  }
}

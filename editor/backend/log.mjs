import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const metricLabels = {
  engineLoad: "引擎下载、校验及编译",
  engineInit: "Qt 引擎初始化",
  chartLoad: "谱面加载总耗时",
  maidataRead: "谱面读取",
  audioRead: "音乐读取",
  audioDecode: "音乐解码",
  coverRead: "封面读取",
  videoAssetRead: "PV 完整数据取得（下载/缓存/本地，含校验）",
  videoReady: "PV 首帧准备",
  musicAndSfxReady: "音乐及音效剩余等待",
  hostInterval: "宿主 tick 间隔（播放）",
  hostWork: "主线程帧工作",
  wasmTick: "WASM 场景更新",
  videoDraw: "视频 Canvas 绘制",
  videoRead: "视频像素读取",
  videoCopy: "视频复制到 WASM",
  wasmVideo: "WASM 视频接收",
  audioSchedule: "音效调度",
  audioScheduleLate: "音效晚调度",
  chartParse: "谱面解析及场景准备",
  settings: "设置更新",
  seek: "跳转",
  backgroundDecode: "背景解码",
  longTask: "浏览器长任务",
};
const number = (value) => (Number.isFinite(value) ? value : 0);
export function formatPerformanceReport(sessionId, report, receivedAt) {
  const c = report.counters ?? {};
  const initializing = report.logKind === "initialization";
  const lines = initializing
    ? [
        `[MiaView initialization] ${receivedAt} session=${sessionId} #${report.sequence}`,
      ]
    : [
        `[MiaView performance] ${receivedAt} session=${sessionId} #${report.sequence}`,
        `${report.playing ? "播放" : "暂停"} ${number(report.currentTime).toFixed(2)}s | ${number(report.presentedFps).toFixed(1)} FPS | ${number(report.resolution?.width)}×${number(report.resolution?.height)} | 窗口 ${number(report.durationMs).toFixed(0)}ms`,
        `长帧 ${number(c.hostGapsOver50ms)} | 音效晚调度 ${number(c.audioLateEvents)} | 视频上传 ${number(c.videoUploads)} 帧 / ${(number(c.videoBytes) / 1048576).toFixed(1)} MiB | WASM 容量 ${(number(report.wasmHeapBytes) / 1048576).toFixed(1)} MiB`,
      ];
  const phases = {
    "engine-load": "引擎加载",
    "engine-init": "Qt 初始化",
    "chart-load": "谱面加载",
    ready: "已就绪",
    error: "发生错误",
  };
  if (
    phases[report.phase] &&
    (initializing || !report.ready || report.phase !== "ready")
  )
    lines.push(
      `阶段 ${phases[report.phase]} | 播放器${report.ready ? "已就绪" : "尚未就绪"}`,
    );
  for (const error of Array.isArray(report.errors)
    ? report.errors.slice(0, 8)
    : []) {
    if (typeof error?.message !== "string") continue;
    lines.push(
      `  错误（${phases[error.stage] ?? "播放器"}）: ${error.message.replace(/[\r\n\t]/g, " ").slice(0, 512)}`,
    );
  }
  if (c.videoLoadTimeouts)
    lines.push(
      `PV 加载超时 ${number(c.videoLoadTimeouts)} 次 | 已取消并跳过，不再重试`,
    );
  if (!initializing && ["browser-canvas", "software-canvas"].includes(report.videoPipeline))
    lines.push(
      `视频路径 ${report.videoPipeline} | 呈现 ${number(report.videoPresentedFrames)} | 解码 ${report.videoDecodedFrames == null ? "—" : number(report.videoDecodedFrames)} | 丢帧 ${report.videoDroppedFrames == null ? "—" : number(report.videoDroppedFrames)} | 重同步 ${number(c.videoResyncs)}`,
    );
  for (const [name, metric] of Object.entries(report.metrics)) {
    if (!metricLabels[name]) continue;
    if (initializing) {
      lines.push(
        `  ${metricLabels[name]}: ${(number(metric?.meanMs) * number(metric?.count)).toFixed(2)}ms`,
      );
      continue;
    }
    lines.push(
      `  ${metricLabels[name]}: n=${number(metric?.count)} avg=${number(metric?.meanMs).toFixed(2)}ms p95=${number(metric?.p95Ms).toFixed(2)}ms max=${number(metric?.maxMs).toFixed(2)}ms`,
    );
  }
  if (initializing && Array.isArray(report.loadingSteps)) {
    const labels = {
      ...metricLabels,
      sfxRead: "音效下载",
      sfxDecode: "音效解码",
    };
    const steps = report.loadingSteps
      .slice(0, 64)
      .filter(
        (step) =>
          labels[step?.kind] &&
          Number.isFinite(step.startMs) &&
          Number.isFinite(step.durationMs) &&
          Number.isFinite(step.endMs),
      )
      .sort((a, b) => a.endMs - b.endMs);
    if (steps.length) {
      lines.push("  资源时间线（相对本次加载开始，并行耗时不能相加）：");
      for (const step of steps) {
        const resource =
          typeof step.resource === "string"
            ? step.resource.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 128)
            : "";
        const size = Number.isFinite(step.byteSize)
          ? ` | ${(step.byteSize / 1048576).toFixed(2)} MiB`
          : "";
        const status =
          { ok: "完成", timeout: "超时", cancelled: "取消", error: "失败" }[
            step.status
          ] ?? "未知";
        lines.push(
          `    加载 #${number(step.loadId)} ${labels[step.kind]}${resource ? ` ${resource}` : ""}: 开始 +${step.startMs.toFixed(2)}ms | 耗时 ${step.durationMs.toFixed(2)}ms | 结束 +${step.endMs.toFixed(2)}ms | ${status}${size}`,
        );
      }
      const last = steps.at(-1);
      lines.push(
        `  本批日志最晚结束的资源步骤：${labels[last.kind]} ${String(
          last.resource ?? "",
        )
          .replace(/[^a-zA-Z0-9_.-]/g, "_")
          .slice(0, 128)}（+${last.endMs.toFixed(2)}ms）`,
      );
    }
  }
  return lines.join("\n");
}

// Clients cannot choose file paths or change backend output settings.
export function performanceLogger({
  directory = null,
  terminal = true,
  writeTerminal = (text) => console.log(text),
} = {}) {
  const path = directory
    ? join(directory, `performance-${Date.now()}-${randomUUID()}.jsonl`)
    : null;
  let queue = Promise.resolve();
  return async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    let originHost;
    try {
      const origin = new URL(req.headers.origin);
      if (["http:", "https:"].includes(origin.protocol))
        originHost = origin.host;
    } catch {}
    if (
      originHost !== req.headers.host ||
      req.headers["content-type"] !== "application/json"
    ) {
      res.writeHead(403).end();
      return;
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !/^[a-f0-9-]{36}$/i.test(body.sessionId ?? "") ||
        body.report?.schemaVersion !== 1 ||
        !Number.isInteger(body.report.sequence) ||
        !Number.isFinite(body.report.durationMs) ||
        body.report.durationMs <= 0 ||
        !body.report.metrics ||
        typeof body.report.metrics !== "object"
      ) {
        res.writeHead(400).end();
        return;
      }
      const receivedAt = new Date().toISOString();
      const text = formatPerformanceReport(
        body.sessionId,
        body.report,
        receivedAt,
      );
      if (terminal) writeTerminal(text);
      if (path) {
        const line = JSON.stringify({ receivedAt, ...body, text }) + "\n";
        const write = queue.then(async () => {
          await mkdir(directory, { recursive: true });
          await appendFile(path, line);
        });
        queue = write.catch(() => {});
        await write;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          text,
          terminalEnabled: terminal,
          fileEnabled: Boolean(path),
        }),
      );
    } catch (error) {
      if (error instanceof SyntaxError) res.writeHead(400).end();
      else {
        console.error("Performance log write failed:", error.message);
        res.writeHead(500).end();
      }
    }
  };
}

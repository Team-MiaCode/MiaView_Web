export const DEFAULT_MAX_FPS = 60;

export function previewMaxFps(value = DEFAULT_MAX_FPS) {
  if (value === "unlimited") return value;
  if (!Number.isSafeInteger(value) || value < 30)
    throw new Error('最大预览帧率须为不小于 30 的整数或 "unlimited"');
  return value;
}

export function maxFpsFromSearch(search) {
  const params = new URLSearchParams(search);
  if (!params.has("maxFps")) return DEFAULT_MAX_FPS;
  const values = params.getAll("maxFps");
  if (
    values.length !== 1 ||
    (values[0] !== "unlimited" && !/^[1-9]\d*$/.test(values[0]))
  )
    throw new Error("最大预览帧率参数无效");
  return previewMaxFps(values[0] === "unlimited" ? values[0] : Number(values[0]));
}

export class PreviewFrameLimiter {
  constructor(maxFps = DEFAULT_MAX_FPS) {
    this.maxFps = previewMaxFps(maxFps);
    this.interval = this.maxFps === "unlimited" ? 0 : 1000 / this.maxFps;
    this.nextFrameTime = -Infinity;
  }
  accept(now) {
    if (!this.interval) return true;
    if (now + Math.min(0.5, this.interval / 2) < this.nextFrameTime) return false;
    // Keep fractional deadlines on high-refresh screens; skip catch-up after
    // a stall instead of accumulating frames that can no longer be presented.
    this.nextFrameTime =
      Number.isFinite(this.nextFrameTime) &&
      now - this.nextFrameTime < this.interval
        ? this.nextFrameTime + this.interval
        : now + this.interval;
    return true;
  }
}

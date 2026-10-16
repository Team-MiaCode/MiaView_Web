export const DEFAULT_PERFORMANCE = Object.freeze({ canvasFrameRateMode: 1, stageMediaFrameRateMode: 1, videoDecodePrefersSoftware: false });

export function frameRateForMode(mode) {
  if (!Number.isInteger(mode) || mode < 0 || mode > 3) throw new Error("帧率模式须为 0 至 3");
  return [30, 60, 120, "unlimited"][mode];
}

export function performanceSettings(current, changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("性能设置需要对象");
  for (const [key, value] of Object.entries(changes)) {
    if (key === "videoDecodePrefersSoftware") {
      if (typeof value !== "boolean") throw new Error("视频解码偏好需要布尔值");
    } else if (["canvasFrameRateMode", "stageMediaFrameRateMode"].includes(key)) frameRateForMode(value);
    else throw new Error(`性能字段无效：${key}`);
  }
  return { ...current, ...changes };
}

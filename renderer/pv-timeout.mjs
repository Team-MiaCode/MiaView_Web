export const DEFAULT_PV_TIMEOUT_MS = 30000;

export function previewPvTimeout(value = DEFAULT_PV_TIMEOUT_MS) {
  if (value === "unlimited") return value;
  if (!Number.isSafeInteger(value) || value < 10000)
    throw new Error('PV 超时须为不小于 10000 的整数毫秒或 "unlimited"');
  return value;
}

export function pvTimeoutFromSearch(search) {
  const params = new URLSearchParams(search);
  if (!params.has("pvTimeoutMs")) return DEFAULT_PV_TIMEOUT_MS;
  const values = params.getAll("pvTimeoutMs");
  if (values.length !== 1 || (values[0] !== "unlimited" && !/^[1-9]\d*$/.test(values[0])))
    throw new Error("PV 超时参数无效");
  return previewPvTimeout(values[0] === "unlimited" ? "unlimited" : Number(values[0]));
}

// Browsers clamp a single timer to 2^31-1 ms. Chain long finite deadlines.
export function scheduleTimeout(callback, delay) {
  let timer, remaining = delay;
  function arm() {
    const chunk = Math.min(remaining, 2147483647);
    timer = setTimeout(() => {
      remaining -= chunk;
      if (remaining > 0) arm();
      else callback();
    }, chunk);
  }
  arm();
  return () => clearTimeout(timer);
}

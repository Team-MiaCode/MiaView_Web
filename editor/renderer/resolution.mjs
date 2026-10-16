export const DEFAULT_RESOLUTION = Object.freeze({ width: 1920, height: 1080 });
// Bound render-target and video-buffer allocations; this is not a device guarantee.
export const MAX_RENDER_DIMENSION = 4096;
export function canvasResolution(value) {
  const width=value?.width,height=value?.height;
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<=0 || height<=0 || width>MAX_RENDER_DIMENSION || height>MAX_RENDER_DIMENSION)
    throw new Error("Canvas dimensions must be positive integers up to 4096");
  return {width,height};
}

export function previewResolution(value = DEFAULT_RESOLUTION) {
  const width = value?.width;
  const height = value?.height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_RENDER_DIMENSION ||
    height > MAX_RENDER_DIMENSION ||
    (width !== height && width * 9 !== height * 16)
  )
    throw new Error(
      "预览分辨率须为 16:9 或 1:1 的正整数尺寸，单边不超过 4096 像素",
    );
  return Object.freeze({ width, height });
}

export function resolutionFromSearch(search) {
  const params = new URLSearchParams(search);
  if (!params.has("width") && !params.has("height")) return previewResolution();
  if (
    params.getAll("width").length !== 1 ||
    params.getAll("height").length !== 1 ||
    !/^[1-9]\d*$/.test(params.get("width") ?? "") ||
    !/^[1-9]\d*$/.test(params.get("height") ?? "")
  )
    throw new Error("预览分辨率参数无效，须同时传入 width 和 height");
  return previewResolution({
    width: Number(params.get("width")),
    height: Number(params.get("height")),
  });
}

export function previewLaunchUrl(resolution) {
  const path = "/player/miacode/index.html";
  if (resolution === undefined) return path;
  const { width, height } = previewResolution(resolution);
  return `${path}?width=${width}&height=${height}`;
}

import {
  PreviewAudio,
  PreviewVideoFrames,
  PreviewMediaCache,
  loadPreviewRuntime,
  fetchVerified,
} from "./runtime.mjs";
import { DEFAULT_RESOLUTION, resolutionFromSearch } from "./resolution.mjs";
import { PreviewFrameLimiter, maxFpsFromSearch } from "./frame-rate.mjs";

let WIDTH = DEFAULT_RESOLUTION.width,
  HEIGHT = DEFAULT_RESOLUTION.height;

const $ = (id) => document.getElementById(id);
const embedded = window.parent !== window;
document.body.classList.toggle("embedded", embedded);
const themeButton = $("theme-toggle");
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeButton.textContent = theme === "dark" ? "浅色" : "深色";
  themeButton.setAttribute("aria-label", `切换到${theme === "dark" ? "浅色" : "深色"}主题`);
}
setTheme(new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark");
themeButton.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    $("transport-error").hidden = true;
  } catch {
    $("transport-error").textContent = "当前页面未允许全屏";
    $("transport-error").hidden = false;
  }
});
document.addEventListener("fullscreenchange", () => {
  $("fullscreen").textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  $("fullscreen").setAttribute("aria-label", document.fullscreenElement ? "退出全屏" : "进入全屏");
});
let identity,
  module,
  chart,
  sourceText = "",
  input,
  generation = 0,
  abort,
  videoUrl,
  videoPointer;
let audio, defaultSettings;
const video = document.createElement("video");
video.muted = true;
video.playsInline = true;
video.preload = "auto";
const videoCanvas = document.createElement("canvas");
const videoContext = videoCanvas.getContext("2d", { willReadFrequently: true });
const videoFrames = new PreviewVideoFrames(video);
const mediaCache = new PreviewMediaCache();
let frameLimiter,
  fpsSampleTime = 0,
  fpsSampleFrames = 0,
  ready = false;
const status = (text) => {
  $("status").textContent = text;
  $("status").hidden = !text;
};
let sdkEvents;
const emit = (type, payload) => { sdkEvents?.(type, payload); };
const elapsed = () =>
  Math.max(0, Math.round((audio?.currentSecond() ?? 0) * 1000));
const fail = (error) => {
  audio?.pause();
  video.pause();
  status(
    error instanceof Error ? error.message : "播放器加载失败，请刷新后重试",
  );
  emit("error", {
    code: "MIACODE_PREVIEW_FAILED",
    message: $("status").textContent,
    elapsedMs: elapsed(),
  });
};
function resize() {
  const scale = Math.min(
    $("stage").clientWidth / WIDTH,
    $("stage").clientHeight / HEIGHT,
  );
  $("viewport").style.transform = `scale(${scale})`;
  $("viewport").style.left =
    `${($("stage").clientWidth - WIDTH * scale) / 2}px`;
  $("viewport").style.top =
    `${($("stage").clientHeight - HEIGHT * scale) / 2}px`;
}
new ResizeObserver(resize).observe($("stage"));
resize();
// Qt measures its screen through getBoundingClientRect. Keep that measurement
// in the fixed export coordinate system; the outer viewport alone scales the
// finished canvas. Otherwise Qt would resize to the already-scaled rectangle
// and the browser would apply the scale a second time, clipping the scene.
const screen = $("qt-screen");
// This isolated renderer document represents a caller-sized export surface,
// not a native HiDPI desktop. Qt's WASM platform reads window.devicePixelRatio
// directly; pin it here so Retina/browser zoom cannot multiply the framebuffer.
Object.defineProperty(window, "devicePixelRatio", {
  configurable: true,
  get: () => 1,
});
const actualScreenRect = screen.getBoundingClientRect.bind(screen);
screen.getBoundingClientRect = () => {
  const position = actualScreenRect();
  return new DOMRect(position.x, position.y, WIDTH, HEIGHT);
};

const boot = (async () => {
  const resolution = resolutionFromSearch(location.search);
  frameLimiter = new PreviewFrameLimiter(maxFpsFromSearch(location.search));
  WIDTH = resolution.width;
  HEIGHT = resolution.height;
  document.documentElement.style.setProperty("--preview-width", `${WIDTH}px`);
  document.documentElement.style.setProperty("--preview-height", `${HEIGHT}px`);
  document.documentElement.style.setProperty(
    "--preview-aspect",
    `${WIDTH} / ${HEIGHT}`,
  );
  resize();
  const runtime = await loadPreviewRuntime(import.meta.url);
  identity = runtime.identity;
  module = await window.qtLoad({
    qt: {
      entryFunction: runtime.entryFunction,
      module: Promise.resolve(runtime.wasmModule),
      containerElements: [$("qt-screen")],
      fontDpi: 96,
      onExit: () => fail(new Error("播放器已退出，请刷新页面")),
    },
  });
  const configured = JSON.parse(
    call(
      "miacode_set_resolution",
      "string",
      ["number", "number"],
      [WIDTH, HEIGHT],
    ),
  );
  if (configured.error) throw new Error(configured.error);
  defaultSettings = JSON.parse(call("miacode_settings", "string", [], []));
  updateSettingsControls(defaultSettings);
  $("settings-toggle").disabled = false;
  fpsSampleTime = performance.now();
  fpsSampleFrames = call("miacode_frame_count", "number", [], []);
  ready = true;
  status(embedded ? "" : "请选择谱面文件夹");
})().catch((error) => {
  fail(error);
  throw error;
});
// Keep startup rejection handled before the first host/file message arrives.
void boot.catch(() => {});

function call(name, result, args, values) {
  return module.ccall(name, result, args, values);
}
const PREVIEW_MODES = Object.freeze({
  native: 0,
  maimuri_dx_style: 1,
  erase_by_area: 2,
});
function updateSettingsControls(settings) {
  $("preview-mode").value = settings.previewMode;
  $("outer-brightness").value = String(
    Math.round(settings.outerBrightness * 100),
  );
  $("inner-brightness").value = String(
    Math.round(settings.innerBrightness * 100),
  );
  $("outer-value").textContent = `${$("outer-brightness").value}%`;
  $("inner-value").textContent = `${$("inner-brightness").value}%`;
  $("tap-speed").value = String(settings.tapFlowSpeed);
  $("touch-speed").value = String(settings.touchFlowSpeed);
  $("tap-speed-value").textContent = $("tap-speed").value;
  $("touch-speed-value").textContent = $("touch-speed").value;
  $("slide-order").value = settings.earlierSlideOnTop ? "earlier" : "later";
  $("note-skin").value = settings.noteSkin;
}
function applySettings() {
  try {
    const result = JSON.parse(
      call(
        "miacode_set_settings",
        "string",
        ["number", "number", "number", "number", "number", "number", "number"],
        [
          Number($("outer-brightness").value) / 100,
          Number($("inner-brightness").value) / 100,
          Number($("slide-order").value === "earlier"),
          Number($("note-skin").value === "DX"),
          Number($("tap-speed").value),
          Number($("touch-speed").value),
          PREVIEW_MODES[$("preview-mode").value] ?? NaN,
        ],
      ),
    );
    if (result.error) throw new Error(result.error);
    updateSettingsControls(result);
    $("settings-error").hidden = true;
  } catch (error) {
    updateSettingsControls(
      JSON.parse(call("miacode_settings", "string", [], [])),
    );
    $("settings-error").textContent =
      error instanceof Error ? error.message : "设置失败，请重试";
    $("settings-error").hidden = false;
  }
}
function toggleSettings(open) {
  $("settings-panel").hidden = !open;
  document.body.classList.toggle("settings-open", open);
  $("settings-toggle").setAttribute("aria-expanded", String(open));
  (open ? $("settings-close") : $("settings-toggle")).focus();
  if (open && matchMedia("(max-width: 640px)").matches)
    window.scrollTo({ top: $("settings-panel").offsetTop, behavior: "smooth" });
  if (!open) window.scrollTo({ top: 0 });
}
$("settings-toggle").addEventListener("click", () =>
  toggleSettings($("settings-panel").hidden),
);
$("settings-close").addEventListener("click", () => toggleSettings(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("settings-panel").hidden) {
    event.preventDefault();
    toggleSettings(false);
  }
});
for (const id of [
  "preview-mode",
  "outer-brightness",
  "inner-brightness",
  "tap-speed",
  "touch-speed",
  "slide-order",
  "note-skin",
])
  $(id).addEventListener("input", applySettings);
$("settings-reset").addEventListener("click", () => {
  updateSettingsControls(defaultSettings);
  applySettings();
});
function pause() {
  if (!audio) return;
  audio.pause();
  video.pause();
  if (ready && chart) {
    call("miacode_seek", null, ["number"], [audio.offset]);
    $("seek").value = String(audio.offset);
  }
  $("play").textContent = "播放";
  emit("paused", { elapsedMs: elapsed() });
}
async function play() {
  if (!chart) return;
  await audio.context.resume();
  audio.start();
  status("");
  $("play").textContent = "暂停";
  if (video.src) {
    video.currentTime = audio.offset;
    void video.play().catch(() => {});
  }
  emit("playing", { elapsedMs: elapsed() });
}
function seek(second) {
  if (!chart) return;
  audio.seek(second);
  call("miacode_seek", null, ["number"], [audio.offset]);
  if (video.src) video.currentTime = audio.offset;
  $("seek").value = String(audio.offset);
  updateTime();
}
function updateTime() {
  const format = second => `${Math.floor(second / 60)}:${String(Math.floor(second % 60)).padStart(2, "0")}`;
  $("time").textContent = `${format(audio?.currentSecond() ?? 0)} / ${format(audio?.duration ?? 0)}`;
}
function clearInput() {
  audio?.reset();
  videoFrames.reset();
  video.pause();
  video.removeAttribute("src");
  video.load();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
  videoCanvas.width = 0;
  videoCanvas.height = 0;
  chart = null;
  $("chart-title").textContent = "未加载谱面";
  $("time").textContent = "0:00 / 0:00";
  for (const id of ["play", "restart", "seek", "difficulty"])
    $(id).disabled = true;
  if (module) {
    call("miacode_background", "number", ["number", "number"], [0, 0]);
    if (videoPointer != null) {
      module._free(videoPointer);
      videoPointer = undefined;
    }
  }
}
async function bytes(resource, signal) {
  return resource instanceof File
    ? resource.arrayBuffer()
    : fetchVerified(resource, signal);
}
async function setBackground(data) {
  if (!data) return;
  const pointer = module._malloc(data.byteLength);
  try {
    module.HEAPU8.set(new Uint8Array(data), pointer);
    if (
      !call(
        "miacode_background",
        "number",
        ["number", "number"],
        [pointer, data.byteLength],
      )
    )
      throw new Error("背景图片无法解码");
  } finally {
    module._free(pointer);
  }
}
async function load(resources, difficultyId) {
  const token = ++generation;
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;
  clearInput();
  input = resources;
  sourceText = "";
  status("正在加载谱面…");
  emit("progress", { stage: "正在加载谱面", progress: 0.05 });
  await boot;
  if (token !== generation) return;
  audio ??= new PreviewAudio(new AudioContext());
  const prepared = mediaCache.load(resources, audio.context, bytes, signal);
  const text = await prepared.text;
  if (token !== generation) return;
  status("正在解析谱面…");
  emit("progress", { stage: "正在解析谱面", progress: 0.15 });
  const parsed = JSON.parse(
    call(
      "miacode_load",
      "string",
      ["string", "number"],
      [text, difficultyId ?? 0],
    ),
  );
  if (parsed.error) throw new Error(parsed.error);
  sourceText = text;
  const bufferFiles = [
    ...new Set(parsed.sfx.map((e) => e.file).filter(Boolean)),
  ];
  if (parsed.touchholdSegments.length) bufferFiles.push("touch_Hold_riser.wav");
  status("正在加载音乐、音效和背景…");
  emit("progress", { stage: "正在加载音乐、音效和背景", progress: 0.3 });
  const [{ track, coverBytes }] = await Promise.all([
    prepared.music,
    ...bufferFiles
      .filter((file) => !audio.buffers.has(file))
      .map(async (file) => {
        const response = await fetch(`./sfx/${encodeURIComponent(file)}`, {
          signal,
        });
        if (!response.ok) throw new Error(`音效缺失：${file}`);
        const decoded = await audio.context.decodeAudioData(
          await response.arrayBuffer(),
        );
        if (token === generation) audio.buffers.set(file, decoded);
      }),
  ]);
  if (token !== generation) return;
  let videoBlob = null;
  if (resources.video) {
    status("正在加载背景 PV…");
    emit("progress", { stage: "正在加载背景 PV", progress: 0.65 });
    videoBlob = await prepared.video;
    if (token !== generation) return;
  }
  await setBackground(coverBytes);
  if (videoBlob) {
    status("正在准备背景视频…");
    emit("progress", { stage: "正在准备背景视频", progress: 0.85 });
    videoUrl = URL.createObjectURL(videoBlob);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error("背景视频加载超时，请换用图片背景后重试")),
        20000,
      );
      const loaded = () => finish();
      const failed = () =>
        finish(new Error("背景视频无法解码，请换用浏览器支持的视频或图片"));
      const cancelled = () => finish(new DOMException("Aborted", "AbortError"));
      function finish(error) {
        clearTimeout(timeout);
        video.removeEventListener("loadeddata", loaded);
        video.removeEventListener("error", failed);
        signal.removeEventListener("abort", cancelled);
        if (error) reject(error);
        else resolve();
      }
      video.addEventListener("loadeddata", loaded, { once: true });
      video.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", cancelled, { once: true });
      video.src = videoUrl;
      videoFrames.start();
      video.load();
    });
  }
  if (token !== generation) return;
  chart = parsed;
  $("chart-title").textContent = parsed.title || "未命名谱面";
  $("chart-title").title = [parsed.title, parsed.artist].filter(Boolean).join(" · ");
  audio.track = track;
  audio.events = parsed.sfx;
  audio.segments = parsed.touchholdSegments;
  audio.duration = Math.max(parsed.duration, track?.duration ?? 0);
  updateTime();
  $("seek").max = String(audio.duration);
  $("seek").value = "0";
  $("difficulty").replaceChildren(
    ...parsed.charts.map((item) => {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = item.label;
      return option;
    }),
  );
  $("difficulty").value = String(parsed.difficultyId);
  $("play").textContent = "播放";
  emit("progress", { stage: "资源已就绪", progress: 1 });
  status("");
  emit("paused", { elapsedMs: 0 });
  if (token !== generation) return;
  for (const id of ["play", "restart", "seek", "difficulty"])
    $(id).disabled = false;
}

function requestLoad(resources, difficultyId) {
  const pending = load(resources, difficultyId);
  const token = generation;
  void pending.catch((error) => {
    if (token === generation && error.name !== "AbortError") fail(error);
  });
}

$("files").addEventListener("change", () => {
  const files = [...$("files").files];
  const find = (expression) => files.find((file) => expression.test(file.name));
  const maidata = find(/^maidata\.txt$/i) ?? find(/\.txt$/i);
  if (!maidata) {
    fail(new Error("请选择包含 maidata.txt 的文件夹"));
    return;
  }
  requestLoad(
    {
      maidata,
      audio:
        find(/^track\.(mp3|ogg|wav|flac|m4a)$/i) ??
        find(/\.(mp3|ogg|wav|flac|m4a)$/i),
      cover:
        find(/^(bg|cover)\.(png|jpe?g|webp)$/i) ?? find(/\.(png|jpe?g|webp)$/i),
      video: find(/\.(mp4|webm)$/i),
    },
    null,
  );
});
$("play").addEventListener("click", () => {
  if (audio?.playing) pause();
  else void play().catch(fail);
});
$("restart").addEventListener("click", () => {
  seek(0);
  void play().catch(fail);
});
$("seek").addEventListener("input", () => seek(Number($("seek").value)));
$("difficulty").addEventListener("change", () => {
  if (input) requestLoad(input, Number($("difficulty").value));
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("pagehide", () => {
  ++generation;
  abort?.abort();
  mediaCache.clear();
  clearInput();
  void audio?.context.close();
});

function render(now) {
  if (ready && now - fpsSampleTime >= 1000) {
    const frames = call("miacode_frame_count", "number", [], []);
    $("fps").textContent =
      `FPS: ${Math.round(((frames - fpsSampleFrames) * 1000) / (now - fpsSampleTime))}`;
    fpsSampleFrames = frames;
    fpsSampleTime = now;
  }
  if (!ready || !chart || !frameLimiter.accept(now)) return;
  if (audio.playing) {
    const second = audio.currentSecond();
    audio.schedule();
    call("miacode_tick", null, ["number"], [second]);
    $("seek").value = String(second);
    updateTime();
    if (second >= audio.duration) {
      pause();
      emit("ended", { elapsedMs: elapsed() });
    }
  }
  if (video.readyState >= 2 && !video.seeking) {
    const audioSecond = audio.currentSecond();
    const videoSecond = Number.isFinite(video.duration)
      ? Math.min(audioSecond, video.duration)
      : audioSecond;
    if (Math.abs(video.currentTime - videoSecond) > 0.25) {
      video.currentTime = videoSecond;
      return; // Upload only after the target frame has finished decoding.
    }
    if (!videoFrames.needsUpload()) return;
    const scale = Math.min(
      1,
      WIDTH / video.videoWidth,
      HEIGHT / video.videoHeight,
    );
    const width = Math.round(video.videoWidth * scale),
      height = Math.round(video.videoHeight * scale);
    if (!width || !height) return;
    if (videoCanvas.width !== width || videoCanvas.height !== height) {
      videoCanvas.width = width;
      videoCanvas.height = height;
    }
    videoContext.drawImage(video, 0, 0, width, height);
    videoPointer ??= module._malloc(WIDTH * HEIGHT * 4);
    module.HEAPU8.set(
      videoContext.getImageData(0, 0, width, height).data,
      videoPointer,
    );
    call(
      "miacode_video_frame",
      null,
      ["number", "number", "number"],
      [videoPointer, width, height],
    );
    videoFrames.consume();
  }
}
function frame(now) {
  try {
    render(now);
  } finally {
    // Qt's update() queues its own RAF. Register the next host tick AFTER that
    // request so Qt draws before the next tick, rather than merging two ticks.
    // Keep scheduling after early returns and errors, as the old loop did.
    requestAnimationFrame(frame);
  }
}
requestAnimationFrame(frame);

// SDK-only adapter. Generated during extraction; the website player is unchanged.
import { attachSdkBridge } from "./sdk-bridge.mjs";
attachSdkBridge({
  boot,
  identity: () => identity,
  events: listener => { sdkEvents = listener; },
  chart: () => chart,
  load,
  play,
  pause,
  seek,
  fail,
  clear: () => { ++generation; abort?.abort(); mediaCache.clear(); clearInput(); status(""); },
  state: () => ({
    maxFps: frameLimiter.maxFps,
    loaded: Boolean(chart), playing: audio?.playing ?? false,
    currentTime: audio?.currentSecond() ?? 0, duration: audio?.duration ?? 0,
    difficultyId: chart?.difficultyId ?? null,
    settings: JSON.parse(call("miacode_settings", "string", [], [])),
    resolution: JSON.parse(call("miacode_resolution", "string", [], [])),
  }),
  setSettings: settings => {
    const result = JSON.parse(call("miacode_set_settings", "string",
      ["number", "number", "number", "number", "number", "number", "number"],
      [settings.outerBrightness, settings.innerBrightness, Number(settings.earlierSlideOnTop), Number(settings.noteSkin === "DX"), settings.tapFlowSpeed, settings.touchFlowSpeed, PREVIEW_MODES[settings.previewMode] ?? NaN]));
    if (!result.error) updateSettingsControls(result);
    return result;
  },
});

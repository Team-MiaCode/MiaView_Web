import {
  PreviewAudio,
  PreviewMediaCache,
  loadPreviewRuntime,
  fetchVerified,
} from "./runtime.mjs";
import { pvTimeoutFromSearch } from "./pv-timeout.mjs";
import { httpUrl } from "./protocol.mjs";
import { DEFAULT_RESOLUTION, resolutionFromSearch } from "./resolution.mjs";
import { PreviewFrameLimiter, maxFpsFromSearch } from "./frame-rate.mjs";
import { PreviewDiagnostics } from "./diagnostics.mjs";
import { PerformanceTransport } from "./performance-transport.mjs";

// Each renderer document owns one engine; UI and SDK share its controller.
export function createPlayerEngine(view) {
  let WIDTH = DEFAULT_RESOLUTION.width,
    HEIGHT = DEFAULT_RESOLUTION.height;

  const $ = (id) => document.getElementById(id);
  const embedded = window.parent !== window;
  document.body.classList.toggle("embedded", embedded);
  let identity,
    module,
    chart,
    generation = 0,
    abort,
    videoUrl;
  let audio, defaultSettings;
  const video = $("stage-video");
  const pvTimeoutMs = pvTimeoutFromSearch(location.search);
  const mediaCache = new PreviewMediaCache({
    videoTimeoutMs: pvTimeoutMs,
    onVideoTimeout: () => {
      diagnostics.count("videoLoadTimeouts");
      diagnostics.flush();
      emit("progress", {
        stage: `PV 加载超过 ${pvTimeoutMs / 1000} 秒，已停止加载并跳过`,
        progress: 0.65,
      });
    },
  });
  let frameLimiter,
    fpsSampleTime = 0,
    fpsSampleFrames = 0,
    ready = false,
    phase = "engine-load";
  const status = (text) => {
    $("status").textContent = text;
    $("status").hidden = !text;
  };
  let sdkEvents;
  const emit = (type, payload) => {
    sdkEvents?.(type, payload);
  };
  const performanceTransport = new PerformanceTransport({
    publish: (report) => emit("performance", report),
  });
  const diagnosticContext = () => ({
    ready,
    loaded: Boolean(chart),
    phase,
    playing: audio?.playing ?? false,
    visible: !document.hidden,
    currentTime: audio?.currentSecond() ?? 0,
    difficultyId: chart?.difficultyId ?? null,
    noteCount: chart?.noteCount ?? 0,
    resolution: { width: WIDTH, height: HEIGHT },
    maxFps: frameLimiter?.maxFps ?? 60,
    pvTimeoutMs,
    hasVideo: Boolean(video.src),
    videoPipeline: video.src ? "browser-compositor" : "none",
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    videoDecodedFrames:
      video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
    videoDroppedFrames:
      video.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
    wasmHeapBytes: module?.HEAPU8?.byteLength ?? 0,
    presentedFrames: ready
      ? module.ccall("miacode_frame_count", "number", [], [])
      : 0,
    playerVersion: identity?.version ?? null,
    sourceRevision: identity?.sourceRevision ?? null,
    settings: ready
      ? JSON.parse(module.ccall("miacode_settings", "string", [], []))
      : null,
  });
  let reportSequence = 0;
  const publishDiagnostic = (report) => {
    report.sequence = ++reportSequence;
    void performanceTransport.send(report);
  };
  const diagnostics = new PreviewDiagnostics({
    initializationOnly: true,
    context: diagnosticContext,
    publish: publishDiagnostic,
  });
  const playbackDiagnostics = new PreviewDiagnostics({
    playbackOnly: true,
    playbackActive: () => Boolean(chart && audio?.playing),
    context: diagnosticContext,
    publish: publishDiagnostic,
  });
  function diagnosticSnapshot() {
    diagnostics.flush();
    const snapshot = diagnostics.snapshot();
    return {
      ...snapshot,
      reports: [...snapshot.reports, ...playbackDiagnostics.snapshot().reports]
        .sort((a, b) => a.sequence - b.sequence).slice(-snapshot.historyLimit),
    };
  }
  function setDiagnostics(enabled) {
    diagnostics.setEnabled(enabled);
    playbackDiagnostics.setEnabled(enabled && Boolean(chart) && Boolean(audio?.playing));
    return diagnosticSnapshot();
  }
  diagnostics.setEnabled(
    new URLSearchParams(location.search).get("diagnostics") !== "0",
  );
  const elapsed = () =>
    Math.max(0, Math.round((audio?.currentSecond() ?? 0) * 1000));
  const updateTransport = () => view.transport?.(audio?.currentSecond() ?? 0, audio?.duration ?? 0);
  const fail = (error) => {
    playbackDiagnostics.setEnabled(false);
    diagnostics.error(phase, error);
    phase = "error";
    diagnostics.flush();
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
    const runtime = await diagnostics.measureAsync("engineLoad", () =>
      loadPreviewRuntime(import.meta.url),
    );
    identity = runtime.identity;
    phase = "engine-init";
    diagnostics.flush();
    module = await diagnostics.measureAsync("engineInit", () =>
      window.qtLoad({
        qt: {
          entryFunction: runtime.entryFunction,
          module: Promise.resolve(runtime.wasmModule),
          containerElements: [$("qt-screen")],
          fontDpi: 96,
          onExit: () => fail(new Error("播放器已退出，请刷新页面")),
        },
      }),
    );
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
    view.settings(defaultSettings);
    // Qt renders asynchronously. Wait for a presented transparent firework draw,
    // including its real pipeline and mipmapped ball, before accepting playback.
    while (!call("miacode_firework_ready", "number", [], [])) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    $("settings-toggle").disabled = false;
    fpsSampleTime = performance.now();
    fpsSampleFrames = call("miacode_frame_count", "number", [], []);
    ready = true;
    phase = "ready";
    diagnostics.flush();
    status("");
  })().catch((error) => {
    fail(error);
    throw error;
  });
  // Keep startup rejection handled before the first host/file message arrives.
  void boot.catch(() => {});

  const callMetrics = {
    miacode_load: "chartParse",
    miacode_background: "backgroundDecode",
  };

  function call(name, result, args, values) {
    if (!diagnostics.enabled || phase !== "chart-load")
      return module.ccall(name, result, args, values);
    const metric = callMetrics[name];
    const action = () => module.ccall(name, result, args, values);
    return metric ? diagnostics.measure(metric, action) : action();
  }
  const PREVIEW_MODES = Object.freeze({
    native: 0,
    maimuri_dx_style: 1,
    erase_by_area: 2,
  });
  function pause() {
    if (!audio) return;
    diagnostics.flush();
    playbackDiagnostics.setEnabled(false);
    audio.pause();
    video.pause();
    if (ready && chart) {
      call("miacode_seek", null, ["number"], [audio.offset]);
      $("seek").value = String(audio.offset);
    }
    $("play").textContent = "播放";
    updateTransport();
    emit("paused", { elapsedMs: elapsed() });
  }
  async function play() {
    if (!chart) return;
    await audio.context.resume();
    diagnostics.flush();
    audio.start();
    playbackDiagnostics.setEnabled(diagnostics.enabled);
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
    updateTransport();
  }
  function clearInput() {
    playbackDiagnostics.setEnabled(false);
    audio?.reset();
    video.hidden = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = null;
    chart = null;
    view.chart?.(null);
    updateTransport();
    for (const id of ["play", "restart", "seek"])
      $(id).disabled = true;
    if (module) {
      call("miacode_background", "number", ["number", "number"], [0, 0]);
    }
  }
  async function bytes(resource, signal) {
    signal?.throwIfAborted();
    if (resource instanceof Blob) return resource.arrayBuffer();
    if (typeof resource.text === "string")
      return new TextEncoder().encode(resource.text).buffer;
    if (resource.sha256 !== undefined || resource.byteSize !== undefined)
      return fetchVerified(resource, signal);
    const response = await fetch(httpUrl(resource.url), {
      signal,
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`资源读取失败（HTTP ${response.status}）`);
    return response.arrayBuffer();
  }
  async function prepareVideo(resource, signal) {
    if (!resource) return;
    signal.throwIfAborted();
    videoUrl = URL.createObjectURL(resource);
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    await new Promise((resolve, reject) => {
      const loaded = () => finish();
      const failed = () =>
        finish(new Error("背景视频无法解码，请换用浏览器支持的视频或图片"));
      const cancelled = () => {
        finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
        video.pause();
        video.removeAttribute("src");
        video.load();
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        videoUrl = null;
      };
      function finish(error) {
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
      video.load();
    });
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
    const pending = diagnostics.measureAsync("chartLoad", () =>
      loadChart(resources, difficultyId),
    );
    const token = generation;
    try {
      const result = await pending;
      diagnostics.flush();
      return result;
    } catch (error) {
      if (token === generation) abort?.abort();
      throw error;
    }
  }
  async function loadChart(resources, difficultyId) {
    const token = ++generation;
    const loadStart = performance.now();
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    clearInput();
    phase = "chart-load";
    status("正在加载谱面…");
    emit("progress", { stage: "正在加载谱面", progress: 0.05 });
    await boot;
    if (token !== generation) return;
    audio ??= new PreviewAudio(new AudioContext());
    audio.onSchedule = (lateMs) => {
      playbackDiagnostics.record("audioScheduleLate", lateMs);
      if (lateMs > 5) playbackDiagnostics.count("audioLateEvents");
    };
    const resourceSteps = new Set([
      "maidataRead",
      "audioRead",
      "audioDecode",
      "coverRead",
      "videoAssetRead",
      "videoReady",
    ]);
    const step = (kind, resource, action) =>
      diagnostics.measureLoadingStep(kind, resource, token, loadStart, action);
    const measure = (name, action) =>
      diagnostics.measureAsync(name, () =>
        resourceSteps.has(name) ? step(name, "", action) : action(),
      );
    const prepared = mediaCache.load(
      resources,
      audio.context,
      bytes,
      signal,
      measure,
      (blob, videoSignal) =>
        measure("videoReady", () => prepareVideo(blob, videoSignal)),
    );
    const videoReady = prepared.video;
    // Parsing can fail before the concurrently buffered video is awaited.
    void videoReady.catch(() => {});
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
    const bufferFiles = [
      ...new Set(parsed.sfx.map((e) => e.file).filter(Boolean)),
    ];
    if (parsed.touchholdSegments.length) bufferFiles.push("touch_Hold_riser.wav");
    status("正在加载音乐、音效和背景…");
    emit("progress", { stage: "正在加载音乐、音效和背景", progress: 0.3 });
    const [{ track, coverBytes }] = await measure("musicAndSfxReady", () =>
      Promise.all([
        prepared.music,
        ...bufferFiles
          .filter((file) => !audio.buffers.has(file))
          .map(async (file) => {
            const data = await step("sfxRead", file, async () => {
              const response = await fetch(`./sfx/${encodeURIComponent(file)}`, {
                signal,
              });
              if (!response.ok) throw new Error(`音效缺失：${file}`);
              return response.arrayBuffer();
            });
            const decoded = await step("sfxDecode", file, () =>
              audio.context.decodeAudioData(data),
            );
            if (token === generation) audio.buffers.set(file, decoded);
          }),
      ]),
    );
    if (token !== generation) return;
    if (resources.video) {
      status("正在准备背景视频…");
      emit("progress", { stage: "正在准备背景视频", progress: 0.65 });
    }
    const [, videoBlob] = await Promise.all([
      setBackground(coverBytes),
      videoReady,
    ]);
    if (token !== generation) return;
    if (videoBlob) {
      call("miacode_external_video", null, ["number"], [1]);
      video.hidden = false;
    }
    chart = parsed;
    view.chart?.(parsed);
    audio.track = track;
    audio.events = parsed.sfx;
    audio.segments = parsed.touchholdSegments;
    audio.duration = Math.max(parsed.duration, track?.duration ?? 0);
    updateTransport();
    $("seek").max = String(audio.duration);
    $("seek").value = "0";
    $("play").textContent = "播放";
    phase = "ready";
    emit("progress", { stage: "资源已就绪", progress: 1 });
    status("");
    emit("paused", { elapsedMs: 0 });
    if (token !== generation) return;
    for (const id of ["play", "restart", "seek"])
      $(id).disabled = false;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  window.addEventListener("pagehide", () => {
    ++generation;
    abort?.abort();
    mediaCache.clear();
    clearInput();
    diagnostics.dispose();
    playbackDiagnostics.dispose();
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
    playbackDiagnostics.hostFrame(now, audio.playing);
    playbackDiagnostics.measure("hostWork", () => {
      if (audio.playing) {
        const second = audio.currentSecond();
        playbackDiagnostics.measure("audioSchedule", () => audio.schedule());
        playbackDiagnostics.measure("wasmTick", () =>
          call("miacode_tick", null, ["number"], [second]));
        $("seek").value = String(second);
        updateTransport();
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
          playbackDiagnostics.count("videoResyncs");
          video.currentTime = videoSecond;
        }
      }
    });
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

  return {
    boot,
    identity: () => identity,
    events: (listener) => {
      sdkEvents = listener;
    },
    chart: () => chart,
    diagnostics: diagnosticSnapshot,
    setDiagnostics,
    resetDiagnostics: () => {
      diagnostics.reset();
      playbackDiagnostics.reset();
      reportSequence = 0;
      return diagnosticSnapshot();
    },
    load,
    play,
    pause,
    seek,
    fail,
    clear: () => {
      ++generation;
      abort?.abort();
      mediaCache.clear();
      clearInput();
      status("");
    },
    state: () => ({
      maxFps: frameLimiter.maxFps,
      pvTimeoutMs,
      loaded: Boolean(chart),
      playing: audio?.playing ?? false,
      currentTime: audio?.currentSecond() ?? 0,
      duration: audio?.duration ?? 0,
      difficultyId: chart?.difficultyId ?? null,
      settings: JSON.parse(call("miacode_settings", "string", [], [])),
      resolution: JSON.parse(call("miacode_resolution", "string", [], [])),
    }),
    defaultSettings: () => defaultSettings,
    setSettings: (settings) => {
      const result = JSON.parse(
        call(
          "miacode_set_settings",
          "string",
          ["number", "number", "number", "number", "number", "number", "number"],
          [
            settings.outerBrightness,
            settings.innerBrightness,
            Number(settings.earlierSlideOnTop),
            Number(settings.noteSkin === "DX"),
            settings.tapFlowSpeed,
            settings.touchFlowSpeed,
            PREVIEW_MODES[settings.previewMode] ?? NaN,
          ],
        ),
      );
      if (!result.error) view.settings(result);
      return result;
    },
  };
}

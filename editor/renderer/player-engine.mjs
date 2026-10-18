import {
  PreviewAudio,
  PreviewMediaCache,
  loadPreviewRuntime,
  fetchVerified,
} from "./runtime.mjs";
import { pvTimeoutFromSearch } from "./pv-timeout.mjs";
import { httpUrl } from "./protocol.mjs";
import { DEFAULT_RESOLUTION, resolutionFromSearch, canvasResolution } from "./resolution.mjs";
import { PreviewFrameLimiter, maxFpsFromSearch } from "./frame-rate.mjs";
import { PreviewDiagnostics } from "./diagnostics.mjs";
import { PerformanceTransport } from "./performance-transport.mjs";
import { DEFAULT_PLAYBACK, playbackSettings } from "./playback.mjs";
import { DEFAULT_LATENCY, latencySettings } from "./latency.mjs";
import { shortcutInput, matchesShortcut } from "./input-shortcut.mjs";
import { encodeVideoExport, exportCapabilities, exportSettings, seekVideo } from "./video-export.mjs";
import { CoverPvFrames } from "./cover-pv.mjs";
import { IntroAudition } from "./intro-audition.mjs";
import { DEFAULT_PERFORMANCE, frameRateForMode, performanceSettings } from "./performance-settings.mjs";
import { VideoPresentation } from "./video-presentation.mjs";
import { nextAnimationFrame } from "./animation-frame.mjs";
import { synchronizeVideoClock } from "./video-clock.mjs";
import { PreviewAnalysis } from "./analysis-client.mjs";

// Each renderer document owns one engine; UI and SDK share its controller.
export function createPlayerEngine(view) {
  const lifetime = new AbortController();
  let disposed = false, frameRequest;
  let playbackRequest = 0;
  let playStartAbort;
  let WIDTH = DEFAULT_RESOLUTION.width,
    HEIGHT = DEFAULT_RESOLUTION.height;

  const $ = (id) => document.getElementById(id);
  const embedded = window.parent !== window;
  document.body.classList.toggle("embedded", embedded);
  document.body.classList.toggle("external-controls", new URLSearchParams(location.search).get("controls") === "0");
  let playback = { ...DEFAULT_PLAYBACK };
  let hidePv = false, loadedCover;
  let identity,
    module,
    chart,
    generation = 0,
    abort,
    videoUrl;
  let audio, defaultSettings, appearance, audioSettings, analysis, runtimeManifest;
  let previewDeferred = false;
  let loadedAudioResource, exportJob;
  let introAudition,introOptions,introSaved;
  let introWasPlaying=false;
  const exportSoundBytes = new Map();
  let latency = { ...DEFAULT_LATENCY }, analyzedTrack;
  let video = $("stage-video");
  let performanceOptions = { ...DEFAULT_PERFORMANCE };
  let videoGeometry;
  const mediaGeometry = source => {
    const width = source.videoWidth || source.width, height = source.videoHeight || source.height;
    const key = `${width}:${height}:${WIDTH}:${HEIGHT}:${appearance.scaleMode}:${appearance.layoutSquareScale}`;
    if (videoGeometry?.key !== key) videoGeometry = { key,
      value: JSON.parse(call("miacode_media_geometry", "string", ["number", "number"], [width, height])) };
    return videoGeometry.value;
  };
  const videoPresentation = new VideoPresentation($("stage-pv"), mediaGeometry, error => fail(error), videoFrameReady);
  let renderedSecond = 0;
  let introVideoSecond = 0;
  let coverState, coverPixelPointer = 0, coverPixelCapacity = 0;
  const coverPv = new CoverPvFrames({ load: prepareVideo,
    upload: (key, image, seconds) => {
      if (!module) return false;
      if (!image) return Boolean(call("miacode_cover_pv_frame", "number", ["string", "number", "number", "number", "number", "number"], ["", 0, 0, 0, 0, 0]));
      if (image.data.byteLength > coverPixelCapacity) {
        if (coverPixelPointer) module._free(coverPixelPointer);
        coverPixelCapacity = image.data.byteLength; coverPixelPointer = module._malloc(coverPixelCapacity);
      }
      module.HEAPU8.set(image.data, coverPixelPointer);
      return Boolean(call("miacode_cover_pv_frame", "number", ["string", "number", "number", "number", "number", "number"],
        [key, coverPixelPointer, image.data.byteLength, image.width, image.height, seconds]));
    }, failed: coverMediaError });
  function coverMediaError(error) { if (error.name !== "AbortError") fail(error); }
  function updateCoverMedia(value) {
    coverState = value;
    void coverPv.update(value).catch(coverMediaError);
  }
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
  let inputShortcuts = {}, heldShortcut;
  const emit = (type, payload) => {
    sdkEvents?.(type, payload);
  };
  const releaseShortcut = () => {
    if (!heldShortcut) return;
    emit("shortcutInput", { id: heldShortcut.id, phase: "keyup" }); heldShortcut = null;
  };
  let coverSeeking = false;
  const coverKeyCommand = (id, args = {}) => {
    const result = exportCall("miacode_cover_command", ["string"], [JSON.stringify({ id, args })]);
    updateCoverMedia(result);
    emit("coverChanged", result);
  };
  window.addEventListener("keydown", event => {
    if (!ready || !document.body.classList.contains("cover-view") || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const state = exportCall("miacode_cover_state");
    if (state.layout.layers.find(layer => layer.key === state.activeLayerKey)?.kind !== "chartFrame") return;
    if (event.code === "Space") { if (!event.repeat) coverKeyCommand("cover.toggleActiveLayerPlayback"); }
    else if (["ArrowLeft", "ArrowRight"].includes(event.key)) { if (!event.repeat) { coverSeeking = true; coverKeyCommand("cover.beginActiveLayerKeySeek", { direction: event.key === "ArrowLeft" ? -1 : 1 }); } }
    else return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  window.addEventListener("keyup", event => {
    if (coverSeeking && ["ArrowLeft", "ArrowRight"].includes(event.key)) { coverSeeking = false; coverKeyCommand("cover.endActiveLayerKeySeek"); }
  }, true);
  window.addEventListener("blur", () => {
    if (coverSeeking) { coverSeeking = false; coverKeyCommand("cover.endActiveLayerKeySeek"); }
  });
  window.addEventListener("keydown", event => {
    if (!chart || event.isComposing) return;
    const input = shortcutInput(event);
    const candidates = Object.entries(inputShortcuts).filter(([,binding]) => matchesShortcut(binding,input));
    if (!candidates.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (candidates.length !== 1) return;
    const id = candidates[0][0];
    if (id === "preview.play_pause_global" && event.repeat) return;
    if (id === "preview.pause_display_hold") {
      if (heldShortcut) return;
      heldShortcut = { id, key: input.key };
    }
    emit("shortcutInput", { id, phase: "keydown" });
  }, true);
  window.addEventListener("keyup", event => {
    if (heldShortcut?.key === shortcutInput(event).key) releaseShortcut();
  }, true);
  window.addEventListener("blur", releaseShortcut);
  const performanceTransport = new PerformanceTransport({
    publish: (report) => emit("performance", report),
  });
  const diagnosticContext = () => ({
    ready,
    loaded: Boolean(chart),
    phase,
    playing: Boolean(introAudition?.playing || audio?.playing),
    visible: !document.hidden,
    currentTime: audio?.currentSecond() ?? 0,
    difficultyId: chart?.difficultyId ?? null,
    noteCount: chart?.noteCount ?? 0,
    resolution: { width: WIDTH, height: HEIGHT },
    maxFps: frameLimiter?.maxFps ?? 60,
    pvTimeoutMs,
    hasVideo: Boolean(video.src),
    videoPipeline: video.src ? videoPresentation.decoder ? "software-canvas" : "browser-canvas" : "none",
    videoPresentedFrames: videoPresentation.frames,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    videoDecodedFrames:
      videoPresentation.decoder ? null : video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
    videoDroppedFrames:
      videoPresentation.decoder ? null : video.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
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
    playbackDiagnostics.setEnabled(enabled && Boolean(chart) && Boolean(introAudition?.playing||audio?.playing));
    return diagnosticSnapshot();
  }
  diagnostics.setEnabled(
    new URLSearchParams(location.search).get("diagnostics") !== "0",
  );
  const elapsed = () =>
    Math.max(0, Math.round((audio?.currentSecond() ?? 0) * 1000));
  let lastTimeUpdate = -Infinity;
  const statistics = () => ready && chart ? JSON.parse(call("miacode_statistics", "string", [], []))
    : { statistics: [], statisticsAvailable: false };
  const updateTransport = (force = true) => {
    const currentTime = audio?.currentSecond() ?? 0;
    const duration = audio?.duration ?? 0;
    view.transport?.(currentTime, duration);
    const now = performance.now();
    if (force || now - lastTimeUpdate >= 100) {
      lastTimeUpdate = now;
      emit("timeupdate", { currentTime, duration, playing: audio?.playing ?? false, rate: playback.rate, ...statistics() });
    }
  };
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
  function setSurfaceSize(width, height) {
    WIDTH = width;
    HEIGHT = height;
    document.documentElement.style.setProperty("--preview-width", `${width}px`);
    document.documentElement.style.setProperty("--preview-height", `${height}px`);
    document.documentElement.style.setProperty("--preview-aspect", `${width} / ${height}`);
    module?.qtResizeContainerElement($("qt-screen"));
    resize();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe($("stage"));
  resize();
  // Qt measures its screen through getBoundingClientRect. Keep that measurement
  // in the fixed export coordinate system; the outer viewport alone scales the
  // finished canvas. Otherwise Qt would resize to the already-scaled rectangle
  // and the browser would apply the scale a second time, clipping the scene.
  const screen = $("qt-screen");
  screen.tabIndex = 0;
  screen.addEventListener("pointerdown", () => {
    screen.focus({ preventScroll: true });
  }, true);
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
  let lastTouchPoint;
  function touchPointer(event, phase) {
    if (!ready || !appearance?.touchPadAuthoringShortcut || !appearance.touchPadAuthoringContext) return;
    const rect = actualScreenRect();
    const point = { phase, x: (event.clientX - rect.x) * WIDTH / rect.width,
      y: (event.clientY - rect.y) * HEIGHT / rect.height,
      ctrl: event.ctrlKey, shift: event.shiftKey, button: event.button };
    lastTouchPoint = point;
    const result = JSON.parse(call("miacode_touch_pointer", "string", ["string"], [JSON.stringify(point)]));
    if (result.action) emit("touchPadAuthoring", result);
    if (event.ctrlKey && [0, 2].includes(event.button)) event.preventDefault();
  }
  for (const [name, phase] of [["pointermove", "move"], ["pointerdown", "press"], ["pointerup", "release"], ["pointerleave", "leave"], ["pointercancel", "leave"]])
    screen.addEventListener(name, event => touchPointer(event, phase), { capture: true });
  screen.addEventListener("contextmenu", event => {
    if (appearance?.touchPadAuthoringShortcut && appearance.touchPadAuthoringContext && event.ctrlKey) event.preventDefault();
  });
  document.addEventListener("keyup", event => {
    if (event.key === "Control" && ready && lastTouchPoint)
      call("miacode_touch_pointer", "string", ["string"], [JSON.stringify({ ...lastTouchPoint, phase: "leave", ctrl: false })]);
  });
  window.addEventListener("blur", () => {
    if (ready && lastTouchPoint)
      call("miacode_touch_pointer", "string", ["string"], [JSON.stringify({ ...lastTouchPoint, phase: "leave", ctrl: false })]);
  });

  const boot = (async () => {
    const resolution = resolutionFromSearch(location.search);
    frameLimiter = new PreviewFrameLimiter(maxFpsFromSearch(location.search));
    const frameRateMode = [30, 60, 120, "unlimited"].indexOf(frameLimiter.maxFps);
    performanceOptions.canvasFrameRateMode = frameRateMode < 0 ? null : frameRateMode;
    setSurfaceSize(resolution.width, resolution.height);
    const runtime = await diagnostics.measureAsync("engineLoad", () =>
      loadPreviewRuntime(import.meta.url, undefined, undefined, undefined, undefined, lifetime.signal),
    );
    lifetime.signal.throwIfAborted();
    identity = runtime.identity;
    runtimeManifest = runtime.manifest;
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
    lifetime.signal.throwIfAborted();
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
    audioSettings = JSON.parse(call("miacode_audio_command", "string", ["string"], [JSON.stringify({ id: "audio.getSettings" })]));
    appearance = defaultSettings;
    // Qt's queued window geometry can outlive a caller resize. The renderer
    // owns this single frameless surface; keep its DOM and framebuffer at the
    // caller's logical size while the outer viewport handles browser scaling.
    const qtStyle = document.createElement("style");
    qtStyle.textContent = `.qt-decorated-window.frameless, .qt-window, .qt-window-canvas {
      width: var(--preview-width) !important; height: var(--preview-height) !important;
    } .qt-decorated-window.frameless { left: 0 !important; top: 0 !important; }`;
    screen.querySelector("#qt-shadow-container").shadowRoot.append(qtStyle);
    module.onCoverChanged = value => { const state = JSON.parse(value); updateCoverMedia(state); emit("coverChanged", state); };
    module.onCoverPlaybackChanged = value => {
      const state = JSON.parse(value);
      if (coverState) {
        Object.assign(coverState, state);
        const layer = coverState.layout.layers.find(layer => layer.key === state.activeLayerKey);
        if (layer) layer.frameSeconds = state.frameSeconds;
        void coverPv.update(coverState).catch(coverMediaError);
      }
      emit("coverPlaybackChanged", state);
    };
    let lastPresentation;
    module.onPreviewFrame = (now, renderStarted, second) => {
      renderedSecond = introAudition ? introVideoSecond : second;
      // Paused updates have no subsequent frame to retry a rate-limited draw.
      presentVideo(now, !(introAudition?.playing || audio?.playing));
      if (!playbackDiagnostics.enabled || !(introAudition?.playing || audio?.playing)) {
        lastPresentation = undefined;
        return;
      }
      if (lastPresentation !== undefined) playbackDiagnostics.record("presentInterval", now - lastPresentation);
      playbackDiagnostics.record("renderWork", now - renderStarted);
      lastPresentation = now;
    };
    view.settings(defaultSettings);
    // Qt renders asynchronously. Wait for a presented transparent firework draw,
    // including its real pipeline and mipmapped ball, before accepting playback.
    while (!call("miacode_firework_ready", "number", [], [])) {
      await nextAnimationFrame(lifetime.signal);
    }
    $("settings-toggle").disabled = false;
    fpsSampleTime = performance.now();
    fpsSampleFrames = call("miacode_frame_count", "number", [], []);
    ready = true;
    phase = "ready";
    diagnostics.flush();
    status("");
  })().catch((error) => {
    if (!disposed) fail(error);
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
  function pause() {
    ++playbackRequest;
    playStartAbort?.abort();
    if(introAudition){introAudition.pause();return;}
    if (!audio) return;
    diagnostics.flush();
    playbackDiagnostics.setEnabled(false);
    audio.pause();
    if (ready) call("miacode_set_playing", null, ["number"], [0]);
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
    if(introAudition)return introAudition.play();
    if (!chart || audio.playing) return;
    const request = ++playbackRequest;
    const controller = playStartAbort = new AbortController();
    const signal = AbortSignal.any([abort.signal, controller.signal]);
    let cancel;
    const cancelled = new Promise(resolve => { cancel = () => resolve(false); });
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const resumed = await Promise.race([audio.context.resume().then(() => true), cancelled]);
      if (!resumed || request !== playbackRequest || disposed) return;
      if (playback.rangePlaybackEnabled && (audio.offset < playback.exportStartSeconds || audio.offset >= playback.exportEndSeconds))
        seek(playback.exportStartSeconds);
      diagnostics.flush();
      if (video.src && !hidePv && !performanceOptions.videoDecodePrefersSoftware) {
        await seekVideo(video, audio.offset, signal);
        video.playbackRate = playback.rate;
        video.pause();
      }
      if (video.src && !hidePv) {
        await videoPresentation.ready(audio.offset, signal);
        if (renderedSecond === audio.currentSecond()) await presentVideo(performance.now(), true);
      }
      if (request !== playbackRequest || disposed) return;
      audio.start();
      call("miacode_set_playing", null, ["number"], [1]);
      playbackDiagnostics.setEnabled(diagnostics.enabled);
      status("");
      $("play").textContent = "暂停";
      emit("playing", { elapsedMs: elapsed() });
      updateTransport();
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      if (playStartAbort === controller) playStartAbort = null;
    }
  }
  function positionVideo(second) {
    const target = Math.min(Math.max(0, second), Math.max(0, video.duration - .000001));
    if (video.seeking || Math.abs(video.currentTime - target) >= .000001) {
      videoPresentation.beginSeek(); video.currentTime = target;
    }
  }
  function seek(second) {
    if (!chart) return;
    audio.seek(second);
    call("miacode_seek", null, ["number"], [audio.offset]);
    if (video.src && !performanceOptions.videoDecodePrefersSoftware) positionVideo(audio.offset);
    $("seek").value = String(audio.offset);
    updateTransport();
  }
  function clearInput() {
    videoPresentation.clear();
    releaseShortcut();
    latency.onPage = false; analyzedTrack = null;
    playbackDiagnostics.setEnabled(false);
    audio?.reset();
    if (ready) call("miacode_set_playing", null, ["number"], [0]);
    playback = { ...DEFAULT_PLAYBACK, rate: playback.rate };
    video.hidden = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = null;
    chart = null;
    loadedCover = undefined;
    loadedAudioResource = undefined;
    view.chart?.(null);
    updateTransport();
    for (const id of ["play", "restart", "seek"])
      $(id).disabled = true;
    if (module) {
      call("miacode_latency_samples", null, ["number", "number", "number"], [0, 0, 0]);
      call("miacode_background", "number", ["number", "number"], [0, 0]);
      call("miacode_waveform", null, ["number", "number", "number"], [0, 0, 0]);
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
  async function prepareVideo(resource, signal, target = video) {
    if (!resource) return;
    signal.throwIfAborted();
    const url = URL.createObjectURL(resource);
    target.crossOrigin = "anonymous";
    target.preload = "auto";
    try {
      await new Promise((resolve, reject) => {
        const loaded = () => finish();
        const failed = () =>
          finish(new Error("背景视频无法解码，请换用浏览器支持的视频或图片"));
        const cancelled = () => {
          finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
          target.pause(); target.removeAttribute("src"); target.load();
        };
        function finish(error) {
          target.removeEventListener("loadeddata", loaded);
          target.removeEventListener("error", failed);
          signal.removeEventListener("abort", cancelled);
          if (error) reject(error);
          else resolve();
        }
        target.addEventListener("loadeddata", loaded, { once: true });
        target.addEventListener("error", failed, { once: true });
        signal.addEventListener("abort", cancelled, { once: true });
        target.src = url;
        target.load();
      });
      return url;
    } catch (error) {
      target.pause(); target.removeAttribute("src"); target.load(); URL.revokeObjectURL(url);
      throw error;
    }
  }
  function updateWaveform(track) {
    if (track) {
      const mono = new Float32Array(track.length);
      for (let channel = 0; channel < track.numberOfChannels; channel++) {
        const samples = track.getChannelData(channel);
        for (let index = 0; index < mono.length; index++) mono[index] += samples[index] / track.numberOfChannels;
      }
      const pointer = module._malloc(mono.byteLength);
      try {
        module.HEAPU8.set(new Uint8Array(mono.buffer), pointer);
        call("miacode_waveform", null, ["number", "number", "number"], [pointer, mono.length, track.duration]);
      } finally { module._free(pointer); }
    } else call("miacode_waveform", null, ["number", "number", "number"], [0, 0, 0]);
  }
  async function setBackground(data) {
    if (!data) { call("miacode_background", "number", ["number", "number"], [0, 0]); return; }
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
    previewDeferred = false;
    if (coverState) {
      if (coverState.chartFramePlaying) exportCall("miacode_cover_command", ["string"], [JSON.stringify({ id: "cover.toggleActiveLayerPlayback", args: {} })]);
      coverPv.clear(); coverState = null;
    }
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
    // A detached window uses the initiating document's audio permission. The
    // context still belongs to this engine and is closed with its resources.
    const audioWindow = new URLSearchParams(location.search).get("audioContextOwner") === "opener" ? window.parent.opener : window;
    if (!audioWindow || audioWindow.location.origin !== location.origin) throw new Error("音频所属窗口需要与预览同源");
    const AudioContextClass = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器需要启用 WebAudio 才能播放谱面");
    audio ??= new PreviewAudio(new AudioContextClass());
    audio.setMix(audioSettings.gains);
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
        measure("videoReady", async () => { videoUrl = await prepareVideo(blob, videoSignal); }),
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
        ["string", "number", "string"],
        [text, difficultyId ?? 0, resources.filePath || ""],
      ),
    );
    if (parsed.error) throw new Error(parsed.error);
    if (document.body.classList.contains("cover-view")) {
      document.body.classList.remove("cover-view");
      $("transport").hidden = false;
      const resolution = resolutionFromSearch(location.search);
      setSurfaceSize(resolution.width, resolution.height);
    }
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
    const decoder = await videoPresentation.prepare(videoBlob);
    if (token !== generation) { decoder?.close(); return; }
    videoPresentation.commit(video, videoBlob, decoder);
    if (videoBlob) {
      call("miacode_external_video", null, ["number"], [Number(!hidePv)]);
      video.hidden = hidePv;
      if (hidePv) await setBackground(coverBytes);
    }
    loadedCover = coverBytes;
    loadedAudioResource = resources.audio;
    chart = parsed;
    view.chart?.(parsed);
    audio.track = track;
    audio.events = audioSettings.breakSlideTailCheerMuted ? parsed.sfxMutedTail : parsed.sfx;
    audio.segments = parsed.touchholdSegments;
    audio.duration = Math.max(parsed.duration, track?.duration ?? 0);
    updateWaveform(track);
    audio.rate = playback.rate;
    playback.exportEndSeconds = audio.duration;
    emit("playbackChanged", { ...playback });
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

  async function prepareEffects(parsed) {
    const files = [...new Set(parsed.sfx.map(event => event.file).filter(Boolean))];
    if (parsed.touchholdSegments.length) files.push("touch_Hold_riser.wav");
    await Promise.all(files.filter(file => !audio.buffers.has(file)).map(async file => {
      const response = await fetch(`./sfx/${encodeURIComponent(file)}`);
      if (!response.ok) throw new Error(`音效缺失：${file}`);
      audio.buffers.set(file, await audio.context.decodeAudioData(await response.arrayBuffer()));
    }));
  }
  function latencyScene(settings) {
    return JSON.parse(call("miacode_latency_scene", "string", ["string"], [JSON.stringify({ ...settings, duration: audio?.track?.duration ?? 0 })]));
  }
  function activeAudioGains() {
    return latency.onPage ? JSON.parse(call("miacode_latency_mix", "string", ["number"], [latency.sfxVolumePercent])) : audioSettings.gains;
  }
  async function setLatency(changes) {
    const next = latencySettings(latency, changes);
    if (next.onPage && !JSON.parse(call("miacode_document", "string", [], [])).hasDocument) throw new Error("请打开谱面");
    if (!next.onPage && !latency.onPage) { latency = next; return previewState(); }
    if (Object.keys(changes).every(key => key === "sfxVolumePercent") && Object.keys(changes).length) {
      latency = next; audio?.setMix(activeAudioGains()); return previewState();
    }
    const changedPage = next.onPage !== latency.onPage;
    if (changedPage) pause();
    const second = audio?.currentSecond() ?? 0;
    const parsed = latencyScene(next);
    if (parsed.error && next.onPage) throw new Error(parsed.error);
    latency = next;
    if (audio) audio.setMix(activeAudioGains());
    if (parsed.error) { chart = null; audio.replaceTimeline([], []); }
    else {
      await prepareEffects(parsed); chart = parsed; view.chart?.(parsed);
      audio.duration = next.onPage ? parsed.duration : Math.max(parsed.duration, audio.track?.duration ?? 0);
      audio.replaceTimeline(audioSettings.breakSlideTailCheerMuted ? parsed.sfxMutedTail : parsed.sfx, parsed.touchholdSegments);
      if (changedPage) seek(Math.min(second, audio.duration));
    }
    $("seek").max = String(audio.duration);
    for (const id of ["play", "restart", "seek"]) $(id).disabled = !chart;
    updateTransport(); return previewState();
  }
  async function detectLatency(request) {
    if (!request || !["bpm", "offset"].includes(request.kind)) throw new Error("Detection kind must be bpm or offset");
    if (request.kind === "offset" && (!Number.isFinite(request.bpm) || request.bpm <= 0 || !Number.isFinite(request.offsetSeconds)))
      throw new Error("BPM and offset must be finite");
    const track = audio?.track;
    if (!track) throw new Error("请导入可解码的音乐");
    if (analyzedTrack !== track) {
      const rate = 24000, mono = new Float32Array(track.length);
      for (let channel = 0; channel < track.numberOfChannels; channel++) {
        const samples = track.getChannelData(channel);
        for (let index = 0; index < mono.length; index++) mono[index] += samples[index] / track.numberOfChannels;
      }
      let samples = mono;
      if (track.sampleRate !== rate) {
        const Context = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
        const context = new Context(1, Math.round(track.duration * rate), rate);
        const buffer = context.createBuffer(1, track.length, track.sampleRate); buffer.copyToChannel(mono, 0);
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
        samples = (await context.startRendering()).getChannelData(0);
      }
      const pointer = module._malloc(samples.byteLength);
      try {
        module.HEAPU8.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), pointer);
        call("miacode_latency_samples", null, ["number", "number", "number"], [pointer, samples.length, rate]);
      } finally { module._free(pointer); }
      analyzedTrack = track;
    }
    const result = JSON.parse(call("miacode_latency_detect", "string", ["string"], [JSON.stringify(request)]));
    if (result.error) throw new Error(result.error);
    return result;
  }
  async function documentCommand(request) {
    if (request.id === "document.selectDifficulty") pause();
    const wasPlaying = audio?.playing ?? false;
    const second = audio?.currentSecond() ?? 0;
    const result = JSON.parse(call("miacode_document_command", "string", ["string"], [JSON.stringify(request)]));
    if (result.error) throw new Error(result.error);
    previewDeferred = Boolean(result.previewDeferred);
    delete result.previewDeferred;
    if (previewDeferred) { emit("documentChanged", result.document); return result; }
    return applyDocumentPreview(result, wasPlaying, wasPlaying ? audio.currentSecond() : second);
  }
  async function flushPreview() {
    if (!previewDeferred) return;
    previewDeferred = false;
    const wasPlaying = audio?.playing ?? false;
    const result = JSON.parse(call("miacode_document_refresh", "string", [], []));
    await applyDocumentPreview(result, wasPlaying, audio?.currentSecond() ?? 0, false);
  }
  async function applyDocumentPreview(result, wasPlaying, second, notify = true) {
    if (!result.document.hasDocument) {
      mediaCache.clear(); clearInput(); delete result.preview;
      emit("documentChanged", result.document); return result;
    }
    if (!latency.onPage) pause();
    const request = playbackRequest;
    if (latency.onPage) latency = { ...latency, bpm: result.document.bpm, offsetSeconds: result.document.offsetSeconds };
    const parsed = latency.onPage ? latencyScene(latency) : result.preview;
    if (parsed.error) {
      chart = undefined;
      if (audio) { audio.events = []; audio.segments = []; }
      result.previewError = parsed.error;
      updateTransport();
    } else {
      await prepareEffects(parsed);
      chart = parsed;
      view.chart?.(parsed);
      audio.replaceTimeline(audioSettings.breakSlideTailCheerMuted ? parsed.sfxMutedTail : parsed.sfx, parsed.touchholdSegments);
      audio.duration = latency.onPage ? parsed.duration : Math.max(parsed.duration, audio.track?.duration ?? 0);
      if (!latency.onPage) {
        seek(Math.min(request === playbackRequest ? second : audio.currentSecond(), audio.duration));
        if (wasPlaying && request === playbackRequest) await play();
      }
    }
    delete result.preview;
    for (const id of ["play", "restart", "seek"]) $(id).disabled = !chart;
    if (notify) emit("documentChanged", result.document);
    return result;
  }
  function previewState() {
    return {
      ...statistics(),
      playback: { ...playback },
      media: { hidePv, audioAvailable: Boolean(audio?.track), coverAvailable: Boolean(loadedCover), videoAvailable: Boolean(video.src) },
      maxFps: frameLimiter.maxFps,
      performance: { ...performanceOptions },
      videoPresentation: coverState ? coverPv.snapshot() : { decoder: videoPresentation.decoder ? "software" : "browser", frames: videoPresentation.frames, timestamp: videoPresentation.timestamp ?? video.currentTime },
      pvTimeoutMs,
      loaded: Boolean(chart),
      playing: Boolean(introAudition?.playing || audio?.playing),
      introAudition:introAudition?.state()??null,
      currentTime: audio?.currentSecond() ?? 0,
      duration: audio?.duration ?? 0,
      difficultyId: chart?.difficultyId ?? null,
      settings: JSON.parse(call("miacode_settings", "string", [], [])),
      audio: audioSettings,
      latency: { ...latency },
      resolution: JSON.parse(call("miacode_resolution", "string", [], [])),
    };
  }
  async function setResources(changes) {
    if (!JSON.parse(call("miacode_document", "string", [], [])).hasDocument) throw new Error("Open a document before replacing media");
    const controller = new AbortController(), { signal } = controller;
    let nextTrack = audio.track, nextCover = loadedCover, nextVideo, nextVideoUrl, nextVideoBlob, nextDecoder;
    const tasks = Object.entries(changes).map(async ([kind, resource]) => {
      try {
        if (kind === "audio") nextTrack = resource ? await audio.context.decodeAudioData(await bytes(resource, signal)) : null;
        else if (kind === "cover") {
          nextCover = resource ? await bytes(resource, signal) : null;
          if (nextCover) {
            const image = await createImageBitmap(new Blob([nextCover])); image.close();
          }
        } else if (resource) {
          nextVideo = video.cloneNode(false);
          nextVideo.muted = true;
          const prepared = await mediaCache.loadVideo(resource, signal,
            async readSignal => resource instanceof Blob ? resource : new Blob([await bytes(resource, readSignal)], { type: resource.contentType || "" }),
            async (blob, videoSignal) => { nextVideoUrl = await prepareVideo(blob, videoSignal, nextVideo); });
          if (!prepared) throw new Error("PV 加载超时");
          nextVideoBlob = prepared;
          nextDecoder = await videoPresentation.prepare(prepared);
        }
        signal.throwIfAborted();
      } catch (error) { controller.abort(error); throw error; }
    });
    try { await Promise.all(tasks); }
    catch (error) {
      await Promise.allSettled(tasks);
      nextDecoder?.close();
      if (nextVideoUrl) { nextVideo.pause(); nextVideo.removeAttribute("src"); nextVideo.load(); URL.revokeObjectURL(nextVideoUrl); }
      throw error;
    }
    try { if ("cover" in changes) await setBackground(nextCover); }
    catch (error) {
      nextDecoder?.close();
      if (nextVideoUrl) { nextVideo.pause(); nextVideo.removeAttribute("src"); nextVideo.load(); URL.revokeObjectURL(nextVideoUrl); }
      throw error;
    }
    const playing = audio.playing, second = audio.currentSecond();
    pause();
    const request = playbackRequest;
    audio.track = nextTrack;
    if ("audio" in changes) loadedAudioResource = changes.audio;
    loadedCover = nextCover;
    if ("audio" in changes) updateWaveform(nextTrack);
    if ("video" in changes) {
      video.pause(); video.removeAttribute("src"); video.load();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      videoUrl = nextVideoUrl;
      if (nextVideo) { video.replaceWith(nextVideo); video = nextVideo; }
      videoPresentation.commit(video, nextVideoBlob, nextDecoder);
    }
    video.hidden = hidePv || !video.src;
    if (video.src && !hidePv) call("miacode_external_video", null, ["number"], [1]);
    else await setBackground(loadedCover);
    audio.duration = Math.max(chart?.duration ?? 0, nextTrack?.duration ?? 0);
    playback.exportStartSeconds = Math.min(playback.exportStartSeconds, audio.duration);
    playback.exportEndSeconds = Math.max(playback.exportStartSeconds, Math.min(playback.exportEndSeconds, audio.duration));
    $("seek").max = String(audio.duration);
    audio.seek(Math.min(second, audio.duration));
    if (chart) seek(audio.offset);
    video.playbackRate = playback.rate;
    if (video.src && !performanceOptions.videoDecodePrefersSoftware) positionVideo(audio.offset);
    mediaCache.clear();
    emit("playbackChanged", { ...playback }); updateTransport();
    if (latency.onPage) await setLatency({});
    if (!chart) {
      const doc = JSON.parse(call("miacode_document", "string", [], []));
      if (doc.activeDifficultyId > 0) await documentCommand({ id: "document.selectDifficulty", args: { difficulty: doc.activeDifficultyId } });
    }
    if (playing && chart && request === playbackRequest) await play();
    return previewState();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  function render(now) {
    if (ready && now - fpsSampleTime >= 1000) {
      const frames = call("miacode_frame_count", "number", [], []);
      $("fps").textContent =
        `FPS: ${Math.round(((frames - fpsSampleFrames) * 1000) / (now - fpsSampleTime))}`;
      fpsSampleFrames = frames;
      fpsSampleTime = now;
    }
    if(ready&&introAudition){
      if(frameLimiter.accept(now)){
        playbackDiagnostics.hostFrame(now,introAudition.playing);
        playbackDiagnostics.measure("hostWork",()=>introAudition.tick());
      }
      return;
    }
    if (!ready || !chart || exportJob?.running || !frameLimiter.accept(now)) return;
    playbackDiagnostics.hostFrame(now, audio.playing);
    playbackDiagnostics.measure("hostWork", () => {
      if (audio.playing) {
        const second = audio.currentSecond();
        playbackDiagnostics.measure("audioSchedule", () => audio.schedule());
        playbackDiagnostics.measure("wasmTick", () =>
          call("miacode_tick", null, ["number"], [second]));
        $("seek").value = String(second);
        updateTransport(false);
        const end = playback.rangePlaybackEnabled ? playback.exportEndSeconds : audio.duration;
        if (second >= end) {
          pause();
          seek(end);
          emit("ended", { elapsedMs: elapsed() });
        }
      }
    });
  }
  function videoFollowsScene() {
    const canvasRate = frameLimiter.maxFps === "unlimited" ? Infinity : frameLimiter.maxFps;
    const videoRate = videoPresentation.limiter.maxFps === "unlimited" ? Infinity : videoPresentation.limiter.maxFps;
    return canvasRate >= videoRate;
  }
  function presentVideo(now, force = false) {
    if (!ready || disposed || exportJob?.running) return;
    const second = introAudition ? introVideoSecond : videoFollowsScene() ? renderedSecond : audio?.currentSecond() ?? 0;
    return videoPresentation.tick(now, second,
      Boolean(video.src && !video.hidden && !document.body.classList.contains("cover-view")), WIDTH, HEIGHT, force,
      introAudition ? 1 : playback.rate);
  }
  function videoFrameReady() {
    if (!ready || disposed) return;
    const playing = introAudition?.playing || audio?.playing;
    const second = introAudition ? introVideoSecond : audio?.currentSecond() ?? 0;
    if (!videoFollowsScene() || !playing && renderedSecond === second) presentVideo(performance.now(), !playing);
  }
  function frame(now) {
    try {
      if (ready && chart && video.src && !performanceOptions.videoDecodePrefersSoftware && !introAudition) {
        const playing = audio.playing && audio.context.currentTime >= audio.startedAt && !hidePv && !video.ended;
        if (playing && video.paused) void video.play().catch(() => {});
        else if (!playing && !video.paused) video.pause();
        // Decode ahead by half a 60 Hz frame; presentation selects the rendered scene time.
        const decodeSecond = audio.currentSecond() + (playing ? playback.rate / 120 : 0);
        if (!hidePv && synchronizeVideoClock(video, decodeSecond, playback.rate, playing)) {
          videoPresentation.beginSeek();
          playbackDiagnostics.count("videoResyncs");
        }
      }
      if (ready && !videoFollowsScene()) presentVideo(now);
      render(now);
    } finally {
      // Qt's update() queues its own RAF. Register the next host tick AFTER that
      // request so Qt draws before the next tick, rather than merging two ticks.
      // Keep scheduling after early returns and errors, as the old loop did.
      if (!disposed) frameRequest = requestAnimationFrame(frame);
    }
  }
  frameRequest = requestAnimationFrame(frame);

  function clear() {
    if (disposed) return;
    disposed = true;
    previewDeferred = false;
    lifetime.abort(new DOMException("播放器关闭", "AbortError"));
    cancelAnimationFrame(frameRequest);
    resizeObserver.disconnect();
    exportJob?.controller.abort(lifetime.signal.reason);
    ++generation;
    abort?.abort();
    introAudition?.destroy(); introAudition = null;
    mediaCache.clear(); coverPv.clear();
    if (coverPixelPointer) module._free(coverPixelPointer);
    coverPixelPointer = 0; coverPixelCapacity = 0;
    clearInput();
    diagnostics.dispose(); playbackDiagnostics.dispose();
    analysis?.close();
    ready = false;
    if (module) {
      module.onCoverChanged = module.onCoverPlaybackChanged = module.onPreviewFrame = null;
    }
    if (audio && audio.context.state !== "closed") void audio.context.close().catch(() => {});
    status("");
  }

  function normalizeShortcuts(sequences) {
    const result = JSON.parse(call("miacode_shortcuts", "string", ["string"], [JSON.stringify(sequences)]));
    if (result.error) throw new Error(result.error);
    return result;
  }

  function exportCall(name, types = [], values = []) {
    const result = JSON.parse(call(name,"string",types,values));
    if(result.error)throw new Error(result.error);
    return result;
  }
  function importAppearanceImage(request, data) {
    const pointer = module._malloc(data.length);
    try {
      module.HEAPU8.set(data, pointer);
      return exportCall("miacode_appearance_image", ["string", "number", "number"], [JSON.stringify(request), pointer, data.length]);
    } finally { module._free(pointer); }
  }
  function storeExportAsset(kind,name,data) {
    const bytes = new Uint8Array(data),pointer=module._malloc(bytes.length);
    try {
      module.HEAPU8.set(bytes,pointer);
      return exportCall("miacode_export_asset",["string","string","number","number"],[kind,name,pointer,bytes.length]);
    } finally {module._free(pointer);}
  }
  async function prepareExportAssets(settings,signal,introOnly=false) {
    const files=new Set(introOnly?["answer.wav"]:["answer.wav","clock.wav",...chart.sfx.map(item=>item.file),...chart.sfxMutedTail.map(item=>item.file)]);
    if(!introOnly&&chart.touchholdSegments.length)files.add("touch_Hold_riser.wav");
    if(!introOnly&&settings.introEnabled&&!settings.introPvPreview)files.add("track_start.wav");
    await Promise.all([...files].map(async file=>{
      if(!exportSoundBytes.has(file)){
        const response=await fetch(`./sfx/${encodeURIComponent(file)}`,{signal});
        if(!response.ok)throw new Error(`音效缺失：${file}`);
        exportSoundBytes.set(file,await response.arrayBuffer());
      }
      signal.throwIfAborted();const data=exportSoundBytes.get(file);
      storeExportAsset("sfx",file,data);
      if(!audio.buffers.has(file))audio.buffers.set(file,await audio.context.decodeAudioData(data.slice(0)));
    }));
    signal.throwIfAborted();
    if(loadedAudioResource)storeExportAsset("track","track",await bytes(loadedAudioResource,signal));
    if(loadedCover)storeExportAsset("cover","cover",loadedCover);
    if(settings.introBackground)storeExportAsset("intro_background","background",await bytes(settings.introBackground,signal));
    signal.throwIfAborted();
    const plan=configureExportScene(settings);
    if(settings.sizePresetIndex===3 && video.src)await setBackground(loadedCover);
    return plan;
  }
  function configureExportScene(settings,reconfigure=false) {
    return exportCall(reconfigure?"miacode_export_reconfigure":"miacode_export_prepare",["string"],[JSON.stringify({...settings,duration:audio.duration,
      exportStartSeconds:settings.exportStartSeconds??0,exportEndSeconds:settings.exportEndSeconds??audio.duration,
      videoAvailable:Boolean(video.src)&&!hidePv&&settings.sizePresetIndex!==3,audioAvailable:Boolean(audio.track)})]);
  }
  async function stopIntroAudition() {
    if(!introSaved)return;
    introAudition?.destroy();introAudition=null;introOptions=null;
    introWasPlaying=false;playbackDiagnostics.setEnabled(false);
    const saved=introSaved;introSaved=null;
    call("miacode_export_finish",null,[],[]);
    video.playbackRate=saved.videoRate;
    seek(saved.second);
    emit("introAuditionChanged",{active:false,playing:false,introAuditionLoop:false,elapsed:0,duration:0,introPvStartSeconds:0});
    if(saved.playing)await play();
  }
  async function setIntroAudition(input={}) {
    if(input.enabled===false){await stopIntroAudition();return null;}
    if(!chart)throw new Error("请打开含谱面的项目");
    if(["enabled","playing","introAuditionLoop"].some(key=>key in input&&typeof input[key]!=="boolean"))throw new Error("片头试听状态需要布尔值");
    if ("elapsed" in input && (!Number.isFinite(input.elapsed) || input.elapsed < 0)) throw new Error("片头试听时间无效");
    const controls=new Set(["enabled","playing","introAuditionLoop","elapsed"]);
    const changes=Object.fromEntries(Object.entries(input).filter(([key])=>!controls.has(key)));
    const changed=!introAudition||Object.entries(changes).some(([key,value])=>introOptions[key]!==value);
    const settings={...introOptions,...changes,introEnabled:true,introPvPreview:true,fps:60,width:WIDTH,height:HEIGHT,
      exportStartSeconds:0,exportEndSeconds:audio.duration};
    settings.introPvStartSeconds??=0;
    if(!Number.isFinite(settings.introPvStartSeconds)||settings.introPvStartSeconds<0||settings.introPvStartSeconds>audio.duration)
      throw new Error("片头试听起点超出音轨范围");
    const playing=input.playing??introAudition?.playing??false;
    try {
      if(changed){
        let plan;
        if(!introAudition){
          introSaved={second:audio.currentSecond(),playing:audio.playing,videoRate:video.playbackRate};
          pause();
          plan=await prepareExportAssets(settings,new AbortController().signal,true);
          introAudition=new IntroAudition({context:audio.context,track:audio.track,video,hidePv:()=>hidePv,
            frame:index=>playbackDiagnostics.measure("wasmTick",()=>exportCall("miacode_export_frame",["number"],[index])),
            still:enabled=>call("miacode_export_still",null,["number"],[Number(enabled)]),
            changed:state=>{
              $("play").textContent=state.playing?"暂停":"播放";
              if(introWasPlaying!==state.playing){introWasPlaying=state.playing;playbackDiagnostics.setEnabled(diagnostics.enabled&&state.playing);}
              emit("introAuditionChanged",state);
            },
            softwareVideo:()=>performanceOptions.videoDecodePrefersSoftware,
            presentVideo:second=>{introVideoSecond=second;},
            failed:error=>{void stopIntroAudition().then(()=>fail(error));}});
        }else{
          introAudition.pause();
          if(changes.introBackground)storeExportAsset("intro_background","background",await bytes(changes.introBackground));
          plan=configureExportScene(settings,true);
        }
        introOptions=settings;introAudition.configure(plan,settings);
      }
      if("introAuditionLoop" in input)introAudition.introAuditionLoop=input.introAuditionLoop;
      if("elapsed" in input && introAudition.playing)introAudition.pause();
      if(playing&&!introAudition.playing)await introAudition.play((input.elapsed??0)%introAudition.plan.introAuditionSeconds);
      else if(!playing&&introAudition.playing)introAudition.pause();
      else introAudition.publish();
      return introAudition.state();
    }catch(error){await stopIntroAudition();throw error;}
  }
  function startExport(input = {}) {
    if(!chart)throw new Error("请打开含谱面的项目");
    if(exportJob?.running)throw new Error("视频导出任务运行中");
    exportSettings(input);
    const job={jobId:crypto.randomUUID(),running:true,stage:"preparing",progress:0,controller:new AbortController()};
    exportJob=job;
    const {signal}=job.controller;
    const saved={width:WIDTH,height:HEIGHT,second:audio.currentSecond(),playing:audio.playing,videoSecond:video.currentTime,
      settings:exportCall("miacode_settings")};
    pause();
    const adapter={
      track:()=>audio.track,sounds:()=>audio.buffers,video:()=>video,hidePv:()=>hidePv,mediaGeometry,
      videoFrame: async (second, signal) => {
        if (videoPresentation.decoder) return videoPresentation.decoder.at(second);
        await seekVideo(video, second, signal); return video;
      },
      prepare:async(settings,signal)=>{
        setSurfaceSize(settings.width,settings.height);
        exportCall("miacode_set_canvas_size",["number","number"],[settings.width,settings.height]);
        exportCall("miacode_set_settings",["string"],[JSON.stringify(saved.settings)]);
        return prepareExportAssets(settings,signal);
      },
      frameInfo:index=>exportCall("miacode_export_frame_info",["number"],[index]),
      capture:(index,signal,draw)=>new Promise((resolve,reject)=>{
        const finish=error=>{
          module.onExportFrame=null;signal.removeEventListener("abort",cancel);
          error?reject(error):resolve();
        };
        const cancel=()=>finish(signal.reason);
        signal.addEventListener("abort",cancel,{once:true});
        module.onExportFrame=()=>{
          try{draw($("qt-screen").querySelector("#qt-shadow-container").shadowRoot.querySelector("canvas"));finish();}
          catch(error){finish(error);}
        };
        try{signal.throwIfAborted();exportCall("miacode_export_frame",["number"],[index]);}
        catch(error){finish(error);}
      }),
      finish:async()=>{
        module.onExportFrame=null;call("miacode_export_finish",null,[],[]);
        setSurfaceSize(saved.width,saved.height);
        exportCall("miacode_set_canvas_size",["number","number"],[saved.width,saved.height]);
        exportCall("miacode_set_settings",["string"],[JSON.stringify(saved.settings)]);
        seek(saved.second);if(video.src)video.currentTime=saved.videoSecond;
        if(saved.playing)await play();
      },
    };
    job.promise=encodeVideoExport(adapter,input,signal,update=>{
      Object.assign(job,update);emit("exportProgress",{jobId:job.jobId,...update});
    }).then(result=>{
      job.stage="completed";job.progress=1;emit("exportCompleted",{jobId:job.jobId,...result});
    },error=>{
      job.stage=signal.aborted?"cancelled":"failed";job.message=error.message;
      emit("exportFailed",{jobId:job.jobId,cancelled:signal.aborted,message:error.message});
    }).finally(()=>{job.running=false;});
    return {jobId:job.jobId};
  }

  return {
    boot,
    setIntroAudition,
    setPerformance: async changes => {
      const next = performanceSettings(performanceOptions, changes);
      await videoPresentation.configure(next);
      try { await coverPv.configure(next); }
      catch (error) { await videoPresentation.configure(performanceOptions); throw error; }
      performanceOptions = next;
      if ("canvasFrameRateMode" in changes) frameLimiter = new PreviewFrameLimiter(frameRateForMode(next.canvasFrameRateMode));
      if (!next.videoDecodePrefersSoftware && video.src && !hidePv) {
        positionVideo(introAudition ? introVideoSecond : audio?.currentSecond() ?? 0);
        if (audio?.playing || introAudition?.playing) void video.play().catch(() => {});
      }
      return { ...performanceOptions };
    },
    stopIntroAudition,
    introAuditionActive:()=>Boolean(introAudition),
    getExportCapabilities:exportCapabilities,
    startExport,
    exportRunning:()=>Boolean(exportJob?.running),
    cancelExport:async()=>{
      const job=exportJob;
      if(job?.running){job.controller.abort(new DOMException("视频导出取消","AbortError"));await job.promise;}
      return {jobId:job?.jobId??null};
    },
    getExportStatus:()=>exportJob?{jobId:exportJob.jobId,running:exportJob.running,stage:exportJob.stage,progress:exportJob.progress,message:exportJob.message}:null,
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
    seek: async second => {
      seek(second);
      if (video.src && !hidePv) {
        await videoPresentation.ready(audio.offset, abort.signal);
        if (renderedSecond === audio.currentSecond()) await presentVideo(performance.now(), true);
      }
    },
    fail,
    clear,
    state: previewState,
    normalizeBackground: values => {
      const result = JSON.parse(call("miacode_background_settings", "string", ["string"], [JSON.stringify(values)]));
      if (result.error) throw new Error(result.error);
      return result;
    },
    importCoverImage: async image => {
      if (!image) throw new Error("请选择图片文件");
      const data = new Uint8Array(await bytes(image)), pointer = module._malloc(data.length);
      try {
        module.HEAPU8.set(data, pointer);
        return exportCall("miacode_cover_image", ["number", "number"], [pointer, data.length]);
      } finally { module._free(pointer); }
    },
    exportCover: async ({ type = "image/png", quality = .95 } = {}) => {
      if (!["image/png", "image/jpeg"].includes(type) || !Number.isFinite(quality) || quality < 0 || quality > 1)
        throw new Error("封面图片格式或质量无效");
      let state = exportCall("miacode_cover_state");
      if (state.chartFramePlaying) state = exportCall("miacode_cover_command", ["string"], [JSON.stringify({ id: "cover.toggleActiveLayerPlayback", args: {} })]);
      await coverPv.prepareExport(state);
      if (!state.outputWidth || !state.outputHeight) throw new Error("请打开封面编辑器");
      const canvas = document.createElement("canvas");
      canvas.width = state.outputWidth; canvas.height = state.outputHeight;
      const context = canvas.getContext("2d");
      try {
        await new Promise((resolve, reject) => {
          let timer;
          const finish = error => { clearTimeout(timer); module.onExportFrame = null; error ? reject(error) : resolve(); };
          timer = setTimeout(() => finish(new Error("封面画面捕获超时")), 15000);
          module.onExportFrame = () => {
            try {
              if (type === "image/jpeg") { context.fillStyle = "#000"; context.fillRect(0, 0, canvas.width, canvas.height); }
              context.drawImage($("qt-screen").querySelector("#qt-shadow-container").shadowRoot.querySelector("canvas"), 0, 0);
              finish();
            } catch (error) { finish(error); }
          };
          try { exportCall("miacode_cover_capture", ["number"], [1]); }
          catch (error) { finish(error); }
        });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
        if (!blob) throw new Error("封面图片编码失败");
        return { blob, mimeType: blob.type, width: canvas.width, height: canvas.height };
      } finally {
        module.onExportFrame = null;
        exportCall("miacode_cover_capture", ["number"], [0]);
      }
    },
    importSkin: async files => {
      const hex = data => Array.from(new Uint8Array(data), value => value.toString(16).padStart(2, "0")).join("");
      const prepared = [];
      for (const file of files) {
        const data = new Uint8Array(await bytes(file.image));
        const hash = hex(await crypto.subtle.digest("SHA-256", data));
        prepared.push({ path: file.path, data, hash });
      }
      const key = new TextEncoder().encode(JSON.stringify(prepared.map(({ path, hash }) => [path, hash])));
      const skinDirectoryName = `skin-${hex(await crypto.subtle.digest("SHA-256", key))}`;
      const operation = name => exportCall("miacode_appearance_skin", ["string", "string"], [name, skinDirectoryName]);
      if (!operation("begin").ready) {
        try {
          for (const file of prepared) importAppearanceImage({ kind: "skin", skinDirectoryName, path: file.path }, file.data);
          operation("commit");
        } catch (error) { operation("abort"); throw error; }
      }
      return { skinDirectoryName, imageCount: prepared.length };
    },
    importJudgeLine: async image => {
      const result = importAppearanceImage({ kind: "outline" }, new Uint8Array(await bytes(image)));
      return { customOutlineFileName: result.customOutlineFileName, width: result.width, height: result.height };
    },
    importFont: async (font, name) => {
      if (!font) throw new Error("请选择字体文件");
      const data = new Uint8Array(await bytes(font)), pointer = module._malloc(data.length);
      try {
        module.HEAPU8.set(data,pointer);
        const result = JSON.parse(call("miacode_import_font", "string", ["number", "number", "string"], [pointer,data.length,name]));
        if (result.error) throw new Error(result.error);
        return result;
      } finally { module._free(pointer); }
    },
    normalizeShortcuts,
    setInputShortcuts: sequences => {
      const bindings = normalizeShortcuts(sequences);
      if (bindings["preview.pause_display_hold"]?.wheelDirection) throw new Error("按住显示需要键盘组合键");
      inputShortcuts = bindings; return inputShortcuts;
    },
    readAudioInfo: async resource => {
      if (!resource) throw new Error("请选择音频文件");
      const data = new Uint8Array(await bytes(resource));
      const pointer = module._malloc(data.length);
      try {
        module.HEAPU8.set(data, pointer);
        const result = JSON.parse(call("miacode_audio_info", "string", ["number", "number"], [pointer, data.length]));
        if (result.error) throw new Error(result.error);
        return result;
      } finally { module._free(pointer); }
    },
    setResources,
    defaultSettings: () => defaultSettings,
    getTimeline: options => JSON.parse(call("miacode_timeline", "string", ["string"], [JSON.stringify(options)])),
    navigateTimeline: point => JSON.parse(call("miacode_timeline_navigate", "string", ["number", "number"], [point.x, point.y])),
    getTimelineFollow: second => JSON.parse(call("miacode_timeline_follow", "string", ["number"], [second])),
    getDocument: () => JSON.parse(call("miacode_document", "string", [], [])),
    getAnalysis: language => {
      const input = JSON.parse(call("miacode_analysis_input", "string", ["string"], [language || "zh"]));
      if (!input.hasDocument) return { available: false, pending: false, revision: input.revision,
        documentOpenGeneration: input.documentOpenGeneration, difficultyId: input.difficultyId,
        validationRows: [], muriRows: [], syntaxErrorCount: 0, syntaxWarningCount: 0 };
      analysis ||= new PreviewAnalysis(identity, runtimeManifest);
      return analysis.analyze(input);
    },
    flushPreview,
    setLatency,
    detectLatency,
    getDocumentSaveText: section => JSON.parse(call("miacode_document_save_text", "string", ["number"], [section])),
    documentCommand,
    editorCommand: request => JSON.parse(call("miacode_editor_command", "string", ["string"], [JSON.stringify(request)])),
    audioCommand: request => {
      const result = JSON.parse(call("miacode_audio_command", "string", ["string"], [JSON.stringify(request)]));
      if (result.error) throw new Error(result.error);
      const tailChanged = audioSettings?.breakSlideTailCheerMuted !== result.breakSlideTailCheerMuted;
      audioSettings = result;
      audio?.setMix(activeAudioGains());
      if (tailChanged && chart && !latency.onPage) {
        const second = audio.currentSecond(), playing = audio.playing;
        audio.pause();
        audio.events = result.breakSlideTailCheerMuted ? chart.sfxMutedTail : chart.sfx;
        audio.seek(second);
        if (playing) audio.start();
      }
      return result;
    },
    setCanvasSize: size => {
      size=canvasResolution(size);
      setSurfaceSize(size.width,size.height);
      const result = JSON.parse(call("miacode_set_canvas_size", "string", ["number", "number"], [size.width, size.height]));
      if(introAudition){introAudition.lastFrame=-1;introAudition.tick();}
      return result;
    },
    setMediaSettings: async settings => {
      if (!settings || Object.keys(settings).length !== 1 || typeof settings.hidePv !== "boolean")
        throw new Error("Media settings require a boolean hidePv");
      hidePv = settings.hidePv;
      if (video.src) {
        video.hidden = hidePv;
        if (hidePv) { video.pause(); await setBackground(loadedCover); }
        else {
          call("miacode_external_video", null, ["number"], [1]);
          if (!performanceOptions.videoDecodePrefersSoftware) {
            positionVideo(audio.currentSecond());
            if (audio.playing) void video.play().catch(() => {});
          }
        }
      }
      return { hidePv };
    },
    setPlayback: changes => {
      const result = playbackSettings(playback, changes, audio?.duration ?? 0);
      if (audio && result.rate !== playback.rate) audio.setRate(result.rate);
      playback = result;
      video.playbackRate = result.rate;
      if (result.rangePlaybackEnabled && audio && (audio.offset < result.exportStartSeconds || audio.offset > result.exportEndSeconds))
        seek(result.exportStartSeconds);
      updateTransport();
      return { ...result };
    },
    setTheme: theme => { view.theme?.(theme); return theme; },
    setCoverComposition: async composition => {
      if (coverState?.chartFramePlaying) exportCall("miacode_cover_state");
      pause();
      const result = JSON.parse(call("miacode_cover", "string", ["string"], [JSON.stringify(composition)]));
      if (!result.error) {
        coverState = result;
        await coverPv.update(result);
        document.body.classList.add("cover-view");
        $("transport").hidden = true;
        setSurfaceSize(result.outputWidth, result.outputHeight);
      }
      return result;
    },
    setCoverChart: async (resources, duration) => {
      const text = new TextDecoder().decode(await bytes(resources.maidata));
      const chart = exportCall("miacode_load", ["string", "number", "string"], [text, resources.difficulty ?? 0, resources.filePath || ""]);
      exportCall("miacode_cover_chart", ["number"], [Math.max(chart.duration, duration ?? 0)]);
      const blob = resources.video ? resources.video instanceof Blob ? resources.video : new Blob([await bytes(resources.video)]) : null;
      await coverPv.setSource(blob);
      coverState = exportCall("miacode_cover_state");
      return coverState;
    },
    getCoverComposition: () => JSON.parse(call("miacode_cover_state", "string", [], [])),
    coverCommand: async request => {
      if (coverState?.chartFramePlaying) exportCall("miacode_cover_state");
      const result = JSON.parse(call("miacode_cover_command", "string", ["string"], [JSON.stringify(request)]));
      if (result.error) throw new Error(result.error);
      coverState = result;
      await coverPv.update(result);
      setSurfaceSize(result.outputWidth, result.outputHeight);
      return result;
    },
    setSettings: (settings) => {
      const result = JSON.parse(
        call(
          "miacode_set_settings",
          "string",
          ["string"], [JSON.stringify(settings)],
        ),
      );
      if (!result.error) { appearance = result; videoPresentation.invalidatePlacement(); view.settings(result); }
      return result;
    },
  };
}

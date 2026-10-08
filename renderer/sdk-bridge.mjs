import {
  SDK_PROTOCOL,
  FRAME_SOURCE,
  trustedRequest,
  normalizeSettings,
  difficultyId,
  httpUrl,
} from "./protocol.mjs";
import { fetchVerified } from "./runtime.mjs";

export function attachSdkBridge(engine) {
  const originValue = new URLSearchParams(location.search).get("hostOrigin");
  // A normal website/player launch never enables this independent protocol.
  if (!originValue || window.parent === window) return;
  let origin;
  try {
    origin = new URL(httpUrl(originValue)).origin;
  } catch {
    return;
  }
  if (origin !== originValue) return;
  let sessionId = null,
    disposed = false,
    resources,
    queue = Promise.resolve();
  const abort = new AbortController();
  const send = (type, payload, extra = {}) => {
    if (!sessionId || disposed) return;
    const identity = engine.identity();
    window.parent.postMessage(
      {
        source: FRAME_SOURCE,
        protocolVersion: SDK_PROTOCOL,
        sessionId,
        playerVersion: identity?.version,
        sourceRevision: identity?.sourceRevision,
        type,
        payload,
        ...extra,
      },
      origin,
    );
  };
  engine.events((type, payload) => send(type, payload));
  async function file(value, name) {
    if (!value) return null;
    if (value instanceof Blob)
      return new File([value], name, { type: value.type });
    if (typeof value.text === "string")
      return new File([value.text], name, { type: "text/plain" });
    const url = httpUrl(value.url);
    if (value.sha256 !== undefined || value.byteSize !== undefined) {
      const data = await fetchVerified({ ...value, url }, abort.signal);
      return new File([data], name, { type: value.contentType ?? "" });
    }
    const response = await fetch(url, {
      credentials: "omit",
      signal: abort.signal,
    });
    if (!response.ok)
      throw new Error(`Resource loading failed (${response.status}): ${name}`);
    return new File([await response.arrayBuffer()], name, {
      type: value.contentType ?? response.headers.get("content-type") ?? "",
    });
  }
  const loadedInfo = () => {
    const chart = engine.chart();
    if (!chart) throw new Error("Chart loading was cancelled");
    const { title, artist, difficultyId, noteCount, charts } = chart;
    return {
      title,
      artist,
      difficultyId,
      noteCount,
      charts,
      duration: engine.state().duration,
    };
  };
  const requireChart = () => {
    if (!engine.chart()) throw new Error("Load a chart first");
  };
  async function execute(message) {
    const payload = message.payload ?? {};
    await engine.boot;
    const identity = engine.identity();
    if (message.type === "initialize") {
      if (
        payload.playerVersion !== identity.version ||
        payload.sourceRevision !== identity.sourceRevision
      )
        throw new Error("Renderer build identity mismatch");
      send("ready", {
        playerVersion: identity.version,
        sourceRevision: identity.sourceRevision,
      });
      return engine.state();
    }
    if (message.type === "load") {
      if (!payload.maidata) throw new Error("maidata is required");
      const difficulty = difficultyId(payload.difficulty);
      engine.clear();
      send("progress", { stage: "正在加载资源", progress: 0.01 });
      const [maidata, audio, cover, video] = await Promise.all([
        file(payload.maidata, "maidata.txt"),
        file(payload.audio, "track"),
        file(payload.cover, "cover"),
        file(payload.video, "bg"),
      ]);
      resources = { maidata, audio, cover, video };
      await engine.load(resources, difficulty);
      return loadedInfo();
    }
    if (message.type === "getState") return engine.state();
    if (message.type === "setSettings") {
      const settings = {
        ...engine.state().settings,
        ...normalizeSettings(payload),
      };
      const result = engine.setSettings(settings);
      if (result.error) throw new Error(result.error);
      send("settingsChanged", result);
      return result;
    }
    if (message.type === "destroy") {
      engine.clear();
      resources = null;
      return null;
    }
    requireChart();
    if (message.type === "play") await engine.play();
    else if (message.type === "pause") engine.pause();
    else if (message.type === "restart") {
      engine.seek(0);
      await engine.play();
    } else if (message.type === "seek") {
      if (!Number.isFinite(payload.second) || payload.second < 0)
        throw new Error("Seek time must be finite and non-negative");
      engine.seek(payload.second);
      send("seeked", { currentTime: engine.state().currentTime });
    } else if (message.type === "selectDifficulty") {
      const difficulty = difficultyId(payload.difficulty);
      if (difficulty === null) throw new Error("Difficulty is required");
      if (!engine.chart().charts.some((chart) => chart.id === difficulty))
        throw new Error("Difficulty is not present in this chart");
      await engine.load(resources, difficulty);
      return loadedInfo();
    }
    return engine.state();
  }
  const receive = (event) => {
    const message = trustedRequest(event, window.parent, origin, sessionId);
    if (!message || disposed) return;
    if (!sessionId) {
      if (message.type !== "initialize") return;
      sessionId = message.sessionId;
    }
    queue = queue.then(async () => {
      try {
        send("response", null, {
          requestId: message.requestId,
          ok: true,
          value: await execute(message),
        });
      } catch (error) {
        if (disposed) return;
        if (message.type === "load" || message.type === "selectDifficulty")
          engine.fail(error);
        send("response", null, {
          requestId: message.requestId,
          ok: false,
          error: { message: error.message ?? "Preview command failed" },
        });
      }
    });
  };
  window.addEventListener("message", receive);
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      abort.abort();
      window.removeEventListener("message", receive);
    },
    { once: true },
  );
}

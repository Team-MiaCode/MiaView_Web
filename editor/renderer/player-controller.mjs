import { normalizeChart, normalizeSettings, difficultyId, commands, previewTheme } from "./protocol.mjs";

// The single command boundary used by both component controls and the SDK.
export function createPlayerController(engine) {
  let resources;
  const listeners = new Set();
  const emit = (type, payload) => {
    for (const listener of listeners) listener(type, payload);
  };
  engine.events(emit);
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
  async function executeCommand(type, payload = {}) {
    if (!commands.has(type) || type === "initialize")
      throw new Error(`Unsupported player command: ${type}`);
    await engine.boot;
    if (type === "load") {
      if (!payload.maidata) throw new Error("maidata is required");
      const difficulty = difficultyId(payload.difficulty);
      // Keep source descriptors intact so parsing, decoding and PV buffering
      // start together in the renderer rather than after every download ends.
      resources = normalizeChart({
        ...payload,
        maidata:
          typeof payload.maidata.text === "string"
            ? payload.maidata.text
            : payload.maidata,
      });
      emit("progress", { stage: "正在加载资源", progress: 0.01 });
      await engine.load(resources, difficulty);
      return loadedInfo();
    }
    if (type === "getState") return engine.state();
    if (type === "setPlayback") {
      const result = engine.setPlayback(payload);
      emit("playbackChanged", result);
      return result;
    }
    if (type === "setMediaSettings") return engine.setMediaSettings(payload);
    if (type === "setCanvasSize") {
      const result = engine.setCanvasSize(payload);
      if (result.error) throw new Error(result.error);
      return result;
    }
    if (type === "getTimeline") {
      const result = engine.getTimeline(payload);
      if (result.error) throw new Error(result.error);
      return result;
    }
    if (type === "navigateTimeline") return engine.navigateTimeline(payload);
    if (type === "getTimelineFollow") return engine.getTimelineFollow(payload.second);
    if (type === "getDocument") return engine.getDocument();
    if (type === "getDocumentSaveText") return engine.getDocumentSaveText(payload.section);
    if (type === "documentCommand") return engine.documentCommand(payload);
    if (type === "setCoverComposition") {
      const result = engine.setCoverComposition(payload);
      if (result.error) throw new Error(result.error);
      return result;
    }
    if (type === "getCoverComposition") return engine.getCoverComposition();
    if (type === "setTheme") return engine.setTheme(previewTheme(payload.theme));
    if (type === "getDiagnostics") return engine.diagnostics();
    if (type === "resetDiagnostics") return engine.resetDiagnostics();
    if (type === "setDiagnostics") {
      if (typeof payload.enabled !== "boolean")
        throw new Error("diagnostics must be a boolean");
      return engine.setDiagnostics(payload.enabled);
    }
    if (type === "setSettings") {
      const settings = {
        ...engine.state().settings,
        ...normalizeSettings(payload),
      };
      const result = engine.setSettings(settings);
      if (result.error) throw new Error(result.error);
      emit("settingsChanged", result);
      return result;
    }
    if (type === "destroy") {
      engine.clear();
      resources = null;
      return null;
    }
    if (type === "selectDifficulty") {
      const difficulty = difficultyId(payload.difficulty);
      if (difficulty === null) throw new Error("Difficulty is required");
      if (!engine.getDocument().charts.some(chart => chart.id === difficulty))
        throw new Error("Difficulty is not present in this chart");
      await engine.documentCommand({ id: "document.selectDifficulty", args: { difficulty } });
      return engine.chart() ? loadedInfo() : engine.getDocument();
    }
    requireChart();
    if (type === "play") await engine.play();
    else if (type === "pause") engine.pause();
    else if (type === "restart") {
      engine.seek(0);
      await engine.play();
    } else if (type === "seek") {
      if (!Number.isFinite(payload.second) || payload.second < 0)
        throw new Error("Seek time must be finite and non-negative");
      engine.seek(payload.second);
      emit("seeked", { currentTime: engine.state().currentTime });
    }
    return engine.state();
  }

  let queue = Promise.resolve();
  return {
    events(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    execute(type, payload) {
      const pending = queue.then(() => executeCommand(type, payload));
      queue = pending.catch(() => {});
      return pending;
    },
  };
}

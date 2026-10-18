import { normalizeChart, normalizeResources, normalizeSettings, normalizeSkinFiles, difficultyId, commands, previewTheme } from "./protocol.mjs";
import { performanceSettings } from "./performance-settings.mjs";

// The single command boundary used by both component controls and the SDK.
export function createPlayerController(engine) {
  let resources;
  const chartInput = value => normalizeChart({ ...value,
    maidata: typeof value?.maidata?.text === "string" ? value.maidata.text : value?.maidata });
  const listeners = new Set();
  const emit = (type, payload) => {
    for (const listener of listeners) listener(type, payload);
  };
  engine.events(emit);
  const introSafeCommands=new Set(["setIntroAudition","getState","getDocument","getAnalysis","getDocumentSaveText","getDiagnostics","getExportStatus","getExportCapabilities",
    "getCoverComposition","getTimeline","navigateTimeline","getTimelineFollow","normalizeShortcuts","normalizeBackground","readAudioInfo","importFont","setInputShortcuts","setTheme","setCanvasSize","setDiagnostics","resetDiagnostics","setPerformance","play","pause"]);
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
    if (engine.exportRunning() && !["getState","getExportStatus","cancelExport","destroy","getDocument","getDiagnostics","getExportCapabilities"].includes(type))
      throw new Error("视频导出任务占用此预览实例，请通过独立预览实例编辑谱面");
    const inputContextOnly = type === "setSettings" && Object.keys(payload).every(key => key === "touchPadAuthoringContext");
    if(engine.introAuditionActive()&&!introSafeCommands.has(type)&&!inputContextOnly)await engine.stopIntroAudition();
    if (!["load", "destroy", "documentCommand", "editorCommand", "getDocument", "getDocumentSaveText", "getAnalysis"].includes(type))
      await engine.flushPreview();
    if (type === "load") {
      if (!payload.maidata) throw new Error("maidata is required");
      const difficulty = difficultyId(payload.difficulty);
      // Keep source descriptors intact so parsing, decoding and PV buffering
      // start together in the renderer rather than after every download ends.
      resources = chartInput(payload);
      emit("progress", { stage: "正在加载资源", progress: 0.01 });
      await engine.load(resources, difficulty);
      return loadedInfo();
    }
    if (type === "getState") return engine.state();
    if (type === "setPerformance") return engine.setPerformance(performanceSettings({}, payload));
    if (type === "setIntroAudition") return engine.setIntroAudition(payload);
    if (type === "getExportCapabilities") return engine.getExportCapabilities(payload);
    if (type === "startExport") return engine.startExport(payload);
    if (type === "cancelExport") return engine.cancelExport();
    if (type === "getExportStatus") return engine.getExportStatus();
    if (type === "readAudioInfo") return engine.readAudioInfo(normalizeResources({ audio: payload.audio }).audio);
    if (type === "normalizeShortcuts") return engine.normalizeShortcuts(payload);
    if (type === "setInputShortcuts") return engine.setInputShortcuts(payload);
    if (type === "normalizeBackground") return engine.normalizeBackground(payload);
    if (type === "importFont") {
      if (typeof payload.name !== "string") throw new Error("A font filename is required");
      return engine.importFont(normalizeResources({ audio: payload.font }).audio, payload.name);
    }
    if (type === "setPlayback") {
      const result = engine.setPlayback(payload);
      emit("playbackChanged", result);
      return result;
    }
    if (type === "setMediaSettings") return engine.setMediaSettings(payload);
    if (type === "setResources") {
      const changes = normalizeResources(payload);
      const result = await engine.setResources(changes);
      resources = { ...resources, ...changes };
      return result;
    }
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
    if (type === "getAnalysis") return engine.getAnalysis(payload.language);
    if (type === "getDocumentSaveText") return engine.getDocumentSaveText(payload.section);
    if (type === "documentCommand") return engine.documentCommand(payload);
    if (type === "editorCommand") return engine.editorCommand(payload);
    if (type === "audioCommand") return engine.audioCommand(payload);
    if (type === "setLatency") return engine.setLatency(payload);
    if (type === "detectLatency") return engine.detectLatency(payload);
    if (type === "setCoverComposition") {
      const result = await engine.setCoverComposition(payload);
      if (result.error) throw new Error(result.error);
      return result;
    }
    if (type === "setCoverChart") {
      if (payload.duration !== undefined && (!Number.isFinite(payload.duration) || payload.duration < 0)) throw new Error("Cover chart duration must be nonnegative");
      return engine.setCoverChart(chartInput(payload.chart), payload.duration);
    }
    if (type === "getCoverComposition") return engine.getCoverComposition();
    if (type === "coverCommand") return engine.coverCommand(payload);
    if (type === "importCoverImage") return engine.importCoverImage(normalizeResources({ cover: payload.image }).cover);
    if (type === "importSkin") return engine.importSkin(normalizeSkinFiles(payload.files));
    if (type === "importJudgeLine") return engine.importJudgeLine(normalizeResources({ cover: payload.image }).cover);
    if (type === "exportCover") return engine.exportCover(payload);
    if (type === "setTheme") return engine.setTheme(previewTheme(payload.theme));
    if (type === "getDiagnostics") return engine.diagnostics();
    if (type === "resetDiagnostics") return engine.resetDiagnostics();
    if (type === "setDiagnostics") {
      if (typeof payload.enabled !== "boolean")
        throw new Error("diagnostics must be a boolean");
      return engine.setDiagnostics(payload.enabled);
    }
    if (type === "setSettings") {
      const settings = normalizeSettings(payload);
      const result = engine.setSettings(settings);
      if (result.error) throw new Error(result.error);
      emit("settingsChanged", result);
      return result;
    }
    if (type === "destroy") {
      await engine.cancelExport();
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
      await engine.seek(0);
      await engine.play();
    } else if (type === "seek") {
      if (!Number.isFinite(payload.second) || payload.second < 0)
        throw new Error("Seek time must be finite and non-negative");
      await engine.seek(payload.second);
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
      if (type !== "getAnalysis") queue = pending.catch(() => {});
      return pending;
    },
  };
}

import { createPreview } from "./sdk/index.mjs";
import { ViewState } from "./services/view-state.mjs";
import { Workbench } from "./ui/workbench/workbench.mjs";
import { inspectChartFolder } from "./services/chart-folder.mjs";
import { openDialog } from "./ui/components/dialog.mjs";
import { element as h } from "./ui/components/dom.mjs";

const SAMPLE = "&title=MiaCode Example\n&artist=MiaCode\n&first=0\n&lv_5=12\n&des_5=MiaCode\n&inote_5=(120){4}\n1,2,3,4,5,6,7,8,\n1b,2x,3h[4:1],4-8[4:1],\nA1,B2,C,D3,E4,E\n";
export function createWorkbench(container, options = {}) {
  const viewState = new ViewState(options.storage ?? localStorage);
  const workbench = new Workbench(container, viewState);
  workbench.nativeCover = true;
  let preview;
  let coverSource;
  let theme = viewState.activeThemeToken;
  const abort = new AbortController();
  const initialResolution = options.preview?.resolution ?? { width: 1080, height: 1080 };
  let canvasSize = "";
  let timelineSequence = 0;
  let loadSequence = 0;
  let loadingDocument = false;
  let editSequence = 0;
  let editPending = Promise.resolve();
  const timelineOptions = { zoomScale: .5, horizontalScrollValue: 0, cursorSeconds: 0, waveformBrightness: .5, measureLineBrightness: 1, followPreviewEnabled: false };
  workbench.timelineControls.update(timelineOptions);
  async function updateTimelineFollow(second) {
    const doc = workbench.documentSession;
    if (!timelineOptions.followPreviewEnabled || !doc.hasDocument || loadingDocument) return;
    const state = await preview.getTimelineFollow(second);
    if (doc !== workbench.documentSession || !timelineOptions.followPreviewEnabled || loadingDocument) return;
    workbench.sourceEditor.setFollowState({ ...state, reveal: true });
  }
  async function refreshTimeline() {
    if (!preview) return;
    const bounds = workbench.timelineView.root.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const sequence = ++timelineSequence;
    const style = getComputedStyle(workbench.root);
    const colors = {};
    for (const key of ["window", "header", "sidebar", "base", "border", "axis", "gridMajor", "gridSubdivision", "gridMinor", "laneEven", "laneOdd", "label", "textSecondary", "waveStroke"]) {
      const surface = { window: "surface", header: "panel", sidebar: "panel", base: "surface" }[key];
      const value = style.getPropertyValue(surface ? `--background-${surface}` : `--timeline-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`).trim();
      const channels = value.startsWith("rgb") ? value.match(/[\d.]+/g).map(Number) : null;
      colors[key] = channels ? [channels[0], channels[1], channels[2], channels[3] ?? 1] : value;
    }
    const state = await preview.getTimeline({ ...timelineOptions, width: Math.round(bounds.width), height: Math.round(bounds.height), colors,
      ...workbench.timelineControls.headerLimits(bounds),
      noteSkin: workbench.documentSession.previewSettings?.noteSkin || "DX",
      playheadSeconds: workbench.previewTransport.state.currentTime });
    if (sequence !== timelineSequence) return;
    workbench.documentSession.timelineSceneState = state;
    workbench.timelineView.setState(state);
  }
  const canvasResize = new ResizeObserver(() => { void fitCanvas().catch(error => workbench.status(error.message)); });
  async function fitCanvas() {
    if (!preview) return;
    const bounds = workbench.previewContainer.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const scale = Math.min(1080 / bounds.height, 4096 / Math.max(bounds.width, bounds.height));
    const size = viewState.preferences.previewCanvasFreeAspect
      ? { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) }
      : initialResolution;
    const key = `${size.width}x${size.height}`;
    if (key === canvasSize) return;
    canvasSize = key;
    await preview.setCanvasSize(size);
  }
  const reader = async (accept, multiple = false, directory = false) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept; input.multiple = multiple;
    if (directory) input.setAttribute("webkitdirectory", "");
    return new Promise(resolve => {
      input.addEventListener("change", () => resolve([...input.files]), { once: true });
      input.addEventListener("cancel", () => resolve([]), { once: true });
      input.click();
    });
  };
  function chooseProject(projects) {
    const select = h("select", { "aria-label": "谱面文件夹" }, projects.map((project, index) => h("option", { value: index }, project.label)));
    return new Promise(resolve => {
      openDialog(container, { title: "选择谱面文件夹", body: h("div", {}, h("p", {}, "所选目录包含多个谱面文件夹，请选择要打开的谱面。"), select), height: 260,
        actions: [{ label: "取消", value: "cancel" }, { label: "打开", value: "open", primary: true }],
        close: result => resolve(result === "open" ? projects[Number(select.value)] : null) });
    });
  }
  function mountPreview() {
    workbench.previewContainer.replaceChildren();
    preview = createPreview(workbench.previewContainer, {
      resolution: { width: 1080, height: 1080 }, layout: "fit", diagnostics: false,
      theme: viewState.activeThemeToken, ...options.preview, controls: false,
    });
    preview.on("progress", event => workbench.status(event.stage));
    preview.on("error", event => workbench.status(event.message));
    preview.on("timeupdate", state => {
      applyPlaybackState(state);
      workbench.timelineView.updatePlayhead(state.currentTime);
      void updateTimelineFollow(state.currentTime).catch(error => workbench.status(error.message));
    });
    preview.on("playbackChanged", playback => workbench.previewTransport.update({ playback }));
    return preview.ready.then(async () => {
      await preview.setMediaSettings({ hidePv: Boolean(viewState.preferences.previewHidePv) });
      return preview;
    });
  }
  function applyPlaybackState(state) {
    workbench.previewTransport.update(state);
    Object.assign(workbench.documentSession, { statistics: state.statistics, statisticsAvailable: state.statisticsAvailable });
    workbench.noteStatistics.update(state.statistics || [], { dataAvailable: state.statisticsAvailable,
      noteSkin: workbench.documentSession.previewSettings?.noteSkin });
  }
  async function open(input, filePath = "maidata.txt", folderFiles = new Map()) {
    const sequence = ++loadSequence;
    loadingDocument = true;
    workbench.status("读取谱面");
    let info, previewError;
    try { info = await preview.load({ ...input, filePath }); }
    catch (error) { previewError = error.message; }
    if (sequence !== loadSequence) return info;
    let snapshot;
    try { snapshot = await preview.getDocument(); }
    finally { if (sequence === loadSequence) loadingDocument = false; }
    if (sequence !== loadSequence) return info;
    if (coverSource) URL.revokeObjectURL(coverSource);
    coverSource = input.cover instanceof Blob ? URL.createObjectURL(input.cover) : undefined;
    const pathOf = file => file?.webkitRelativePath || file?.name || "";
    workbench.sourceEditor.setFollowState({ active: false });
    workbench.setDocument({ ...info, ...snapshot, previewError, folderFiles,
      trackAvailable: Boolean(input.audio), videoAvailable: Boolean(input.video), metadataHasVideo: Boolean(input.video),
      metadataCoverSource: coverSource, metadataResolvedVideoPath: pathOf(input.video), trackPath: pathOf(input.audio), coverPath: pathOf(input.cover) });
    viewState.openEditor(snapshot.activeDifficultyId ? `difficulty:${snapshot.activeDifficultyId}` : "metadata");
    applyPlaybackState(await preview.getState());
    timelineOptions.horizontalScrollValue = 0;
    await refreshTimeline();
    workbench.status(previewError || `${snapshot.title || filePath} · ${info.noteCount} 个音符`);
    return info;
  }
  function applyDocument(snapshot) {
    workbench.setDocument({ ...workbench.documentSession, ...snapshot, difficultyId: snapshot.activeDifficultyId });
  }
  const save = async (all = false) => {
    await editPending;
    const section = all ? 0 : viewState.activeEditorKey.startsWith("difficulty:") ? workbench.documentSession.activeDifficultyId : -1;
    const saved = await preview.getDocumentSaveText(section);
    const blob = new Blob([saved.sourceText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = workbench.documentSession.filePath?.split(/[\\/]/).at(-1) || "maidata.txt";
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    const result = await preview.documentCommand("document.markSectionSaved", { section });
    applyDocument(result.document);
    workbench.status("谱面文件已生成");
  };
  async function command(id, args = {}) {
    if (id === "cover.canvasChanged") { workbench.documentSession.coverDirty = true; return; }
    if (id === "cover.error") { workbench.status(args.message); return; }
    if (id === "timeline.viewport") return refreshTimeline();
    if (id === "timeline.settings") {
      Object.assign(timelineOptions, args);
      workbench.timelineControls.update(timelineOptions);
      if (args.followPreviewEnabled === false) workbench.sourceEditor.setFollowState({ active: false });
      else if (args.followPreviewEnabled) await updateTimelineFollow(workbench.previewTransport.state.currentTime);
      return refreshTimeline();
    }
    if (id === "timeline.scroll") {
      const state = workbench.documentSession.timelineSceneState;
      timelineOptions.horizontalScrollValue = Math.max(0, Math.min(Math.max(0, (state?.contentWidth ?? 0) - (state?.viewportSize.width ?? 0)), timelineOptions.horizontalScrollValue + args.delta));
      return refreshTimeline();
    }
    if (id === "timeline.zoom") {
      timelineOptions.zoomScale = Math.max(.25, Math.min(8, timelineOptions.zoomScale * Math.exp(-args.delta / 600)));
      workbench.timelineControls.update(timelineOptions);
      return refreshTimeline();
    }
    if (id === "timeline.navigateAtPoint") {
      const target = await preview.navigateTimeline(args);
      await preview.seek(target.second);
      if (target.resolved) {
        viewState.openEditor(`difficulty:${workbench.documentSession.activeDifficultyId}`);
        workbench.sourceEditor.jumpToPosition(target.position);
      }
      timelineOptions.cursorSeconds = target.second;
      return refreshTimeline();
    }
    if (id === "preview.toggle") {
      return (await preview.getState()).playing ? preview.pause() : preview.play();
    }
    if (id === "preview.stop") { await preview.pause(); return preview.seek(0); }
    if (id === "preview.seek") return preview.seek(args.second);
    if (id === "preview.rate") return preview.setPlayback({ rate: args.rate });
    if (id === "preview.toggleFreeAspect") {
      viewState.setPreference("previewCanvasFreeAspect", !viewState.preferences.previewCanvasFreeAspect);
      return fitCanvas();
    }
    if (id === "preview.toggleHidePv") {
      const hidePv = !viewState.preferences.previewHidePv;
      await preview.setMediaSettings({ hidePv });
      viewState.setPreference("previewHidePv", hidePv);
      return;
    }
    if (id === "preview.rangeMode") {
      const values = workbench.documentSession.exportValues || {};
      const state = await preview.getState();
      return preview.setPlayback({ rangePlaybackEnabled: args.enabled, exportStartSeconds: values.exportStartSeconds ?? 0, exportEndSeconds: values.exportEndSeconds || state.duration });
    }
    if (id === "edit.find" || id.startsWith("page.") || id.startsWith("view.")) return workbench.command(id, args);
    if (id === "editor.close") { viewState.closeEditor(args.key); return; }
    if (id === "file.demo") return open({ maidata: SAMPLE });
    if (id === "file.new") return open({ maidata: "&title=新谱面\n&artist=\n&first=0\n&lv_5=\n&inote_5=(120){4}E\n" });
    if (id === "file.open" || id === "file.openFolder") {
      const files = await reader("", true, true);
      if (!files.length) return;
      const { projects, preferred } = inspectChartFolder(files);
      const selected = preferred || await chooseProject(projects);
      if (!selected) return;
      workbench.status(`载入文件夹：${selected.label} · ${files.length} 个文件`);
      return open(selected.chart, selected.path, selected.files);
    }
    if (id === "file.save" || id === "file.saveAll" || id === "file.saveAs") return save(id === "file.saveAll");
    if (id === "document.selectDifficulty") {
      await preview.selectDifficulty(args.difficulty);
      applyDocument(await preview.getDocument());
      viewState.openEditor(`difficulty:${args.difficulty}`);
      timelineOptions.horizontalScrollValue = 0;
      applyPlaybackState(await preview.getState());
      await refreshTimeline();
      return;
    }
    if (id.startsWith("document.") && id !== "document.designerSlots") {
      await editPending;
      const result = await preview.documentCommand(id, args);
      applyDocument(result.document);
      if (result.previewError) workbench.status(result.previewError);
      await refreshTimeline();
      return;
    }
    if (id === "preview.settings") {
      const settings = await preview.setSettings(args);
      workbench.documentSession.previewSettings = settings;
      await refreshTimeline();
      return;
    }
    if (id === "edit.selectAll") { workbench.sourceEditor.focus(); workbench.sourceEditor.input.select(); return; }
    if (id === "edit.copy") {
      const input = workbench.sourceEditor.input;
      return navigator.clipboard.writeText(input.value.slice(input.selectionStart, input.selectionEnd));
    }
    if (id === "edit.cut" || id === "edit.paste") {
      const input = workbench.sourceEditor.input;
      if (id === "edit.cut") await navigator.clipboard.writeText(input.value.slice(input.selectionStart, input.selectionEnd));
      input.setRangeText(id === "edit.cut" ? "" : await navigator.clipboard.readText(), input.selectionStart, input.selectionEnd, "end");
      input.dispatchEvent(new Event("input")); return;
    }
    if (id === "edit.undo" || id === "edit.redo") { workbench.sourceEditor.focus(); document.execCommand(id.slice(5)); return; }
    workbench.status("此操作需要可编辑谱面事务");
  }
  workbench.addEventListener("command", event => { void command(event.detail.id, event.detail.args).catch(error => workbench.status(error.message)); }, { signal: abort.signal });
  workbench.addEventListener("sourcechange", event => {
    const sequence = ++editSequence;
    const generation = workbench.documentSession.documentOpenGeneration;
    editPending = preview.documentCommand("document.replaceActiveDifficultyChart", { value: event.detail }).then(async result => {
      if (sequence !== editSequence || generation !== result.document.documentOpenGeneration) return;
      applyDocument(result.document);
      if (result.previewError) workbench.status(result.previewError);
      await refreshTimeline();
    });
    void editPending.catch(error => workbench.status(error.message));
    workbench.titleLabel.textContent = `* ${workbench.documentSession.title || "未命名谱面"}`;
  }, { signal: abort.signal });
  document.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const id = key === "o" ? "file.open" : key === "s" ? event.shiftKey ? "file.saveAll" : "file.save" : null;
    if (id) { event.preventDefault(); void command(id).catch(error => workbench.status(error.message)); }
  }, { signal: abort.signal });
  window.addEventListener("beforeunload", event => {
    if (workbench.documentSession.dirty) { event.preventDefault(); event.returnValue = ""; }
  }, { signal: abort.signal });
  const ready = mountPreview().then(async () => {
    canvasResize.observe(workbench.previewContainer);
    await fitCanvas();
    await refreshTimeline();
    workbench.status("预览就绪"); return workbench;
  }).catch(error => { workbench.status(error.message); throw error; });
  viewState.addEventListener("change", () => {
    if (theme === viewState.activeThemeToken) return;
    theme = viewState.activeThemeToken;
    void preview.setTheme(theme).catch(error => workbench.status(error.message));
    void refreshTimeline().catch(error => workbench.status(error.message));
  }, { signal: abort.signal });
  void ready.catch(() => {});
  return { workbench, viewState, ready, load: open, command,
    get preview() { return preview; },
    destroy() { abort.abort(); canvasResize.disconnect(); preview?.destroy(); if (coverSource) URL.revokeObjectURL(coverSource); workbench.destroy(); viewState.destroy(); },
  };
}

const root = document.getElementById("workbench");
if (root) {
  const editor = createWorkbench(root);
  root.editor = editor;
  window.addEventListener("pagehide", () => editor.destroy(), { once: true });
}

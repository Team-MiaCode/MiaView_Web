import { createPreview } from "./sdk/index.mjs";
import { ViewState } from "./services/view-state.mjs";
import { Workbench } from "./ui/workbench/workbench.mjs";
import { inspectChartFolder } from "./services/chart-folder.mjs";
import { openDialog } from "./ui/components/dialog.mjs";
import { element as h } from "./ui/components/dom.mjs";
import { translate, formatMessage } from "./ui/components/translate.mjs";
import { BrowserFiles } from "./services/browser-files.mjs";
import { ProjectStore } from "./services/project-store.mjs";
import { previewSettingsFromValues, previewValuesFromSettings } from "./services/preview-appearance.mjs";
import { stageResource, relocatePath, resourceFile, resolveChartResource, resolveChartMedia, inputPaths, hydrateProjectResources } from "./services/chart-resources.mjs";
import { decodeMaidata } from "./renderer/runtime.mjs";
import { WorkbenchShortcuts } from "./services/shortcuts.mjs";
import { PLAYBACK_RATES } from "./renderer/playback.mjs";
import { PreferenceAssets } from "./services/preference-assets.mjs";
import { AppBackground } from "./services/app-background.mjs";
import { UserFonts } from "./services/user-fonts.mjs";
import { VideoExportJobs,videoFileName } from "./services/video-export-jobs.mjs";
import { createWorkbenchPreview } from "./services/preview-window.mjs";
import { UserAppearance } from "./services/user-appearance.mjs";
import { DEFAULT_PERFORMANCE, performanceSettings, frameRateForMode } from "./renderer/performance-settings.mjs";
import { coverFileName } from "./services/cover-files.mjs";
import { openCoverPresets } from "./ui/workbench/cover-presets.mjs";

const HUD_AREAS = ["chart_info", "timestamp", "center_display", "object_stats", "debug_info"];

const SAMPLE = "&title=MiaCode Example\n&artist=MiaCode\n&first=0\n&lv_5=12\n&des_5=MiaCode\n&inote_5=(120){4}\n1,2,3,4,5,6,7,8,\n1b,2x,3h[4:1],4-8[4:1],\nA1,B2,C,D3,E4,E\n";
export function createWorkbench(container, options = {}) {
  const viewState = new ViewState(options.storage ?? localStorage);
  const workbench = new Workbench(container, viewState);
  workbench.nativeCover = true;
  let preview;
  let coverSource;
  let coverFile;
  let theme = viewState.activeThemeToken;
  const abort = new AbortController();
  const initialResolution = options.preview?.resolution ?? { width: 1080, height: 1080 };
  let canvasSize = "";
  let timelineSequence = 0;
  let loadSequence = 0;
  let loadingDocument = false;
  let editSequence = 0;
  let editPending = Promise.resolve();
  let selectionFrame = 0, selectionSequence = 0, selectionKey = null;
  let project, recoveryTimer;
  let savePending = Promise.resolve();
  let mediaPending = Promise.resolve();
  let analysisTimer, editPreviewTimer, analysisSequence = 0;
  let analysisLanguage = viewState.preferences.languageToken || "zh";
  let authoringContext = false;
  let latencyPage = false, latencyPending = Promise.resolve();
  let previewValuesPending=Promise.resolve();
  let performancePending=Promise.resolve(), performanceOperation=performancePending, performanceCommands=Promise.resolve(), performanceKey;
  function performanceValues() {
    return Object.fromEntries([...Object.keys(DEFAULT_PERFORMANCE), "timelineFrameRateMode"].map(key => [key, viewState.preferences[key] ?? (DEFAULT_PERFORMANCE[key] ?? 1)]));
  }
  function updatePerformance(values = performanceValues()) {
    if (!preview) return Promise.resolve();
    const key = JSON.stringify(values);
    if (key === performanceKey) return performanceOperation;
    const { timelineFrameRateMode, ...rendering } = values;
    frameRateForMode(timelineFrameRateMode); performanceSettings({}, rendering);
    performanceKey = key;
    const operation = performancePending.then(async () => {
      const result = await preview.setPerformance(rendering);
      workbench.timelineView.setFrameRateMode(timelineFrameRateMode);
      return result;
    });
    performancePending = operation.catch(() => { if (performanceKey === key) performanceKey = null; });
    performanceOperation = operation;
    return operation;
  }
  const shortcuts = new WorkbenchShortcuts({ root: container, signal: abort.signal,
    normalize: sequences => preview.setInputShortcuts(sequences), execute: command,
    error: error => workbench.status(error.message),
    enabled: (id, event) => {
      const documentReady = workbench.documentSession.hasDocument && !loadingDocument;
      if (id.startsWith("transform.") || id === "editor.overwrite_mode") return documentReady && viewState.activeEditorKey.startsWith("difficulty:");
      if (id.startsWith("timeline.")) return documentReady && (event.type !== "wheel" || workbench.timelineView.root.contains(event.target));
      if (id.startsWith("preview.")) return documentReady && (id !== "preview.play_pause_global" || event.target?.ownerDocument !== document || document.activeElement !== workbench.sourceEditor.input);
      return true;
    },
    changed: rows => {
      workbench.documentSession.shortcutRows = rows;
      if (viewState.activeEditorKey === "preferences") { workbench.pageKey = ""; workbench.update(); }
    } });
  const projectStore = options.projectStore ?? new ProjectStore();
  const preferenceAssets = new PreferenceAssets();
  const background = new AppBackground(workbench.root,viewState,preferenceAssets,settings=>preview.normalizeBackground(settings));
  let userFonts, userAppearance;
  let fileService;
  let exportFileHandle,introBackground,exportRequestActive=false;
  let coverOutputHandle, coverExportActive = false;
  let introPending=Promise.resolve(),introQueued=0,introUpdateTimer;
  function runIntro(action) {
    ++introQueued;
    const result=introPending.then(action);
    introPending=result.catch(()=>{});
    void result.finally(()=>--introQueued).catch(()=>{});
    return result;
  }
  function introSettings() {return {...Object.fromEntries(Object.entries(workbench.documentSession.exportValues||{}).filter(([key])=>key.startsWith("intro"))),
    introBackground:workbench.documentSession.exportValues?.introBackgroundModeIndex===1?introBackground:undefined};}
  function updateIntroSettings() {
    clearTimeout(introUpdateTimer);
    introUpdateTimer=setTimeout(()=>{
      void runIntro(async()=>{
        const state=await preview.getState();
        if(!state.introAudition?.active)return;
        const values=introSettings();
        return preview.setIntroAudition(viewState.activeEditorKey==="export"&&values.introEnabled&&values.introPvPreview?values:{enabled:false});
      }).catch(error=>workbench.status(error.message));
    },150);
  }
  const exportJobs=new VideoExportJobs({root:container,previewOptions:options.preview,assets:preferenceAssets,fonts:()=>preferenceAssets.fonts(),
    changed:state=>{workbench.setExportStatus(state);workbench.status(state.message);},
    deliver:async(video,filename)=>{
      if(video.blob)await fileService.download(video.blob,filename);
    }});
  const refreshExport=()=>{if(viewState.activeEditorKey==="export"){workbench.pageKey="";workbench.update();}};
  async function chooseExportFile(values) {
    const capabilities=await preview.getExportCapabilities(values);
    if(!fileService.pickSaveFile)return null;
    try {
      const handle=await fileService.pickSaveFile({suggestedName:videoFileName(values.outputPath,capabilities.extension),
        types:[{description:"视频",accept:{[capabilities.mimeType]:[capabilities.extension]}}]});
      values.outputPath=handle.name;exportFileHandle=handle;refreshExport();return handle;
    } catch(error){if(error.name==="AbortError")return undefined;throw error;}
  }
  function recordProject(snapshot = workbench.documentSession) {
    const chartText = workbench.sourceEditor.input.value;
    return { ...project, sourceText: snapshot.sourceText, chartText, dirty: snapshot.sourceText !== project.savedSourceText || project.mediaDirty || chartText !== snapshot.chartText,
      inputPaths: inputPaths(project.input), savedInputPaths: inputPaths(project.savedInput),
      activeDifficultyId: snapshot.activeDifficultyId, title: snapshot.title, updatedAt: Date.now(),
      coverExport: { coverValues: workbench.documentSession.coverValues, coverLayers: workbench.documentSession.coverLayers, coverFiles: workbench.documentSession.coverFiles },
      editorState: { activeEditorKey: viewState.activeEditorKey, openEditorTabs: [...viewState.openEditorTabs] } };
  }
  async function flushRecovery(snapshot = workbench.documentSession) {
    clearTimeout(recoveryTimer); recoveryTimer = null;
    if (project && snapshot.hasDocument) await projectStore.put(recordProject(snapshot));
  }
  async function refreshRecent() {
    const recentDocuments = (await projectStore.recent()).map(record => ({ id: record.id, label: record.title || record.filePath, path: record.filePath }));
    workbench.setDocument({ ...workbench.documentSession, recentDocuments });
  }
  function scheduleRecovery(snapshot) {
    if (!project || !snapshot.hasDocument) return;
    clearTimeout(recoveryTimer);
    const record = recordProject(snapshot);
    recoveryTimer = setTimeout(() => { recoveryTimer = null; void projectStore.put(record).catch(error => workbench.status(error.message)); }, 2000);
  }
  const timelineOptions = { zoomScale: .5, horizontalScrollValue: 0, cursorSeconds: 0, waveformBrightness: .5, measureLineBrightness: 1,
    followPreviewEnabled: false, followProgressEnabled: true };
  workbench.timelineControls.update(timelineOptions);
  async function updateTimelineFollow(second) {
    const doc = workbench.documentSession;
    if (!timelineOptions.followPreviewEnabled || !doc.hasDocument || loadingDocument || latencyPage) return;
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
    if(workbench.documentSession.introAudition?.active)return;
    const values = previewSettingsFromValues(viewState.preferences.previewValues || {});
    if (Object.keys(values).length) { await userAppearance.restore(values); await preview.setSettings(values); }
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
  fileService = options.fileService ?? new BrowserFiles({ readDirectory: () => reader("", true, true) });
  function mediaSnapshot(snapshot) {
    const input = project?.input || {};
    if (coverFile !== input.cover) {
      if (coverSource) URL.revokeObjectURL(coverSource);
      coverFile = input.cover;
      coverSource = coverFile instanceof Blob ? URL.createObjectURL(coverFile) : undefined;
    }
    const pathOf = file => file?.webkitRelativePath || file?.name || "";
    const folderFiles = new Map(project?.files);
    if (snapshot.hasDocument) folderFiles.set(snapshot.filePath, resourceFile(new File([snapshot.sourceText], "maidata.txt", { type: "text/plain" }), snapshot.filePath));
    return { dirty: snapshot.dirty || Boolean(project?.mediaDirty), metadataDirty: snapshot.metadataDirty || Boolean(project?.mediaDirty), mediaDirty: Boolean(project?.mediaDirty), folderFiles,
      trackAvailable: Boolean(input.audio), videoAvailable: Boolean(input.video), metadataHasVideo: Boolean(input.video),
      metadataCoverSource: coverSource, metadataResolvedVideoPath: pathOf(input.video), trackPath: pathOf(input.audio), coverPath: pathOf(input.cover) };
  }
  async function importMedia(kind, file) {
    const owner = project, generation = workbench.documentSession.documentOpenGeneration;
    if (!owner || loadingDocument) return;
    await workbench.sourceEditor.pending; await editPending;
    if (owner !== project) return;
    const imageField = kind === "cover" && resolveChartResource(new Map(owner.files), owner.filePath, workbench.documentSession.metadataVideoPath);
    const replacedImageField = imageField && imageField === owner.input.cover;
    const staged = stageResource(new Map(owner.files), owner.filePath, kind, file, owner.input[kind]?.webkitRelativePath);
    await preview.setResources({ [kind]: staged.file });
    if (owner !== project || generation !== workbench.documentSession.documentOpenGeneration) return;
    const writes = new Map(owner.resourceChanges), savedFiles = new Map(owner.savedFiles);
    for (const [path, value] of staged.writes) {
      if (value === null && !savedFiles.has(path)) writes.delete(path);
      else writes.set(path, value);
    }
    owner.input = { ...owner.input, [kind]: staged.file || undefined };
    owner.files = [...staged.files]; owner.resourceChanges = [...writes]; owner.mediaDirty = writes.size > 0;
    if (kind === "video" || replacedImageField) {
      const value = kind === "video" ? staged.file?.name || "" : "";
      const result = await preview.documentCommand("document.metadataVideoPath", { value, documentOpenGeneration: generation });
      applyDocument(result.document);
    }
    const snapshot = await preview.getDocument();
    workbench.setDocument({ ...workbench.documentSession, ...snapshot, ...mediaSnapshot(snapshot) });
    applyPlaybackState(await preview.getState());
    await refreshTimeline(); await flushRecovery();
    workbench.status(staged.file ? `导入素材：${staged.file.name}` : "PV 素材移除");
    return staged;
  }
  function chooseProject(projects) {
    const select = h("select", { "aria-label": "谱面文件夹" }, projects.map((project, index) => h("option", { value: index }, project.label)));
    return new Promise(resolve => {
      openDialog(container, { title: "选择谱面文件夹", body: h("div", {}, h("p", {}, "所选目录包含多个谱面文件夹，请选择要打开的谱面。"), select), height: 260,
        actions: [{ label: "取消", value: "cancel" }, { label: "打开", value: "open", primary: true }],
        close: result => resolve(result === "open" ? projects[Number(select.value)] : null) });
    });
  }
  function mountPreview() {
    workbench.root.classList.add("preview-initializing");
    workbench.previewContainer.replaceChildren();
    preview = createPreview(workbench.previewContainer, {
      resolution: { width: 1080, height: 1080 }, layout: "fit", diagnostics: false,
      theme: viewState.activeThemeToken, ...options.preview, controls: false,
    });
    preview = createWorkbenchPreview(preview, { root: workbench.root, viewState, assets: preferenceAssets, resolution: initialResolution, preview: options.preview,
      command, introSettings, error: error => workbench.status(error.message),
      shortcut: (event, root) => shortcuts.input(event, root, id => id.startsWith("preview.")),
      releaseShortcuts: () => shortcuts.releaseHeld(),
      changed: detached => {
        workbench.root.classList.toggle("preview-is-detached", detached);
        workbench.previewTransport.setDetached(detached);
        let placeholder = workbench.previewContainer.querySelector(".preview-detached-placeholder");
        if (!placeholder) {
          placeholder = document.createElement("button"); placeholder.className = "preview-detached-placeholder";
          placeholder.textContent = "嵌回预览"; placeholder.addEventListener("click", () => { void command("preview.detach").catch(error=>workbench.status(error.message)); });
          workbench.previewContainer.append(placeholder);
        }
        placeholder.hidden = !detached;
      } });
    userFonts=new UserFonts(preview,preferenceAssets);
    userAppearance=new UserAppearance(preview,preferenceAssets);
    preview.on("progress", event => workbench.status(event.stage));
    preview.on("shortcutInput", event => shortcuts.remoteInput(event,preview.iframe));
    preview.on("introAuditionChanged",state=>workbench.setIntroAudition(state));
    preview.on("error", event => workbench.status(event.message));
    preview.on("touchPadAuthoring", event => {
      const doc = workbench.documentSession;
      if (loadingDocument || event.documentOpenGeneration !== doc.documentOpenGeneration
        || event.difficulty !== doc.activeDifficultyId || viewState.activeEditorKey !== `difficulty:${doc.activeDifficultyId}`) return;
      void command("edit.touchPadAuthoring", { ...event.action, documentOpenGeneration: event.documentOpenGeneration,
        difficulty: event.difficulty }).catch(error => workbench.status(error.message));
    });
    preview.on("timeupdate", state => {
      applyPlaybackState(state);
      workbench.timelineView.setPlayback(state);
      if (!state.playing && workbench.timelineView.scrollValue !== undefined)
        timelineOptions.horizontalScrollValue = workbench.timelineView.scrollValue;
      void updateTimelineFollow(state.currentTime).catch(error => workbench.status(error.message));
    });
    preview.on("playbackChanged", playback => workbench.previewTransport.update({ playback }));
    return preview.ready.then(async () => {
      await updatePerformance();
      workbench.documentSession.userFonts=await userFonts.restore();
      Object.assign(workbench.documentSession,await userAppearance.list());
      await preview.setMediaSettings({ hidePv: Boolean(viewState.preferences.previewHidePv) });
      const audio = viewState.preferences.audioSettings
        ? await preview.audioCommand("audio.restoreSettings", { settings: viewState.preferences.audioSettings })
        : await preview.audioCommand("audio.getSettings");
      workbench.documentSession.audio = audio;
      const values = previewSettingsFromValues(viewState.preferences.previewValues || {});
      if (Object.keys(values).length) { await userAppearance.restore(values); await preview.setSettings(values); }
      const state = await preview.getState();
      workbench.documentSession.previewSettings = state.settings;
      workbench.documentSession.previewValues = { ...viewState.preferences.previewValues, ...previewValuesFromSettings(state.settings) };
      return preview;
    }).finally(() => workbench.root.classList.remove("preview-initializing"));
  }
  function applyPlaybackState(state) {
    workbench.previewTransport.update(state);
    Object.assign(workbench.documentSession, { statistics: state.statistics, statisticsAvailable: state.statisticsAvailable });
    workbench.noteStatistics.update(state.statistics || [], { dataAvailable: state.statisticsAvailable,
      noteSkin: workbench.documentSession.previewSettings?.noteSkin });
    workbench.setLatency({ ...state, latency: state.latency || { onPage: latencyPage, subdivision: workbench.documentSession.subdivision ?? 4,
      sfxVolumePercent: workbench.documentSession.sfxVolumePercent ?? 60 } });
  }
  function updateLatencyPage() {
    const doc = workbench.documentSession;
    const onPage = Boolean(project && doc.hasDocument && !loadingDocument && viewState.activeEditorKey === "latency");
    if (onPage === latencyPage) return;
    latencyPage = onPage;
    if (onPage) workbench.sourceEditor.setFollowState({ active: false });
    latencyPending = preview.setLatency({ onPage, bpm: doc.bpm || 120, offsetSeconds: doc.offsetSeconds || 0 }).then(async state => {
      if (state.latency.onPage !== latencyPage) return;
      applyPlaybackState(state); await refreshTimeline();
    });
    void latencyPending.catch(error => workbench.status(error.message));
  }
  function updateAuthoringContext() {
    const doc = workbench.documentSession;
    const enabled = Boolean(!loadingDocument && doc.hasDocument && doc.activeDifficultyId > 0
      && viewState.activeEditorKey === `difficulty:${doc.activeDifficultyId}`);
    if (enabled === authoringContext) return;
    authoringContext = enabled;
    void preview.setSettings({ touchPadAuthoringContext: enabled }).then(settings => {
      workbench.documentSession.previewSettings = settings;
    }).catch(error => { workbench.status(error.message); });
  }
  function scheduleAnalysis() {
    clearTimeout(analysisTimer);
    const sequence = ++analysisSequence;
    const doc = workbench.documentSession;
    workbench.setAnalysis({ pending: doc.hasDocument && doc.activeDifficultyId > 0,
      validationRows: [], muriRows: [], syntaxErrorCount: 0, syntaxWarningCount: 0 });
    if (!doc.hasDocument || !doc.activeDifficultyId) return;
    analysisTimer = setTimeout(async () => {
      try {
        const result = await preview.getAnalysis(viewState.preferences.languageToken || "zh");
        const current = workbench.documentSession;
        if (sequence !== analysisSequence || result.documentOpenGeneration !== current.documentOpenGeneration
          || result.revision !== current.revision || result.difficultyId !== current.activeDifficultyId) return;
        workbench.setAnalysis(result);
      } catch (error) { workbench.status(error.message); }
    }, 180);
  }
  async function open(input, filePath = "maidata.txt", folderFiles = new Map(), savedProject = null) {
    await mediaPending;
    await workbench.sourceEditor.pending; await editPending;
    await flushRecovery();
    const sequence = ++loadSequence;
    loadingDocument = true;
    updateAuthoringContext();
    workbench.sourceEditor.input.readOnly = true;
    workbench.status("读取谱面");
    let info, previewError;
    try { info = await preview.load({ ...input, video: folderFiles.size ? undefined : input.video, filePath }); }
    catch (error) { previewError = error.message; }
    if (sequence !== loadSequence) return info;
    let snapshot;
    try { snapshot = await preview.getDocument(); }
    catch (error) {
      if (sequence === loadSequence) { loadingDocument = false; workbench.sourceEditor.input.readOnly = false; }
      throw error;
    }
    if (sequence !== loadSequence) return info;
    if (folderFiles.size && snapshot.hasDocument) {
      const resolved = resolveChartMedia(folderFiles, filePath, snapshot.metadataVideoPath);
      input = { ...input, ...resolved };
      try { await preview.setResources({ video: input.video || null, ...("cover" in resolved ? { cover: resolved.cover } : {}) }); }
      catch (error) { previewError = error.message; }
      if (sequence !== loadSequence) return info;
    }
    const nextProject = savedProject || { id: crypto.randomUUID(), filePath, savedSourceText: snapshot.sourceText,
      input: { audio: input.audio, cover: input.cover, video: input.video }, files: [...folderFiles].filter(([path]) => path !== filePath) };
    nextProject.savedSourceText = snapshot.sourceText;
    nextProject.diskSourceText ??= typeof input.maidata === "string" ? input.maidata
      : input.maidata instanceof Blob ? decodeMaidata(await input.maidata.arrayBuffer()) : snapshot.sourceText;
    nextProject.input = { ...nextProject.input, audio: input.audio, cover: input.cover, video: input.video };
    nextProject.resourceRoot ??= filePath.includes("/") ? filePath.split("/")[0] : "";
    nextProject.savedInput ??= { ...nextProject.input }; nextProject.savedFiles ??= [...nextProject.files];
    nextProject.resourceChanges ??= [];
    const playback = await preview.getState();
    if (sequence !== loadSequence) return info;
    project = nextProject; loadingDocument = false; workbench.sourceEditor.input.readOnly = false;
    coverOutputHandle = null;
    workbench.sourceEditor.setFollowState({ active: false });
    workbench.setDocument({ ...info, ...snapshot, previewError, folderFiles,
      coverValues: { ...nextProject.coverExport?.coverValues }, coverLayers: nextProject.coverExport?.coverLayers,
      coverFiles: nextProject.coverExport?.coverFiles || [], coverDirty: false,
      audio: playback.audio,
      previewSettings: playback.settings, previewValues: { ...viewState.preferences.previewValues, ...previewValuesFromSettings(playback.settings) },
      ...mediaSnapshot(snapshot) });
    scheduleAnalysis();
    viewState.openEditor(snapshot.activeDifficultyId ? `difficulty:${snapshot.activeDifficultyId}` : "metadata");
    applyPlaybackState(playback);
    timelineOptions.horizontalScrollValue = 0;
    await refreshTimeline();
    await flushRecovery(snapshot);
    await refreshRecent();
    workbench.status(previewError || `${snapshot.title || filePath} · ${info?.noteCount ?? 0} 个音符`);
    return info;
  }
  function applyDocument(snapshot) {
    workbench.setDocument({ ...workbench.documentSession, ...snapshot, dirty: snapshot.dirty || Boolean(project?.mediaDirty),
      metadataDirty: snapshot.metadataDirty || Boolean(project?.mediaDirty), difficultyId: snapshot.activeDifficultyId });
    scheduleRecovery(snapshot);
    scheduleAnalysis();
    updateAuthoringContext();
  }
  const save = async (all = false, saveAs = false) => {
    if (!workbench.documentSession.hasDocument) return;
    const savingProject = project;
    const section = all || saveAs ? 0 : viewState.activeEditorKey.startsWith("difficulty:") ? workbench.documentSession.activeDifficultyId : -1;
    const target = await fileService.saveTarget(savingProject.binding, saveAs, { ...savingProject, all: all || saveAs });
    if (!target) return;
    const operation = savePending.then(() => saveDocument(savingProject,
      !saveAs && savingProject.binding?.fileHandle ? savingProject.binding : target, section));
    savePending = operation.catch(() => {});
    return operation;
  };
  async function saveDocument(savingProject, target, section) {
    await mediaPending;
    await workbench.sourceEditor.pending;
    await editPending;
    if (savingProject !== project) return;
    const generation = workbench.documentSession.documentOpenGeneration;
    const saved = await preview.getDocumentSaveText(section);
    const resources = { ...savingProject, files: [...savingProject.files], input: { ...savingProject.input }, resourceChanges: [...savingProject.resourceChanges] };
    const mapping = path => target.copyResources ? relocatePath(path, resources.resourceRoot, target.resourceRoot) : path;
    const entries = target.copyResources ? resources.files.map(([path, file]) => [mapping(path), file]) : resources.resourceChanges;
    let rebindMedia = {};
    if (section === 0 && target.download && resources.files.length) await fileService.downloadProject(resources, saved.sourceText);
    else {
      if (section === 0 && target.directoryHandle) await fileService.writeResources(target, entries);
      await fileService.write(target, saved.sourceText);
      if (section === 0 && target.directoryHandle) await fileService.removeResources(target, entries);
    }
    if (section === 0) {
      const pending = new Map(savingProject.resourceChanges);
      for (const [path, file] of resources.resourceChanges) if (pending.get(path) === file) pending.delete(path);
      const persisted = target.directoryHandle ? await fileService.readResources(target, resources.files.map(([path]) => mapping(path))) : null;
      const captured = new Map(resources.files), currentInput = savingProject.input;
      const mapFiles = (files, savedPoint = false) => files.map(([path, file]) => [mapping(path),
        persisted && file && (savedPoint || captured.get(path) === file) ? persisted.get(mapping(path))
          : file && target.copyResources ? resourceFile(file, mapping(path)) : file]);
      const mapInput = (input, files) => Object.fromEntries(Object.entries(input).map(([kind, file]) =>
        [kind, file?.webkitRelativePath ? new Map(files).get(mapping(file.webkitRelativePath)) : file]));
      savingProject.savedFiles = mapFiles(resources.files, true);
      savingProject.savedInput = mapInput(resources.input, savingProject.savedFiles);
      savingProject.files = mapFiles(savingProject.files);
      savingProject.input = mapInput(savingProject.input, savingProject.files);
      if (target.copyResources) {
        savingProject.resourceChanges = mapFiles([...pending]);
        savingProject.resourceRoot = target.resourceRoot;
      } else savingProject.resourceChanges = [...pending];
      savingProject.mediaDirty = savingProject.resourceChanges.length > 0;
      if (persisted) for (const kind of ["audio", "cover", "video"]) {
        const selected = currentInput[kind];
        if (selected && selected === resources.input[kind] && (target.copyResources
          || resources.resourceChanges.some(([path, file]) => file && path === selected.webkitRelativePath))) rebindMedia[kind] = savingProject.input[kind];
      }
    }
    const { copyResources, ...binding } = target;
    savingProject.binding = binding; savingProject.filePath = target.filePath; savingProject.savedSourceText = saved.sourceText;
    savingProject.diskSourceText = saved.sourceText;
    if (savingProject !== project || loadingDocument || generation !== workbench.documentSession.documentOpenGeneration) {
      const previous = await projectStore.get(savingProject.id);
      if (previous) await projectStore.put({ ...previous, binding, savedSourceText: saved.sourceText, diskSourceText: saved.sourceText, filePath: target.filePath,
        input: savingProject.input, files: savingProject.files, savedInput: savingProject.savedInput, savedFiles: savingProject.savedFiles,
        inputPaths: inputPaths(savingProject.input), savedInputPaths: inputPaths(savingProject.savedInput),
        resourceChanges: savingProject.resourceChanges, resourceRoot: savingProject.resourceRoot, mediaDirty: savingProject.mediaDirty,
        dirty: previous.sourceText !== saved.sourceText || savingProject.mediaDirty });
      return;
    }
    if (Object.keys(rebindMedia).length) await preview.setResources(rebindMedia);
    await workbench.sourceEditor.pending; await editPending;
    const result = await preview.documentCommand("document.markSectionSaved", { section, sourceText: saved.sourceText,
      filePath: target.filePath, documentOpenGeneration: generation });
    applyDocument(result.document);
    workbench.setDocument({ ...workbench.documentSession, ...mediaSnapshot(result.document) });
    await flushRecovery(result.document);
    await refreshRecent();
    workbench.status(target.download ? "谱面文件已生成" : "谱面文件已保存");
  }
  async function confirmDocumentChange() {
    await mediaPending;
    await workbench.sourceEditor.pending; await editPending;
    if (!workbench.documentSession.dirty) return true;
    const changingProject = project;
    const choice = await new Promise(resolve => openDialog(container, {
      title: "保存谱面修改", height: 260, body: h("p", {}, `${workbench.documentSession.title || "谱面"}包含编辑内容，请选择保存方式。`),
      actions: [{ label: "取消", value: "cancel" }, { label: "放弃修改", value: "discard" }, { label: "保存全部", value: "save", primary: true }], close: resolve,
    }));
    if (changingProject !== project) return false;
    if (choice === "save") { await save(true); return !workbench.documentSession.dirty; }
    if (choice === "discard") {
      if (project.mediaDirty) {
        await preview.setResources(Object.fromEntries(["audio", "cover", "video"].map(kind => [kind, project.savedInput[kind] || null])));
        project.input = { ...project.savedInput }; project.files = [...project.savedFiles]; project.resourceChanges = []; project.mediaDirty = false;
      }
      const result = await preview.documentCommand("document.replaceSource", { sourceText: project.savedSourceText,
        documentOpenGeneration: workbench.documentSession.documentOpenGeneration });
      applyDocument(result.document);
      workbench.setDocument({ ...workbench.documentSession, ...mediaSnapshot(result.document) });
      await flushRecovery(); return true;
    }
    return false;
  }
  async function command(id, args = {}) {
    if (id === "preferences.performance") {
      const operation = performanceCommands.then(async () => {
        await updatePerformance({ ...performanceValues(), ...args });
        viewState.setPreferences(args);
      });
      performanceCommands = operation.catch(() => {}); return operation;
    }
    if(id==="preview.detach")return preview.windowRouter.toggle();
    if(id==="export.settings") {
      Object.assign(workbench.documentSession.exportValues||={},args);
      if("outputPath" in args)exportFileHandle=null;
      if(workbench.documentSession.introAudition?.active&&Object.keys(args).some(key=>key.startsWith("intro")))updateIntroSettings();
      return;
    }
    if(id==="export.toggleIntroAudition")return runIntro(async()=>{
      if(viewState.activeEditorKey!=="export")return preview.setIntroAudition({enabled:false});
      const state=await preview.getState(),values=introSettings();
      const result=await preview.setIntroAudition({...values,playing:!state.introAudition?.playing});
      if(viewState.activeEditorKey!=="export")await preview.setIntroAudition({enabled:false});
      return result;
    });
    if(id==="export.setExportRangeSeconds") {
      const values=workbench.documentSession.exportValues||={};values.exportStartSeconds=args.start;values.exportEndSeconds=args.end;
      if(workbench.previewTransport.state.rangePlaybackEnabled)return preview.setPlayback({exportStartSeconds:args.start,exportEndSeconds:args.end});
      return;
    }
    if(id==="export.browseOutputPath")return chooseExportFile(workbench.documentSession.exportValues||={});
    if(id==="export.browseIntroBackground") {
      const files=await reader(".png,.jpg,.jpeg,.webp,.bmp");if(!files.length)return;
      const image=await createImageBitmap(files[0]);image.close();introBackground=files[0];
      (workbench.documentSession.exportValues||={}).introCustomBackgroundPath=files[0].name;
      if(workbench.documentSession.introAudition?.active)updateIntroSettings();refreshExport();return;
    }
    if(id==="export.importIntroFonts") {
      const files=await reader(".ttf,.otf",true);for(const file of files)await userFonts.import(file);
      workbench.documentSession.userFonts=userFonts.list();refreshExport();return;
    }
    if(id==="export.resetIntroFonts") {
      Object.assign(workbench.documentSession.exportValues||={},{introFontDisplayPath:"",introFontBodyPath:""});refreshExport();return;
    }
    if(id==="job.cancel")return exportJobs.cancel();
    if(id==="export.video") {
      if(exportRequestActive)throw new Error("视频导出任务运行中");
      exportRequestActive=true;
      try {
        const values={...(workbench.documentSession.exportValues||{})};
        if(!project)throw new Error("请打开谱面工程");
        if(!exportFileHandle){const selected=await chooseExportFile(values);if(selected===undefined)return;}
        await editPending;
        clearTimeout(introUpdateTimer);await introPending;
        await preview.setIntroAudition({enabled:false});
        const [document,state,audio]=await Promise.all([preview.getDocument(),preview.getState(),preview.audioCommand("audio.getSettings")]);
        const request={chart:{...project.input,maidata:document.sourceText,filePath:document.filePath},
          difficulty:values.selectedDifficultyId??document.activeDifficultyId,fileName:values.outputPath,fileHandle:exportFileHandle};
        return await exportJobs.start(request,{...values,introBackground:values.introBackgroundModeIndex===1?introBackground:undefined,
          showChartInfoHud:values.showChartInfoHud??false,showObjectStatsHud:values.showObjectStatsHud??false,clockCountEnabled:values.clockCountEnabled??false},
          {settings:state.settings,audio:audio.settings,performance:state.performance,hidePv:Boolean(viewState.preferences.previewHidePv)});
      } finally {exportRequestActive=false;}
    }
    if (id === "background.choose") {
      const files=await reader(".png,.jpg,.jpeg,.webp,.bmp");
      if(files.length)await background.replace(files[0]);
      return;
    }
    if (id === "background.clear") return background.clear();
    if (id === "preferences.background") return background.update(args);
    if (id === "skin.import") {
      const folder=await fileService.openFolder({id:"miacode-skin",mode:"read"});
      if(!folder?.files.length)return;
      const result=await userAppearance.importSkin(folder.files);
      Object.assign(workbench.documentSession,await userAppearance.list());
      await command("preview.values",{skinDirectoryName:result.skinDirectoryName});
      return result;
    }
    if (id === "preview.importJudgeLine") {
      const files=await reader(".png");if(!files.length)return;
      const result=await userAppearance.importJudgeLine(files[0]);
      Object.assign(workbench.documentSession,await userAppearance.list());
      await command("preview.values",{customOutlineFileName:result.customOutlineFileName});
      return result;
    }
    if (id === "preview.importHudFont") {
      const area=HUD_AREAS[viewState.preferences.previewValues?.hudFontAreaIndex ?? 0];
      const files=await reader(".ttf,.otf");if(!files.length)return;
      const font=await userFonts.import(files[0]);
      workbench.documentSession.userFonts=userFonts.list();
      await command("preview.values",{hudFontPaths:{[area]:font.path}});
      workbench.status(`导入字体：${font.family}`);return font;
    }
    if (id === "preview.resetHudFont") return command("preview.values",{hudFontPath:""});
    if (id === "shortcut.capture") {
      shortcuts.releaseHeld(); shortcuts.captureHasKey = false;
      let recorded = null, sequence = 0;
      const value = h("output", { className: "shortcut-recording" }, "按下组合键或滚动鼠标滚轮");
      const dialog = openDialog(container, { title: "录制快捷键", height: 260, body: value,
        actions: [{ label: "取消", value: "cancel" }, { label: "清除", value: "clear" }, { label: "保存", value: "save", primary: true }],
        close: result => {
          shortcuts.capture = null; ++sequence;
          if (result === "clear" || result === "save" && recorded !== null)
            void shortcuts.set(args.id, result === "clear" ? "" : recorded).then(() => viewState.setPreference("shortcuts", shortcuts.overrides)).catch(error => workbench.status(error.message));
        } });
      const saveButton = dialog.querySelector(".primary"); saveButton.disabled = true;
      shortcuts.capture = text => {
        if (text === null) { dialog.close("cancel"); return; }
        const request = ++sequence;
        saveButton.disabled = true; recorded = null;
        void preview.normalizeShortcuts({ [args.id]: text }).then(bindings => {
          if (request !== sequence || !dialog.open) return;
          if (args.id === "preview.pause_display_hold" && bindings[args.id].wheelDirection) { value.textContent = "按住显示需要键盘组合键"; return; }
          recorded = bindings[args.id].canonicalText; value.textContent = bindings[args.id].displayText;
          saveButton.disabled = false;
        }).catch(error => { if (request === sequence) value.textContent = error.message; });
      };
      return;
    }
    if (id === "shortcut.reset" || id === "shortcut.resetAll") {
      if (id === "shortcut.reset") await shortcuts.reset(args.id);
      else await shortcuts.configure();
      viewState.setPreference("shortcuts", shortcuts.overrides); return;
    }
    if (id === "editor.font_decrease" || id === "editor.font_increase")
      return viewState.setPreference("editorFontSize", Math.max(8, Math.min(28, viewState.preferences.editorFontSize + (id === "editor.font_increase" ? 1 : -1))));
    if (id === "preview.stop_or_play") return command("preview.stop");
    if (id === "preview.play_pause_global") return command("preview.toggle");
    if (id === "preview.pause_display_hold") {
      if (args.active && (await preview.getState()).playing) return;
      return preview.setSettings({ pauseDisplayAltHoldActive: args.active });
    }
    if (id === "preview.speed_down" || id === "preview.speed_up") {
      const rate = workbench.previewTransport.state.rate;
      const next = id === "preview.speed_up" ? PLAYBACK_RATES.find(value => value > rate) ?? 2 : PLAYBACK_RATES.findLast(value => value < rate) ?? .25;
      return preview.setPlayback({ rate: next });
    }
    if (id === "timeline.zoom_in" || id === "timeline.zoom_out") return command("timeline.zoom", { delta: id === "timeline.zoom_in" ? -120 : 120 });
    if (id.startsWith("latency.")) {
      await latencyPending;
      const doc = workbench.documentSession;
      if (id === "latency.toggleAudition") { const state = await preview.getState(); return state.playing ? preview.pause() : preview.play(); }
      if (id === "latency.subdivision" || id === "latency.sfxVolumePercent") {
        const key = id.slice(8);
        const state = await preview.setLatency({ [key]: args.value }); workbench.setLatency(state); return state;
      }
      let field, value = args.value, result;
      if (id === "latency.detectBpm" || id === "latency.detectOffset") {
        const generation = doc.documentOpenGeneration;
        const bpm = id === "latency.detectBpm";
        result = bpm ? await preview.detectLatency("bpm") : await preview.detectLatency("offset", { bpm: doc.bpm, offsetSeconds: doc.offsetSeconds });
        if (generation !== workbench.documentSession.documentOpenGeneration) return;
        value = bpm ? result.bpm : result.offsetSeconds;
        field = bpm ? "document.wholeBpm" : "document.metadataFirst";
        doc[bpm ? "bpmDetectResult" : "offsetDetectResult"] = `${bpm ? "检测 BPM" : "检测偏移"}：${value.toFixed(3)}${bpm ? "" : " s"}`;
      } else field = { "latency.bpm": "document.wholeBpm", "latency.offsetSeconds": "document.metadataFirst", "latency.clockCount": "document.metadataClockCount" }[id];
      if (!field || !Number.isFinite(value) || field !== "document.metadataFirst" && value <= 0) throw new Error("请输入有效的 BPM、拍数或偏移");
      const change = await preview.documentCommand(field, { value: field === "document.metadataClockCount" ? String(Math.max(1, Math.round(value))) : value.toFixed(3),
        documentOpenGeneration: doc.documentOpenGeneration });
      applyDocument(change.document); await refreshTimeline(); return result || change;
    }
    if (id === "media.audioInfo") {
      if (!project || loadingDocument) { workbench.status("请选择谱面文件夹"); return; }
      const owner = project, generation = workbench.documentSession.documentOpenGeneration;
      const selection = reader(".mp3,.wav,.flac,.ogg,.m4a");
      const operation = Promise.all([mediaPending, selection]).then(async ([, files]) => {
        if (!files.length || owner !== project) return;
        await workbench.sourceEditor.pending; await editPending;
        const info = await preview.readAudioInfo(files[0]);
        if (owner !== project || generation !== workbench.documentSession.documentOpenGeneration) return;
        if (!info.valid) { workbench.status("音频中未找到 ID3v2 标签"); return info; }
        for (const [field, value] of [["document.metadataTitle", info.title], ["document.metadataArtist", info.artist]]) {
          if (!value) continue;
          const result = await preview.documentCommand(field, { value, documentOpenGeneration: generation });
          if (owner !== project) return;
          applyDocument(result.document);
        }
        if (info.cover) {
          const accepted = !owner.input.cover || await new Promise(resolve => openDialog(container, {
            title: "从音频读取信息", height: 260, body: h("p", {}, "使用音频内嵌封面替换工程封面？"),
            actions: [{ label: "取消", value: "cancel" }, { label: "替换", value: "replace", primary: true }],
            close: value => resolve(value === "replace") }));
          if (owner !== project) return;
          if (accepted) {
            const data = Uint8Array.from(atob(info.cover.base64), character => character.charCodeAt(0));
            await importMedia("cover", new File([data], "bg.jpg", { type: info.cover.mimeType }));
          }
        }
        if (owner !== project) return;
        await flushRecovery();
        workbench.status(info.coverError || "音频标签读取完成");
        return info;
      });
      mediaPending = operation.catch(() => {});
      return operation;
    }
    if (["media.audio", "media.cover", "media.video", "media.removeVideo"].includes(id)) {
      if (!project) { workbench.status("请选择谱面文件夹"); return; }
      const owner = project;
      const kind = id === "media.removeVideo" ? "video" : id.slice(6);
      let selection;
      if (id === "media.removeVideo") {
        selection = new Promise(resolve => openDialog(container, { title: "移除 PV", height: 260,
          body: h("p", {}, "移除当前 PV，保存工程时保留原素材备份。"), actions: [{ label: "取消", value: "cancel" }, { label: "移除", value: "remove", primary: true }],
          close: value => resolve(value === "remove" ? { file: undefined } : null) }));
      } else {
        const accepted = { audio: ".mp3,.wav,.flac,.ogg,.m4a", cover: ".jpg,.jpeg,.png,.webp", video: ".mp4,.webm" }[kind];
        selection = reader(accepted).then(files => files.length ? { file: files[0] } : null);
      }
      const operation = Promise.all([mediaPending, selection]).then(([, selected]) =>
        selected && owner === project ? importMedia(kind, selected.file) : undefined);
      mediaPending = operation.catch(() => {});
      return operation;
    }
    if (id === "analysis.activateRow") {
      await workbench.sourceEditor.pending; await editPending;
      const doc = workbench.documentSession;
      if (args.documentOpenGeneration !== doc.documentOpenGeneration || args.revision !== doc.revision
        || args.difficultyId !== doc.activeDifficultyId) return;
      viewState.openEditor(`difficulty:${doc.activeDifficultyId}`);
      const lines = workbench.sourceEditor.input.value.split("\n");
      const position = lines.slice(0, args.line - 1).reduce((offset, line) => offset + line.length + 1, 0)
        + Math.min(Math.max(0, args.column - 1), lines[args.line - 1]?.length ?? 0);
      workbench.sourceEditor.jumpToPosition(position);
      if (args.second >= 0) await preview.seek(args.second);
      return;
    }
    if (["edit.findNext", "edit.findPrevious", "edit.replaceAndFind", "edit.replaceAll"].includes(id)) {
      await workbench.sourceEditor.pending; await editPending;
      const result = workbench.sourceEditor.search(id, args);
      await editPending;
      return result;
    }
    if (id === "edit.bookmark" || id === "edit.renameBookmarkPrompt") {
      const rename = id === "edit.renameBookmarkPrompt";
      const session = workbench.documentSession;
      const bookmark = session.charts.find(chart => chart.id === session.activeDifficultyId)?.bookmarks?.find(bookmark => bookmark.line === args.line);
      const title = h("input", { type: "text", "aria-label": "书签名称", value: bookmark?.title || "书签" });
      openDialog(container, { title: rename ? "重命名书签" : "添加书签", height: 220, body: h("label", {}, "书签名称", title),
        actions: [{ label: "取消", value: "cancel" }, { label: rename ? "重命名" : "添加", value: "add", primary: true }],
        close: result => {
          if (result === "add" && session.documentOpenGeneration === workbench.documentSession.documentOpenGeneration && session.activeDifficultyId === workbench.documentSession.activeDifficultyId)
            void command(rename ? "edit.renameBookmark" : "edit.createBookmark", { ...args, title: title.value }).catch(error => workbench.status(error.message));
        } });
      title.focus(); title.select();
      return;
    }
    if (id === "document.navigateToBookmark") {
      if (args.difficulty !== workbench.documentSession.activeDifficultyId) await command("document.selectDifficulty", args);
      viewState.openEditor(`difficulty:${args.difficulty}`);
      const lines = workbench.sourceEditor.input.value.split("\n");
      workbench.sourceEditor.jumpToPosition(lines.slice(0, args.line - 1).reduce((position, line) => position + line.length + 1, 0));
      return;
    }
    if (id === "editor.overwrite_mode") return viewState.setPreference("editorOverwriteMode", !viewState.preferences.editorOverwriteMode);
    if (id.startsWith("transform.") || ["edit.acceptCompletion", "edit.selectCompletionIndex", "edit.dismissCompletion", "edit.triggerCompletion", "edit.touchPadAuthoring", "edit.createBookmark", "edit.renameBookmark", "edit.deleteBookmark"].includes(id)) {
      await workbench.sourceEditor.pending;
      await editPending;
      const source = workbench.sourceEditor;
      if (args.documentOpenGeneration != null && args.documentOpenGeneration !== workbench.documentSession.documentOpenGeneration
        || args.difficulty != null && args.difficulty !== workbench.documentSession.activeDifficultyId) return;
      const input = source.input;
      const text = input.value;
      const generation = workbench.documentSession.documentOpenGeneration;
      const difficulty = workbench.documentSession.activeDifficultyId;
      const linePosition = args.line ? text.split("\n").slice(0, args.line - 1).reduce((position, line) => position + line.length + 1, 0) : null;
      const result = await preview.editorCommand(id, { ...args, text,
        anchor: linePosition ?? (input.selectionDirection === "backward" ? input.selectionEnd : input.selectionStart),
        position: linePosition ?? (input.selectionDirection === "backward" ? input.selectionStart : input.selectionEnd) });
      if (input.value !== text || workbench.documentSession.documentOpenGeneration !== generation || workbench.documentSession.activeDifficultyId !== difficulty) return;
      if (result.consumed) source.applyTransaction(result.transaction);
      source.updateCompletion(result);
      await editPending;
      return result;
    }
    if (["cover.browseActiveLayerImage", "cover.browseBackgroundImage"].includes(id)) return (await reader(".png,.jpg,.jpeg,.webp,.bmp"))[0];
    if (["cover.importActiveLayerFont", "cover.importCardDisplayFont", "cover.importCardBodyFont"].includes(id)) {
      const [file] = await reader(".ttf,.otf"); if (!file) return;
      await userFonts.import(file); workbench.documentSession.userFonts = userFonts.list(); return file;
    }
    if (id === "cover.browseOutputFile") {
      if (!fileService.pickSaveFile) return workbench.documentSession.coverValues?.outputFile || "card.jpg";
      try {
        coverOutputHandle = await fileService.pickSaveFile({ suggestedName: coverFileName(workbench.documentSession.coverValues?.outputFile),
          types: [{ description: "封面图片", accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] } }] });
        return coverOutputHandle.name;
      } catch (error) { if (error.name !== "AbortError") throw error; return; }
    }
    if (id === "cover.importLayout") {
      const [file] = await reader(".json"); return file ? JSON.parse(await file.text()) : null;
    }
    if (id === "cover.saveLayout" || id === "cover.managePresets" || id === "cover.export") {
      const canvas = workbench.root.querySelector(".cover-editor")?.coverRenderer;
      if (!canvas) throw new Error("请打开封面编辑器");
      if (id === "cover.managePresets") return openCoverPresets(container, preferenceAssets, () => canvas.layoutFile());
      if (id === "cover.saveLayout") {
        const composition = await canvas.layoutFile();
        return fileService.download(new Blob([JSON.stringify(composition, null, 2)], { type: "application/json" }), "MiaCode-cover.json");
      }
      if (coverExportActive) throw new Error("封面导出任务运行中");
      coverExportActive = true;
      try {
        const name = coverFileName(workbench.documentSession.coverValues?.outputFile);
        if (fileService.pickSaveFile && coverOutputHandle?.name !== name) {
          try {
            coverOutputHandle = await fileService.pickSaveFile({ suggestedName: name,
              types: [{ description: "封面图片", accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] } }] });
          } catch (error) { if (error.name === "AbortError") return; throw error; }
        }
        const result = await canvas.exportImage({ type: /\.png$/i.test(coverOutputHandle?.name || name) ? "image/png" : "image/jpeg" });
        if (coverOutputHandle) await fileService.write({ fileHandle: coverOutputHandle }, result.blob);
        else await fileService.download(result.blob, name);
        workbench.status(`封面导出完成：${coverOutputHandle?.name || name}`); return { ...result, name: coverOutputHandle?.name || name };
      } finally { coverExportActive = false; }
    }
    if (id === "cover.canvasChanged") { workbench.documentSession.coverDirty = true; scheduleRecovery(workbench.documentSession); return; }
    if (id === "cover.error") { workbench.status(args.message); return; }
    if (id === "audio.saveAsSoftwareDefault") {
      const audio = await preview.audioCommand("audio.getSettings");
      viewState.setPreference("audioSoftwareDefault", audio.settings);
      workbench.status("音频设置保存为本地默认值"); return audio;
    }
    if (id === "audio.restoreSoftwareDefault") {
      args = { settings: viewState.preferences.audioSoftwareDefault || {} };
      id = "audio.restoreSettings";
    }
    if (id.startsWith("audio.")) {
      const audio = await preview.audioCommand(id, args);
      workbench.setAudio(audio);
      viewState.setPreference("audioSettings", audio.settings);
      return audio;
    }
    if (id === "timeline.viewport") return refreshTimeline();
    if (id === "timeline.playbackViewport") {
      timelineOptions.horizontalScrollValue = args.horizontalScrollValue;
      return refreshTimeline();
    }
    if (id === "timeline.settings") {
      Object.assign(timelineOptions, args);
      if (Object.hasOwn(args, "followProgressEnabled")) workbench.timelineView.followProgressEnabled = args.followProgressEnabled;
      workbench.timelineControls.update(timelineOptions);
      if (args.followPreviewEnabled === false) workbench.sourceEditor.setFollowState({ active: false });
      else if (args.followPreviewEnabled) await updateTimelineFollow(workbench.previewTransport.state.currentTime);
      return refreshTimeline();
    }
    if (id === "timeline.scroll") {
      const state = workbench.documentSession.timelineSceneState;
      timelineOptions.horizontalScrollValue = Math.max(0, Math.min(Math.max(0, (state?.contentWidth ?? 0) - (state?.viewportSize.width ?? 0)),
        (args.horizontalScrollValue ?? timelineOptions.horizontalScrollValue) + args.delta));
      return refreshTimeline();
    }
    if (id === "timeline.zoom") {
      timelineOptions.zoomScale = Math.max(.25, Math.min(8, timelineOptions.zoomScale * Math.exp(-args.delta / 600)));
      workbench.timelineControls.update(timelineOptions);
      return refreshTimeline();
    }
    if (id === "timeline.navigateAtPoint") {
      if (args.horizontalScrollValue !== undefined && args.horizontalScrollValue !== timelineOptions.horizontalScrollValue) {
        timelineOptions.horizontalScrollValue = args.horizontalScrollValue;
        await refreshTimeline();
      }
      const target = await preview.navigateTimeline(args);
      await preview.seek(target.second);
      if (target.resolved && !latencyPage) {
        viewState.openEditor(`difficulty:${workbench.documentSession.activeDifficultyId}`);
        workbench.sourceEditor.jumpToPosition(target.position);
      }
      timelineOptions.cursorSeconds = target.second;
      return refreshTimeline();
    }
    if (id === "preview.toggle") {
      return (await preview.getState()).playing ? preview.pause() : preview.play();
    }
    if (id === "preview.stop") {
      await preview.pause();
      if(workbench.documentSession.introAudition?.active)return;
      return preview.seek(0);
    }
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
    if (id === "file.demo") { if (await confirmDocumentChange()) return open({ maidata: SAMPLE }); return; }
    if (id === "file.new") { if (await confirmDocumentChange()) return open({ maidata: "&title=新谱面\n&artist=\n&first=0\n&lv_5=\n&inote_5=(120){4}E\n" }); return; }
    if (id === "file.close") {
      if (!await confirmDocumentChange()) return;
      await flushRecovery();
      const result = await preview.documentCommand("document.close", { documentOpenGeneration: workbench.documentSession.documentOpenGeneration });
      project = null; applyDocument(result.document);
      viewState.openEditorTabs = ["welcome"]; viewState.editorHistory = []; viewState.openEditor("welcome");
      return;
    }
    if (id === "file.open" || id === "file.openFolder") {
      const folder = await fileService.openFolder();
      const files = folder?.files || [];
      if (!files.length) return;
      const { projects, preferred } = inspectChartFolder(files);
      const selected = preferred || await chooseProject(projects);
      if (!selected) return;
      if (!await confirmDocumentChange()) return;
      workbench.status(`载入文件夹：${selected.label} · ${files.length} 个文件`);
      const savedProject = { id: crypto.randomUUID(), filePath: selected.path,
        binding: { filePath: selected.path, fileHandle: folder.handles.get(selected.path), directoryHandle: folder.directoryHandle },
        input: { audio: selected.chart.audio, cover: selected.chart.cover, video: selected.chart.video },
        files: [...selected.files].filter(([path]) => path !== selected.path) };
      await open(selected.chart, selected.path, selected.files, savedProject);
      savedProject.savedSourceText = workbench.documentSession.sourceText;
      await flushRecovery();
      return;
    }
    if (id === "file.save" || id === "file.saveAll" || id === "file.saveAs") return save(id === "file.saveAll", id === "file.saveAs");
    if (id === "file.flushRecovery") { await mediaPending; await workbench.sourceEditor.pending; await editPending; return flushRecovery(); }
    if (id === "file.openRecent" || id === "file.restore") {
      let record = args.id ? await projectStore.get(args.id) : null;
      if (!record) {
        const records = (await projectStore.list()).filter(record => id === "file.openRecent" || record.dirty);
        if (!records.length) { workbench.status("自动保存列表为空"); return; }
        const select = h("select", { "aria-label": "自动保存项目" }, records.map(record => h("option", { value: record.id }, `${record.title || record.filePath} · ${new Date(record.updatedAt).toLocaleString()}`)));
        const selected = await new Promise(resolve => openDialog(container, { title: "恢复自动保存", height: 260, body: select,
          actions: [{ label: "取消", value: "cancel" }, { label: "恢复", value: "restore", primary: true }], close: value => resolve(value === "restore" ? select.value : null) }));
        if (!selected) return;
        record = records.find(record => record.id === selected);
      }
      if (!await confirmDocumentChange()) return;
      record = hydrateProjectResources(await projectStore.get(record.id));
      let restoreEdits = record.dirty;
      const handle = record.binding?.fileHandle;
      if (handle && (!handle.queryPermission || await handle.queryPermission({ mode: "read" }) === "granted")) {
        const diskSource = decodeMaidata(await (await handle.getFile()).arrayBuffer());
        if (diskSource !== record.diskSourceText) {
          if (restoreEdits) {
            const choice = await new Promise(resolve => openDialog(container, {
              title: "谱面文件内容变动", height: 260,
              body: h("p", {}, "文件内容与自动保存记录的保存点存在差异，请选择打开的内容。"),
              actions: [{ label: "取消", value: "cancel" }, { label: "打开文件内容", value: "disk" },
                { label: "恢复编辑内容", value: "recover", primary: true }], close: resolve,
            }));
            if (choice === "cancel") return;
            restoreEdits = choice === "recover";
          }
          record.savedSourceText = diskSource;
          record.diskSourceText = diskSource;
          if (!restoreEdits) {
            record.sourceText = diskSource; record.dirty = false;
            record.input = { ...record.savedInput }; record.files = [...record.savedFiles]; record.resourceChanges = []; record.mediaDirty = false;
          }
        }
      }
      const files = new Map(record.files);
      const source = new File([record.savedSourceText], "maidata.txt", { type: "text/plain" });
      Object.defineProperty(source, "webkitRelativePath", { value: record.filePath });
      files.set(record.filePath, source);
      await open({ ...record.input, maidata: record.savedSourceText, difficulty: record.activeDifficultyId }, record.filePath, files, record);
      if (restoreEdits && record.sourceText !== record.savedSourceText) {
        const result = await preview.documentCommand("document.replaceSource", { sourceText: record.sourceText,
          documentOpenGeneration: workbench.documentSession.documentOpenGeneration });
        applyDocument(result.document);
      }
      if (restoreEdits && record.chartText !== workbench.documentSession.chartText) {
        const result = await preview.documentCommand("document.replaceActiveDifficultyChart", { value: record.chartText,
          difficulty: record.activeDifficultyId, documentOpenGeneration: workbench.documentSession.documentOpenGeneration });
        applyDocument(result.document);
      }
      if (record.editorState) {
        viewState.openEditorTabs = [...record.editorState.openEditorTabs];
        viewState.openEditor(record.editorState.activeEditorKey);
      }
      await flushRecovery();
      return;
    }
    if (id === "file.removeRecent") {
      const record = await projectStore.get(args.id);
      if (record) await projectStore.put({ ...record, recent: false });
      if (project?.id === args.id) project.recent = false;
      await refreshRecent(); return;
    }
    if (id === "document.selectDifficulty") {
      await workbench.sourceEditor.pending;
      await editPending;
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
      const result = await preview.documentCommand(id, { ...args, documentOpenGeneration: workbench.documentSession.documentOpenGeneration });
      applyDocument(result.document);
      if (result.previewError) workbench.status(result.previewError);
      await refreshTimeline();
      return;
    }
    if (id === "preview.settings") {
      await userAppearance.restore(args);
      const settings = await preview.setSettings(args);
      workbench.documentSession.previewSettings = settings;
      await refreshTimeline();
      return;
    }
    if (id === "preview.values") {
      const operation=previewValuesPending.then(async()=>{
        const values = { ...viewState.preferences.previewValues, ...args };
        const changes=previewSettingsFromValues(Object.fromEntries(Object.entries(args).filter(([key])=>key!=="hudFontPath")));
        if("hudFontPath" in args)changes.hudFontPaths={[HUD_AREAS[values.hudFontAreaIndex ?? 0]]:args.hudFontPath};
        await userAppearance.restore(changes);
        const settings = Object.keys(changes).length ? await preview.setSettings(changes) : (await preview.getState()).settings;
        values.hudFontPaths=settings.hudFontPaths;
        values.hudFontPath=settings.hudFontPaths[HUD_AREAS[values.hudFontAreaIndex ?? 0]];
        workbench.documentSession.previewSettings = settings;
        workbench.documentSession.previewValues = { ...values, ...previewValuesFromSettings(settings) };
        viewState.setPreference("previewValues", {...values,...previewValuesFromSettings(settings)});
        if("hudFontPath" in args || "hudFontAreaIndex" in args || "hudFontPaths" in args || "skinDirectoryName" in args || "customOutlineFileName" in args) {
          workbench.pageKey=null;workbench.update();
        }
        await refreshTimeline(); return settings;
      });
      previewValuesPending=operation.catch(()=>{});return operation;
    }
    if (id === "edit.selectAll") { workbench.sourceEditor.focus(); workbench.sourceEditor.input.select(); return; }
    if (id === "edit.copy") {
      const input = workbench.sourceEditor.input;
      return navigator.clipboard.writeText(input.value.slice(input.selectionStart, input.selectionEnd));
    }
    if (id === "edit.cut" || id === "edit.paste") {
      const source = workbench.sourceEditor;
      await source.pending; await editPending;
      const before = source.capture(), generation = source.generation, difficulty = source.bufferKey;
      const replacement = id === "edit.cut" ? "" : await navigator.clipboard.readText();
      if (id === "edit.cut") await navigator.clipboard.writeText(before.text.slice(before.selectionStart, before.selectionEnd));
      if (source.generation !== generation || source.bufferKey !== difficulty || source.input.value !== before.text) return;
      source.applyTransaction({ hasEdit: true, replacementStart: before.selectionStart, replacementEnd: before.selectionEnd, replacementText: replacement,
        anchor: before.selectionStart + replacement.length, position: before.selectionStart + replacement.length });
      await editPending; return;
    }
    if (id === "edit.undo" || id === "edit.redo") {
      const source = workbench.sourceEditor;
      await source.pending; await editPending;
      source[id.slice(5)]();
      await preview.editorCommand("edit.dismissCompletion", { text: source.input.value });
      await editPending; return;
    }
    workbench.status("此操作需要可编辑谱面事务");
  }
  workbench.sourceEditor.nativePolicy = (id, args) => preview.editorCommand(id, { ...args, settings: {
    halfWidthInputEnabled: (viewState.preferences.editorInputHandlingMode ?? 1) !== 2,
    autoCompletionEnabled: viewState.preferences.editorAutoCompletion ?? true,
    overwriteMode: Boolean(viewState.preferences.editorOverwriteMode),
    wholeBpm: workbench.documentSession.wholeBpm || "",
  } });
  workbench.sourceEditor.onError = error => workbench.status(error.message);
  workbench.sourceEditor.overwriteEnabled = () => Boolean(viewState.preferences.editorOverwriteMode);
  workbench.sourceEditor.onSelection = () => {
    if (selectionFrame) return;
    selectionFrame = requestAnimationFrame(async () => {
      selectionFrame = 0;
      const input = workbench.sourceEditor.input;
      const text = input.value, start = input.selectionStart, end = input.selectionEnd;
      const enabled = viewState.preferences.editorSelectionBeatDisplay ?? true;
      if (selectionKey?.text === text && selectionKey.start === start && selectionKey.end === end && selectionKey.enabled === enabled) return;
      selectionKey = { text, start, end, enabled };
      const sequence = ++selectionSequence;
      if (!enabled || start === end) { workbench.selectionLabel.textContent = ""; workbench.selectionLabel.title = ""; return; }
      try {
        const summary = await preview.editorCommand("edit.selectionBeats", { text, anchor: start, position: end });
        if (sequence !== selectionSequence) return;
        const language = viewState.preferences.languageToken || "zh";
        const detail = summary.parts.map(part => `${part.count}/${part.denominator}`).join(" + ");
        const value = summary.parts.length > 1 ? `${summary.totalCommaCount} (${detail})` : detail;
        workbench.selectionLabel.textContent = summary.totalCommaCount ? formatMessage(translate("document.selection_beats", language), `${summary.exact ? "" : "~ "}${value}`) : "";
        workbench.selectionLabel.title = summary.exact ? detail : formatMessage(translate("document.selection_beats_inexact", language), detail);
      } catch (error) { workbench.status(error.message); }
    });
  };
  workbench.addEventListener("command", event => {
    event.detail.result = command(event.detail.id, event.detail.args);
    void event.detail.result.catch(error => workbench.status(error.message));
  }, { signal: abort.signal });
  function scheduleEditedPreview() {
    clearTimeout(editPreviewTimer);
    editPreviewTimer = setTimeout(() => {
      void preview.getState().then(state => { applyPlaybackState(state); return refreshTimeline(); })
        .catch(error => workbench.status(error.message));
    }, 120);
  }
  workbench.sourceEditor.input.addEventListener("beforeinput", () => {
    clearTimeout(editPreviewTimer);
    const pending = workbench.sourceEditor.pending;
    void pending.then(() => { if (pending === workbench.sourceEditor.pending) scheduleEditedPreview(); });
  }, { signal: abort.signal });
  workbench.addEventListener("sourcechange", event => {
    const sequence = ++editSequence;
    const generation = workbench.documentSession.documentOpenGeneration;
    editPending = preview.documentCommand("document.replaceActiveDifficultyChart", { value: event.detail,
      documentOpenGeneration: generation, difficulty: workbench.documentSession.activeDifficultyId, deferPreview: true }).then(result => {
      if (sequence !== editSequence || generation !== result.document.documentOpenGeneration) return;
      applyDocument(result.document);
      if (result.previewError) workbench.status(result.previewError);
      scheduleEditedPreview();
    });
    void editPending.catch(error => workbench.status(error.message));
    const title = `* ${workbench.documentSession.title || "未命名谱面"}`;
    if (workbench.titleLabel.textContent !== title) workbench.titleLabel.textContent = title;
  }, { signal: abort.signal });
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const id = key === "o" ? "file.open" : key === "s" ? event.shiftKey ? "file.saveAll" : "file.save" : null;
    if (id) { event.preventDefault(); void command(id).catch(error => workbench.status(error.message)); }
  }, { signal: abort.signal });
  window.addEventListener("beforeunload", event => {
    if (workbench.documentSession.dirty) { event.preventDefault(); event.returnValue = ""; }
  }, { signal: abort.signal });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flushRecovery().catch(error => workbench.status(error.message));
  }, { signal: abort.signal });
  const ready = mountPreview().then(async () => {
    await background.update({});
    await background.restore();
    await shortcuts.configure(viewState.preferences.shortcuts);
    canvasResize.observe(workbench.previewContainer);
    await fitCanvas();
    await refreshTimeline();
    await refreshRecent();
    workbench.status("预览就绪"); return workbench;
  }).catch(error => { workbench.status(error.message); throw error; });
  viewState.addEventListener("change", () => {
    if(viewState.activeEditorKey!=="export"&&(workbench.documentSession.introAudition?.active||introQueued)) {
      clearTimeout(introUpdateTimer);
      void runIntro(()=>preview.setIntroAudition({enabled:false})).catch(error=>workbench.status(error.message));
    }
    preview?.windowRouter.updateAppearance();
    void updatePerformance().catch(error => workbench.status(error.message));
    updateLatencyPage();
    updateAuthoringContext();
    const language = viewState.preferences.languageToken || "zh";
    if (language !== analysisLanguage) { analysisLanguage = language; scheduleAnalysis(); }
    if (theme === viewState.activeThemeToken) return;
    theme = viewState.activeThemeToken;
    void preview.setTheme(theme).catch(error => workbench.status(error.message));
    void refreshTimeline().catch(error => workbench.status(error.message));
  }, { signal: abort.signal });
  void ready.catch(() => {});
  return { workbench, viewState, ready, load: open, command,
    async getDocument() { await workbench.sourceEditor.pending; await editPending; return preview.getDocument(); },
    async getDocumentSaveText(section = 0) { await workbench.sourceEditor.pending; await editPending; return preview.getDocumentSaveText(section); },
    get preview() { return preview; },
    destroy() { clearTimeout(introUpdateTimer);clearTimeout(analysisTimer);clearTimeout(editPreviewTimer); ++analysisSequence; void flushRecovery().then(() => projectStore.close()).catch(error => workbench.status(error.message)); exportJobs.destroy();background.destroy();userFonts?.destroy();void preferenceAssets.close().catch(error=>workbench.status(error.message));abort.abort(); cancelAnimationFrame(selectionFrame); canvasResize.disconnect(); preview?.destroy(); if (coverSource) URL.revokeObjectURL(coverSource); workbench.destroy(); viewState.destroy(); },
  };
}

const root = document.getElementById("workbench");
if (root) {
  const editor = createWorkbench(root);
  root.editor = editor;
  window.addEventListener("pagehide", () => editor.destroy(), { once: true });
}

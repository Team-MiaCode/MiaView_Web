import { createPreview } from "./sdk/index.mjs";
import { inspectChartFolder } from "./services/chart-folder.mjs";
import { resolveChartMedia } from "./services/chart-resources.mjs";
import { PreferenceAssets } from "./services/preference-assets.mjs";
import { HUD_AREAS, previewSettingsFromValues, previewValuesFromSettings } from "./services/preview-appearance.mjs";
import { UserAppearance } from "./services/user-appearance.mjs";
import { UserFonts } from "./services/user-fonts.mjs";
import { element as h, button } from "./ui/components/dom.mjs";
import { formRow, number, select, toggle } from "./ui/components/forms.mjs";
import { PopupHost } from "./ui/components/popup-host.mjs";
import { settingsTabs } from "./ui/components/settings-tabs.mjs";
import { createAudioSettings, updateAudioSettings } from "./ui/workbench/audio-settings.mjs";
import { createPreviewPanel } from "./ui/workbench/preview-panel.mjs";
import { previewAppearanceSections } from "./ui/workbench/preview-settings.mjs";

const element = id => document.getElementById(id);
const status = text => { element("status").textContent = text; };
const report = error => status(error.message);
const preferenceKey = "miacode.web.preview.preferences";
const preferences = { languageToken: "zh" };
try { Object.assign(preferences, JSON.parse(localStorage.getItem(preferenceKey))); } catch (error) { report(error); }
function savePreferences(changes) {
  Object.assign(preferences, changes);
  try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch (error) { report(error); }
}
const viewState = { preferences };
const documentSession = { previewValues: { ...preferences.previewValues } };
const lifetime = new AbortController();
const { signal } = lifetime;
const audioButton = button("音频设置", () => toggleSettings("audio-settings", audioButton),
  { symbol: "audio-settings", className: "chrome", iconOnly: true });
const panel = createPreviewPanel({ viewState, command, trailingAction: audioButton,
  menu: (trigger, items) => popups.showMenu(trigger, items, { above: true, alignEnd: true }),
  openSettings: () => toggleSettings("preview-settings", panel.settingsButton) });
const { root, container, transport, statistics } = panel;
element("preview").append(root);
panel.settingsButton.disabled = true;
const popups = new PopupHost(root, command);
const surface = h("div", { className: "preview-surface" });
const square = { width: 1080, height: 1080 };
document.documentElement.dataset.theme = preferences.theme ?? "dark";
const preview = createPreview(surface, { layout: "fit", controls: false, diagnostics: false,
  resolution: square, theme: document.documentElement.dataset.theme });
const assets = new PreferenceAssets();
const appearance = new UserAppearance(preview, assets);
const fonts = new UserFonts(preview, assets);

const settingsTitle = h("h3", { id: "preview-settings-title" });
const settingsBody = h("div", { className: "preview-overlay-body" });
const closeButton = button("关闭设置", closeSettings, { className: "chrome", symbol: "close", iconOnly: true });
const overlay = h("section", { id: "preview-settings-overlay", className: "preview-settings-overlay", hidden: true,
  "aria-labelledby": settingsTitle.id }, h("div", { className: "preview-overlay-heading" }, settingsTitle, closeButton), settingsBody);
container.replaceChildren(surface, overlay);
for (const trigger of [panel.settingsButton, audioButton]) {
  trigger.setAttribute("aria-controls", overlay.id);
  trigger.setAttribute("aria-expanded", "false");
}

let activeSettings, settingsTrigger;
function closeSettings(restoreFocus = true) {
  if (!activeSettings) return;
  overlay.hidden = true;
  settingsBody.replaceChildren();
  activeSettings = null;
  settingsTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus !== false) settingsTrigger.focus();
}
function toggleSettings(key, trigger) {
  if (activeSettings === key) return closeSettings();
  closeSettings(false);
  activeSettings = key;
  settingsTrigger = trigger;
  settingsTitle.textContent = trigger.title;
  trigger.setAttribute("aria-expanded", "true");
  const context = { viewState, documentSession, command, close: closeSettings };
  const content = key === "audio-settings" ? createAudioSettings(context) : settingsTabs([
    ...previewAppearanceSections({ ...context, touchPadAuthoring: false }),
    { key: "playback", label: "播放", render: playbackSettings },
  ], viewState.previewSettingsPage, page => { viewState.previewSettingsPage = page; });
  settingsBody.replaceChildren(content);
  settingsBody.scrollTop = 0;
  overlay.hidden = false;
  closeButton.focus();
}
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !event.defaultPrevented && activeSettings) closeSettings();
}, { signal });

let playback = {};
function playbackSettings() {
  const { duration } = transport.state;
  return [
    formRow("主题", select([["dark", "深色"], ["light", "浅色"], ["legacy", "经典深色"], ["legacy_light", "经典浅色"]],
      preferences.theme ?? "dark", theme => command("preview.theme", { theme }))),
    formRow("画布帧率", select([[0, "30 FPS"], [1, "60 FPS"], [2, "120 FPS"], [3, "无限制"]],
      preferences.canvasFrameRateMode ?? 1, mode => command("preview.frameRate", { canvasFrameRateMode: Number(mode) }))),
    ...(transport.loaded ? [
      toggle("区间播放", Boolean(playback.rangePlaybackEnabled), enabled => command("preview.rangeMode", { enabled })),
      ...[["exportStartSeconds", "起点（秒）", 0], ["exportEndSeconds", "终点（秒）", duration]].map(([key, label, fallback]) =>
        formRow(label, number(key, playback[key] || fallback, (_, { value }) => command("preview.range", { [key]: value }),
          { min: 0, max: duration }))),
    ] : []),
  ];
}

let canvasSize = square;
async function fitCanvas() {
  const { clientWidth: width, clientHeight: height } = container;
  if (!width || !height) return;
  const scale = Math.min(1080 / height, 4096 / Math.max(width, height));
  const next = preferences.previewCanvasFreeAspect
    ? { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
    : square;
  if (next.width === canvasSize.width && next.height === canvasSize.height) return;
  canvasSize = next;
  try { await preview.setCanvasSize(next); }
  catch (error) { if (canvasSize === next) canvasSize = {}; throw error; }
}
const resize = new ResizeObserver(() => { void fitCanvas().catch(report); });

let state = {};
function updatePlayback(value) {
  state = { ...state, ...value };
  if (value.playback) playback = value.playback;
  transport.update(value);
  statistics.update(state.statistics ?? [], { dataAvailable: state.statisticsAvailable,
    noteSkin: documentSession.previewSettings?.noteSkin });
}
function updateAudio(audio) {
  documentSession.audio = audio;
  if (activeSettings === "audio-settings") updateAudioSettings(settingsBody.firstElementChild, audio, preferences.languageToken);
}
const unsubscribe = [
  preview.on("progress", event => status(event.stage)),
  preview.on("error", event => status(event.message)),
  preview.on("timeupdate", updatePlayback),
  preview.on("playbackChanged", value => { playback = value; transport.update({ playback }); }),
  preview.on("settingsChanged", settings => {
    documentSession.previewSettings = settings;
    statistics.update(state.statistics ?? [], { dataAvailable: state.statisticsAvailable, noteSkin: settings.noteSkin });
  }),
];

let settingsPending = Promise.resolve();
function applyValues(args) {
  const operation = settingsPending.then(async () => {
    const values = { ...preferences.previewValues, ...args };
    const area = HUD_AREAS[values.hudFontAreaIndex ?? 0];
    const changes = previewSettingsFromValues(args);
    if ("hudFontPath" in args) changes.hudFontPaths = { [area]: args.hudFontPath };
    await appearance.restore(changes);
    const settings = Object.keys(changes).length ? await preview.setSettings(changes) : documentSession.previewSettings;
    const saved = { ...values, ...previewValuesFromSettings(settings), hudFontPaths: settings.hudFontPaths,
      hudFontPath: settings.hudFontPaths?.[area] ?? "" };
    Object.assign(documentSession.previewValues, saved);
    savePreferences({ previewValues: saved });
    if (activeSettings === "preview-settings" && ["hudFontPath", "hudFontAreaIndex", "skinDirectoryName", "customOutlineFileName"].some(key => key in args))
      settingsBody.firstElementChild.refresh();
  });
  settingsPending = operation.catch(() => {});
  return operation;
}

const assetInput = element("asset");
let chooseAsset;
assetInput.addEventListener("change", () => {
  if (assetInput.files.length) void chooseAsset(Array.from(assetInput.files)).catch(report);
}, { signal });
function pickAsset(accept, action, directory = false) {
  chooseAsset = action;
  assetInput.toggleAttribute("webkitdirectory", directory);
  assetInput.multiple = directory;
  assetInput.accept = accept;
  assetInput.value = "";
  assetInput.click();
}

let playbackRequest;
function togglePlayback() {
  const playing = !(playbackRequest?.playing ?? transport.state.playing);
  const request = { playing };
  playbackRequest = request;
  return (playing ? preview.play() : preview.pause()).then(value => {
    if (playbackRequest === request) updatePlayback(value);
  }).finally(() => {
    if (playbackRequest === request) playbackRequest = undefined;
  });
}

async function execute(id, args) {
  switch (id) {
    case "preview.toggle": return togglePlayback();
    case "preview.pause": updatePlayback(await preview.pause()); return;
    case "preview.stop": await preview.pause(); updatePlayback(await preview.seek(0)); return;
    case "preview.seek": await preview.pause(); updatePlayback(await preview.seek(args.second)); return;
    case "preview.rate":
      await preview.setPlayback(args);
      savePreferences({ previewPlaybackRate: args.rate });
      return;
    case "preview.rangeMode":
      if (!transport.loaded) return;
      return preview.setPlayback({ rangePlaybackEnabled: args.enabled, exportStartSeconds: playback.exportStartSeconds ?? 0,
        exportEndSeconds: playback.exportEndSeconds || transport.state.duration });
    case "preview.range": return preview.setPlayback({ exportEndSeconds: playback.exportEndSeconds || transport.state.duration, ...args });
    case "preview.toggleFreeAspect":
      savePreferences({ previewCanvasFreeAspect: !preferences.previewCanvasFreeAspect });
      return fitCanvas();
    case "preview.toggleHidePv": {
      const hidePv = !preferences.previewHidePv;
      await preview.setMediaSettings({ hidePv });
      savePreferences({ previewHidePv: hidePv });
      return;
    }
    case "preview.theme":
      await preview.setTheme(args.theme);
      document.documentElement.dataset.theme = args.theme;
      savePreferences(args);
      return;
    case "preview.frameRate": await preview.setPerformance(args); savePreferences(args); return;
    case "preview.values": return applyValues(args);
    case "skin.import": return pickAsset("image/png", async files => {
      const skin = await appearance.importSkin(files);
      Object.assign(documentSession, await appearance.list());
      await applyValues({ skinDirectoryName: skin.skinDirectoryName });
    }, true);
    case "preview.importJudgeLine": return pickAsset("image/png", async ([file]) => {
      const outline = await appearance.importJudgeLine(file);
      Object.assign(documentSession, await appearance.list());
      await applyValues({ customOutlineFileName: outline.customOutlineFileName });
    });
    case "preview.importHudFont": return pickAsset(".ttf,.otf", async ([file]) => {
      const font = await fonts.import(file);
      documentSession.userFonts = fonts.list();
      await applyValues({ hudFontPath: font.path });
    });
    case "preview.resetHudFont": return applyValues({ hudFontPath: "" });
    case "audio.saveAsSoftwareDefault": {
      const audio = await preview.audioCommand("audio.getSettings");
      savePreferences({ audioSoftwareDefault: audio.settings });
      return;
    }
    case "audio.restoreSoftwareDefault":
      return execute("audio.restoreSettings", { settings: preferences.audioSoftwareDefault ?? {} });
    case "media.select": return pickAsset(args.accept, ([file]) =>
      queueDocument(() => preview.setResources({ [args.kind]: file })));
  }
  if (id.startsWith("audio.")) {
    const audio = await preview.audioCommand(id, args);
    updateAudio(audio);
    savePreferences({ audioSettings: audio.settings });
  }
}
function command(id, args = {}) { return execute(id, args).catch(report); }

const difficulty = element("difficulty");
const projectSelect = element("project");
const media = element("media");
let projects = [], pending = Promise.resolve(), loaded = false;
function enableDocumentControls(enabled) {
  difficulty.disabled = media.disabled = !enabled;
  transport.setDocument({ hasDocument: enabled });
  audioButton.disabled = panel.settingsButton.disabled;
  if (activeSettings === "preview-settings" && viewState.previewSettingsPage === "playback")
    settingsBody.firstElementChild.refresh();
}
function queueDocument(action) {
  enableDocumentControls(false);
  const operation = pending.then(action);
  const settled = pending = operation.catch(() => {});
  return operation.finally(() => {
    if (!signal.aborted && pending === settled) enableDocumentControls(loaded);
  });
}
function selectProject(project) {
  void queueDocument(async () => {
    loaded = false;
    const info = await preview.load({ ...project.chart, video: undefined, filePath: project.path });
    if (project.files) {
      const snapshot = await preview.getDocument();
      const resolved = resolveChartMedia(project.files, project.path, snapshot.metadataVideoPath);
      const resources = { ...project.chart, ...resolved };
      await preview.setResources({ video: resources.video ?? null,
        ...("cover" in resolved ? { cover: resolved.cover } : {}) });
    }
    loaded = true;
    difficulty.replaceChildren(...info.charts.map(chart => new Option(chart.label, String(chart.id))));
    difficulty.value = String(info.difficultyId);
    updatePlayback(await preview.getState());
    status(info.title || project.label);
  }).catch(report);
}
element("files").addEventListener("change", event => {
  try {
    if (!event.target.files.length) return;
    const selection = inspectChartFolder(event.target.files);
    projects = selection.projects;
    projectSelect.replaceChildren(...projects.map((project, index) => new Option(project.label, String(index))));
    projectSelect.hidden = projects.length === 1;
    const selected = selection.preferred || projects[0];
    projectSelect.value = String(projects.indexOf(selected));
    selectProject(selected);
  } catch (error) { report(error); }
  finally { event.target.value = ""; }
}, { signal });
element("maidata").addEventListener("change", event => {
  const [maidata] = event.target.files;
  if (!maidata) return;
  projectSelect.hidden = true;
  projectSelect.replaceChildren();
  projects = [];
  selectProject({ label: maidata.name, chart: { maidata } });
  event.target.value = "";
}, { signal });
projectSelect.addEventListener("change", () => selectProject(projects[Number(projectSelect.value)]), { signal });
difficulty.addEventListener("change", () => {
  const id = Number(difficulty.value);
  void queueDocument(async () => {
    await preview.selectDifficulty(id);
    const value = await preview.getState();
    difficulty.value = String(value.difficultyId);
    updatePlayback(value);
  }).catch(report);
}, { signal });
media.addEventListener("click", () => popups.showMenu(media, [
  ["选择音乐", "media.select", null, { kind: "audio", accept: "audio/*,.flac,.ogg,.m4a" }],
  ["选择背景图", "media.select", null, { kind: "cover", accept: "image/*" }],
  ["选择 PV", "media.select", null, { kind: "video", accept: "video/*,.mp4,.webm" }],
]), { signal });

window.addEventListener("pagehide", event => {
  if (event.persisted) return;
  lifetime.abort();
  resize.disconnect();
  popups.destroy();
  statistics.destroy();
  fonts.destroy();
  unsubscribe.forEach(remove => remove());
  preview.destroy();
  void assets.close().catch(() => {});
}, { signal });

void preview.ready.then(async () => {
  await preview.setPlayback({ rate: preferences.previewPlaybackRate ?? 1 });
  await preview.setMediaSettings({ hidePv: Boolean(preferences.previewHidePv) });
  await preview.setPerformance({ canvasFrameRateMode: preferences.canvasFrameRateMode ?? 1 });
  updateAudio(await (preferences.audioSettings
    ? preview.audioCommand("audio.restoreSettings", { settings: preferences.audioSettings })
    : preview.audioCommand("audio.getSettings")));
  documentSession.previewSettings = (await preview.getState()).settings;
  try {
    documentSession.userFonts = await fonts.restore();
    Object.assign(documentSession, await appearance.list());
    if (preferences.previewValues) await applyValues(preferences.previewValues);
  } catch (error) { report(error); }
  resize.observe(container);
  panel.settingsButton.disabled = audioButton.disabled = false;
  element("files").disabled = element("maidata").disabled = false;
  if (element("status").textContent === "预览初始化中…") status("选择谱面文件或文件夹");
}).catch(report);

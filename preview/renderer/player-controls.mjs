import { PreferenceAssets } from "../services/preference-assets.mjs";
import { HUD_AREAS, previewSettingsFromValues, previewValuesFromSettings } from "../services/preview-appearance.mjs";
import { UserAppearance } from "../services/user-appearance.mjs";
import { UserFonts } from "../services/user-fonts.mjs";
import { element as h, button } from "../ui/components/dom.mjs";
import { formRow, number, select, toggle } from "../ui/components/forms.mjs";
import { PopupHost } from "../ui/components/popup-host.mjs";
import { settingsTabs } from "../ui/components/settings-tabs.mjs";
import { createAudioSettings, updateAudioSettings } from "../ui/workbench/audio-settings.mjs";
import { createPreviewPanel } from "../ui/workbench/preview-panel.mjs";
import { previewAppearanceSections } from "../ui/workbench/preview-settings.mjs";

export function attachPlayerControls(controller, engine, parameters) {
  const preferenceKey = parameters.get("preferencesKey");
  const report = engine.fail;
  const preferences = { languageToken: "zh" };
  if (preferenceKey) {
    try { Object.assign(preferences, JSON.parse(localStorage.getItem(preferenceKey))); } catch (error) { report(error); }
  }
  function savePreferences(changes) {
    Object.assign(preferences, changes);
    if (!preferenceKey) return;
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
  document.body.prepend(root);
  panel.settingsButton.disabled = true;
  const fullscreen = button("全屏", () => command("preview.fullscreen"), { className: "chrome" });
  panel.settingsButton.before(fullscreen);
  document.addEventListener("fullscreenchange", () => {
    const label = document.fullscreenElement ? "退出全屏" : "全屏";
    fullscreen.textContent = label;
    fullscreen.setAttribute("aria-label", label);
    fullscreen.title = label;
  }, { signal });
  const popups = new PopupHost(root, command);
  const surface = document.getElementById("stage");
  const stageLayout = surface.parentElement;
  let baseResolution;
  const run = (type, payload) => controller.execute(type, payload);
  const preview = {
    play: () => run("play"),
    pause: () => run("pause"),
    seek: second => run("seek", { second }),
    setPlayback: args => run("setPlayback", args),
    setCanvasSize: args => run("setCanvasSize", args),
    setMediaSettings: args => run("setMediaSettings", args),
    setSettings: args => run("setSettings", args),
    setPerformance: args => run("setPerformance", args),
    setTheme: theme => run("setTheme", { theme }),
    audioCommand: (id, args = {}) => run("audioCommand", { id, args }),
    importFont: (font, name = font.name) => run("importFont", { font, name }),
    importSkin: files => run("importSkin", { files }),
    importJudgeLine: image => run("importJudgeLine", { image }),
  };
  const assets = new PreferenceAssets();
  const appearance = new UserAppearance(preview, assets);
  const fonts = new UserFonts(preview, assets);

  const settingsTitle = h("h3", { id: "preview-settings-title" });
  const settingsBody = h("div", { className: "preview-overlay-body" });
  const closeButton = button("关闭设置", closeSettings, { className: "chrome", symbol: "close", iconOnly: true });
  const overlay = h("section", { id: "preview-settings-overlay", className: "preview-settings-overlay", hidden: true,
    "aria-labelledby": settingsTitle.id }, h("div", { className: "preview-overlay-heading" }, settingsTitle, closeButton), settingsBody);
  container.replaceChildren(surface, overlay);
  stageLayout.remove();
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
        document.documentElement.dataset.theme, theme => command("preview.theme", { theme }))),
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

  let canvasSize;
  async function fitCanvas() {
    const { clientWidth: width, clientHeight: height } = container;
    if (!width || !height || !baseResolution) return;
    const scale = Math.min(1080 / height, 4096 / Math.max(width, height));
    const next = preferences.previewCanvasFreeAspect
      ? { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
      : baseResolution;
    if (next.width === canvasSize?.width && next.height === canvasSize?.height) return;
    canvasSize = next;
    try { await preview.setCanvasSize(next); }
    catch (error) { if (canvasSize === next) canvasSize = {}; throw error; }
  }
  const resize = new ResizeObserver(() => { void fitCanvas().catch(report); });

  let state = {};
  function updatePlayback(value) {
    state = { ...state, ...value };
    if (value.playback) playback = value.playback;
    if (value.media) preferences.previewHidePv = value.media.hidePv;
    if (value.performance) preferences.canvasFrameRateMode = value.performance.canvasFrameRateMode;
    transport.update(value);
    statistics.update(state.statistics ?? [], { dataAvailable: state.statisticsAvailable,
      noteSkin: documentSession.previewSettings?.noteSkin });
  }
  function updateAudio(audio) {
    documentSession.audio = audio;
    if (activeSettings === "audio-settings") updateAudioSettings(settingsBody.firstElementChild, audio, preferences.languageToken);
  }
  const unsubscribe = controller.events((type, value) => {
    if (type === "timeupdate") updatePlayback(value);
    if (type === "playbackChanged") updatePlayback({ playback: value });
    if (type === "settingsChanged") {
      documentSession.previewSettings = value;
      Object.assign(documentSession.previewValues, previewValuesFromSettings(value));
      statistics.update(state.statistics ?? [], { dataAvailable: state.statisticsAvailable, noteSkin: value.noteSkin });
    }
  });

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

  const assetInput = h("input", { type: "file", hidden: true });
  root.append(assetInput);
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
      case "preview.fullscreen": return document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
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
    }
    if (id.startsWith("audio.")) {
      const audio = await preview.audioCommand(id, args);
      savePreferences({ audioSettings: audio.settings });
    }
  }
  function command(id, args = {}) { return execute(id, args).catch(report); }

  const boot = engine.boot.then(async () => {
    if (signal.aborted) return;
    const initial = engine.state();
    baseResolution = canvasSize = initial.resolution;
    documentSession.previewSettings = initial.settings;
    await preview.audioCommand("audio.getSettings");
    try {
      if (preferences.theme) await preview.setTheme(preferences.theme);
      if (preferences.previewPlaybackRate != null) await preview.setPlayback({ rate: preferences.previewPlaybackRate });
      if (preferences.previewHidePv != null) await preview.setMediaSettings({ hidePv: preferences.previewHidePv });
      if (preferences.canvasFrameRateMode != null) await preview.setPerformance({ canvasFrameRateMode: preferences.canvasFrameRateMode });
      if (preferences.audioSettings) await preview.audioCommand("audio.restoreSettings", { settings: preferences.audioSettings });
      if (preferenceKey) {
        documentSession.userFonts = await fonts.restore();
        Object.assign(documentSession, await appearance.list());
      }
      if (preferences.previewValues) await applyValues(preferences.previewValues);
    } catch (error) { report(error); }
    if (signal.aborted) return;
    updatePlayback(engine.state());
    resize.observe(container);
    panel.settingsButton.disabled = false;
    audioButton.disabled = false;
  });
  return {
    boot,
    theme(theme) {
      document.documentElement.dataset.theme = theme;
      savePreferences({ theme });
    },
    audio: updateAudio,
    chart(chart) {
      transport.setDocument({ hasDocument: Boolean(chart) });
      audioButton.disabled = panel.settingsButton.disabled;
      if (activeSettings === "preview-settings" && viewState.previewSettingsPage === "playback")
        settingsBody.firstElementChild.refresh();
    },
    destroy() {
      lifetime.abort();
      resize.disconnect();
      popups.destroy();
      statistics.destroy();
      fonts.destroy();
      unsubscribe();
      void assets.close().catch(() => {});
    },
  };
}

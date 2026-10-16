import { element as h, button, icon, section } from "../components/dom.mjs";
import { SourceEditor } from "./source-editor.mjs";
import { DifficultyHeader } from "./difficulty-header.mjs";
import { EditorTabs } from "./editor-tabs.mjs";
import { openDesignerSlots } from "./designer-slots.mjs";
import { NoteStatistics } from "./note-statistics.mjs";
import { PreviewTransport } from "./preview-transport.mjs";
import { createAnalysisPanel, analysisCount } from "./analysis-panel.mjs";
import { createChartSidebar } from "./chart-sidebar.mjs";
import { TimelineView } from "./timeline-view.mjs";
import { TimelineControls } from "./timeline-controls.mjs";
import { translate } from "../components/translate.mjs";
import { PopupHost } from "../components/popup-host.mjs";
import { uiFontFamily } from "../components/font-family.mjs";
import { createPage, PAGE_NAMES } from "./pages.mjs";
import { updateAudioSettings } from "./audio-settings.mjs";

const menus = {
  文件: [["新建谱面", "file.new", "Ctrl+Alt+N"], ["打开谱面文件夹", "file.open", "Ctrl+Shift+O"], ["打开示例", "file.demo"], null, ["保存", "file.save", "Ctrl+S"], ["保存全部", "file.saveAll", "Ctrl+Shift+S"], ["另存为", "file.saveAs"], ["恢复自动保存", "file.restore"], ["关闭谱面", "file.close"]],
  编辑: [["撤销", "edit.undo", "Ctrl+Z"], ["重做", "edit.redo", "Ctrl+Y"], null, ["剪切", "edit.cut", "Ctrl+X"], ["复制", "edit.copy", "Ctrl+C"], ["粘贴", "edit.paste", "Ctrl+V"], ["全选", "edit.selectAll", "Ctrl+A"], ["查找替换", "edit.find", "Ctrl+F"], ["添加书签", "edit.bookmark"]],
  调整: [["左右镜像", "transform.mirror_lr"], ["上下镜像", "transform.mirror_ud"], ["旋转 180°", "transform.rotate_180"], ["顺时针旋转 45°", "transform.rotate_cw_45"], ["逆时针旋转 45°", "transform.rotate_ccw_45"], null, ["细分拍 +1", "transform.subdivision_up"], ["细分拍 −1", "transform.subdivision_down"], ["切换 Break", "transform.toggle_break"], ["切换 EX", "transform.toggle_ex"], ["切换烟花", "transform.toggle_firework"], ["重置摆键", "transform.reset_tap_notes"]],
  视图: [["侧栏", "view.sidebar", "Ctrl+B"], ["底部面板", "view.bottom"], ["预览位置", "view.swap"], ["编辑 / 预览", "view.preview"], ["谱面信息", "page.metadata"], ["偏好设置", "page.preferences"]],
  工具: [["导入音乐", "media.audio"], ["BPM 与延迟", "page.latency"], ["视频导出", "page.export"], ["封面编辑", "page.cover"], ["预览设置", "page.preview-settings"], ["音频设置", "page.audio-settings"]],
  帮助: [["关于 MiaCode", "page.about"]],
};

export class Workbench extends EventTarget {
  constructor(root, viewState) {
    super();
    this.root = root;
    this.popups = new PopupHost(root, (id, args) => this.command(id, args));
    this.viewState = viewState;
    this.documentSession = { hasDocument: false, sourceText: "", charts: [] };
    this.abort = new AbortController();
    this.sourceEditor = new SourceEditor({
      command: (id, args) => this.command(id, args),
      language: () => viewState.preferences.languageToken || "zh",
      onInput: text => this.dispatchEvent(new CustomEvent("sourcechange", { detail: text })),
      onCursor: ({ line, column }) => {
        viewState.editorCursorLine = line; viewState.editorCursorColumn = column;
        this.cursorLabel.textContent = `行 ${line}，列 ${column}`;
      },
    });
    this.timelineView = new TimelineView((id, args) => this.command(id, args));
    this.timelineControls = new TimelineControls((id, args) => this.command(id, args),
      (trigger, items, options) => this.showMenu(trigger, items, options),
      (trigger, popup, options) => this.openPopup(trigger, popup, options), () => viewState.preferences.languageToken || "zh");
    this.timelinePanel = h("div", { className: "timeline-panel" }, this.timelineView.root, this.timelineControls.root);
    this.difficultyHeader = new DifficultyHeader((id, args) => this.command(id, args), () => viewState.preferences.languageToken || "zh");
    this.difficultyEditor = h("div", { className: "difficulty-editor" }, this.difficultyHeader.root, this.sourceEditor.root);
    this.mount();
    viewState.addEventListener("change", () => this.update(), { signal: this.abort.signal });
    this.update();
  }
  command(id, args = {}) {
    if (id === "edit.bookmarkMenu") {
      const bookmark = this.documentSession.charts.find(chart => chart.id === this.documentSession.activeDifficultyId)?.bookmarks?.some(bookmark => bookmark.line === args.line);
      this.showMenu(args.trigger, bookmark ? [["删除书签", "edit.deleteBookmark", null, { line: args.line }], ["重命名书签", "edit.renameBookmarkPrompt", null, { line: args.line }]] : [["添加书签", "edit.bookmark", null, { line: args.line }]]);
      return;
    }
    if (id === "editor.activate") return this.editorTabs.activate(args.key);
    if (id === "document.designerSlots") return openDesignerSlots(this.root, { documentSession: this.documentSession, command: (key, values) => this.command(key, values), language: this.viewState.preferences.languageToken || "zh", opener: args.opener });
    if (id === "edit.find") {
      if (this.documentSession.hasDocument) this.viewState.openEditor(`difficulty:${this.documentSession.activeDifficultyId ?? 5}`);
      this.sourceEditor.showFind();
      return;
    }
    if (id === "page.open") return this.viewState.openEditor(args.key);
    if (id.startsWith("page.")) return this.viewState.openEditor(id.slice(5));
    if (id.startsWith("view.")) {
      const state = this.viewState;
      if (id === "view.sidebar") {
        if (this.root.clientWidth <= 1060) state.compactPanel = state.compactPanel === "sidebar" ? "" : "sidebar";
        else state.sidebarVisible = !state.sidebarVisible;
      } else if (id === "view.bottom") {
        if (this.root.clientHeight <= 480) { state.compactPanel = state.compactPanel === "bottom" ? "" : "bottom"; state.bottomPanelVisible = true; }
        else state.bottomPanelVisible = !state.bottomPanelVisible;
      }
      else if (id === "view.swap") return state.setPreference("previewOnLeft", !state.preferences.previewOnLeft);
      else if (id === "view.preview") state.compactView = state.compactView === "editor" ? "preview" : "editor";
      state.changed();
      return;
    }
    const detail = { id, args, result: undefined };
    this.dispatchEvent(new CustomEvent("command", { detail }));
    return detail.result;
  }
  setAudio(audio) {
    this.documentSession.audio = audio;
    if (this.pageKey === "audio-settings") updateAudioSettings(this.content.firstElementChild, audio,
      this.viewState.preferences.languageToken || "zh");
  }
  setExportStatus(state) {
    Object.assign(this.documentSession,{exportRunning:state.running,exportProgress:state.progress,exportMessage:state.message});
    if(this.pageKey==="export")this.content.firstElementChild?.updateProgress?.(this.documentSession);
  }
  setIntroAudition(state) {
    this.documentSession.introAudition=state;this.documentSession.introAuditionPlaying=state.playing;
    if(this.previewTransport.state.playing!==state.playing)this.previewTransport.update({playing:state.playing});
    if(this.pageKey==="export")this.content.firstElementChild?.updateAudition?.(state);
  }
  setLatency(state) {
    const values = state.latency;
    Object.assign(this.documentSession, { subdivision: values.subdivision, sfxVolumePercent: values.sfxVolumePercent,
      auditionRunning: Boolean(values.onPage && state.playing) });
    if (this.pageKey !== "latency") return;
    const page = this.content.firstElementChild;
    const audition = page.querySelector("#latencyAuditionButton");
    const label = this.documentSession.auditionRunning ? "暂停" : "开始试听";
    if (audition.textContent !== label) { audition.textContent = label; audition.title = label; audition.setAttribute("aria-label", label); }
    audition.classList.toggle("primary", !this.documentSession.auditionRunning);
    for (const button of page.querySelectorAll('.choice-row button')) button.setAttribute("aria-pressed", String(button.textContent === `1/${values.subdivision}`));
  }
  mount() {
    const state = this.viewState;
    this.root.replaceChildren();
    const menuBar = h("header", { className: "menubar", "aria-label": "主菜单" }, h("div", { className: "brand" }, h("img", { src: new URL("../components/icons/app-titlebar.png", import.meta.url).href, srcset: `${new URL("../components/icons/app-titlebar@2x.png", import.meta.url).href} 2x`, width: 17, height: 17, alt: "" }), h("span", {}, "MiaCode")));
    for (const [name, items] of Object.entries(menus)) {
      const trigger = button(name, () => this.showMenu(trigger, items), { className: "chrome menu-button", "aria-haspopup": "menu", "aria-expanded": "false" });
      menuBar.append(trigger);
    }
    this.titleLabel = h("span", { className: "document-title" }, "谱面编辑器");
    menuBar.append(this.titleLabel);
    const toolbar = h("div", { className: "toolbar", "aria-label": "工具栏" });
    for (const [label, id, symbol] of [["打开谱面文件夹", "file.open", "folder-open"], ["保存", "file.save", "save"], ["撤销", "edit.undo", "undo"], ["重做", "edit.redo", "redo"]]) toolbar.append(button(label, () => this.command(id), { symbol, iconOnly: true, className: "chrome" }));
    toolbar.append(h("span", { className: "spacer" }));
    for (const [label, key, symbol] of [["音频设置", "audio-settings", "audio-settings"], ["预览设置", "preview-settings", "preview-settings"]]) {
      const control = button(label, () => state.openEditor(key), { symbol, iconOnly: true, className: "chrome labeled-control" });
      control.append(h("span", { className: "label" }, label));
      toolbar.append(control);
    }
    this.sidebarToggle = button("侧栏", () => this.command("view.sidebar"), { symbol: "panel-left", iconOnly: true, className: "chrome" });
    this.bottomToggle = button("底部面板", () => this.command("view.bottom"), { symbol: "panel-bottom", iconOnly: true, className: "chrome" });
    toolbar.append(button("编辑 / 预览", () => this.command("view.preview"), { symbol: "eye", iconOnly: true, className: "chrome compact-switch" }), this.sidebarToggle, this.bottomToggle);
    const activity = h("nav", { className: "activitybar", "aria-label": "活动栏" });
    this.activityButtons = [];
    for (const [label, key, symbol] of [["谱面", "chart", "file"], ["导出", "export", "export"]]) {
      const node = button(label, () => {
        state.activeSidebarView = key;
        if (key === "export") state.openEditor("export");
        state.sidebarVisible = true;
        if (this.root.clientWidth <= 1060) state.compactPanel = "sidebar";
        state.changed();
      }, { symbol, iconOnly: true, dataset: { view: key }, "aria-pressed": "false" });
      activity.append(node); this.activityButtons.push(node);
    }
    activity.append(h("span", { className: "spacer" }), button("偏好设置", () => state.openEditor("preferences"), { symbol: "settings", iconOnly: true }));
    this.sidebar = h("aside", { className: "sidebar", "aria-label": "谱面侧栏" });
    const sidebarHandle = h("div", { className: "split-handle vertical sidebar-divider", role: "separator", tabIndex: 0, "aria-label": "侧栏宽度", "aria-orientation": "vertical" });
    this.editorTabs = new EditorTabs(state, (id, args) => this.command(id, args), (trigger, items) => this.showMenu(trigger, items), PAGE_NAMES);
    this.tabs = this.editorTabs.root;
    this.content = h("div", { className: "editor-content" });
    const editorPanel = h("section", { className: "editor-panel", "aria-label": "编辑区域" }, this.tabs, this.content);
    this.bottomBody = h("div", { className: "bottom-body" });
    this.bottomTabs = h("div", { className: "bottom-tabs", role: "tablist", "aria-label": "底部面板" });
    for (const [id, key] of [["timeline", "window.timeline"], ["validation", "window.syntax"], ["muri", "window.muri"]]) this.bottomTabs.append(button(translate(key, state.preferences.languageToken || "zh"), () => { state.bottomPanel = id; state.changed(); }, { dataset: { panel: id }, role: "tab", "aria-selected": "false" }));
    this.bottomTabs.append(h("span", { className: "spacer" }), this.timelineControls.follow);
    const bottomPanel = h("section", { className: "bottom-panel", "aria-label": "时间轴与分析" }, this.bottomTabs, this.bottomBody);
    const bottomHandle = h("div", { className: "split-handle horizontal bottom-divider", role: "separator", tabIndex: 0, "aria-label": "底部面板高度", "aria-orientation": "horizontal" });
    this.editorHost = h("div", { className: "editor-host" }, editorPanel, bottomHandle, bottomPanel);
    this.previewContainer = h("div", { className: "preview-container" }, h("div", { className: "preview-empty" }, "选择谱面查看预览"));
    const previewHeader = h("h2", { className: "panel-heading" }, "预览", h("span", { className: "spacer" }), button("预览设置", () => state.openEditor("preview-settings"), { symbol: "preview-settings", className: "chrome", iconOnly: true }));
    this.noteStatistics = new NoteStatistics(() => state.preferences.languageToken || "zh");
    this.previewTransport = new PreviewTransport((id, args) => this.command(id, args), (trigger, items) => this.showMenu(trigger, items), state);
    this.previewTransport.setDocument(this.documentSession);
    const previewHost = h("section", { className: "preview-host", "aria-label": "谱面预览" }, previewHeader, this.previewContainer, this.previewTransport.root, this.noteStatistics.root);
    const previewHandle = h("div", { className: "split-handle vertical preview-divider", role: "separator", tabIndex: 0, "aria-label": "预览宽度", "aria-orientation": "vertical" });
    this.mainSplit = h("div", { className: "main-split" }, this.editorHost, previewHandle, previewHost);
    const workspace = h("div", { className: "workspace" }, activity, this.sidebar, sidebarHandle, this.mainSplit);
    this.statusLabel = h("span", { className: "status-message", role: "status" }, "打开谱面开始创作");
    this.cursorLabel = h("span", {}, "行 1，列 1");
    this.metadataStatus = h("span", {}, "谱面信息");
    this.selectionLabel = h("span", { className: "selection-status" });
    this.formatStatus = h("span", {}, "simai");
    this.statusbar = h("footer", { className: "statusbar" }, this.statusLabel, this.metadataStatus, this.cursorLabel, this.selectionLabel, h("span", { className: "encoding" }, "UTF-8"), this.formatStatus);
    this.root.append(menuBar, toolbar, workspace, this.statusbar);
    this.attachResize(sidebarHandle, "sidebarWidth");
    this.attachResize(previewHandle, "previewWidthRatio");
    this.attachResize(bottomHandle, "bottomPanelHeightRatio");
    document.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && this.documentSession.hasDocument) { event.preventDefault(); this.command("edit.find"); }
      if (event.key === "Escape") { if (state.compactPanel) { state.compactPanel = ""; state.changed(); } this.closeMenu(); }
    }, { signal: this.abort.signal });
  }
  attachResize(handle, preference) {
    const state = this.viewState;
    handle.addEventListener("pointerdown", event => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const start = { x: event.clientX, y: event.clientY, value: state.preferences[preference] };
      const move = event => {
        let value;
        if (preference === "sidebarWidth") value = Math.max(180, Math.min(400, start.value + event.clientX - start.x));
        else if (preference === "previewWidthRatio") value = Math.max(.2, Math.min(.65, start.value + (state.preferences.previewOnLeft ? 1 : -1) * (event.clientX - start.x) / this.mainSplit.clientWidth));
        else value = Math.max(.15, Math.min(.6, start.value - (event.clientY - start.y) / this.editorHost.clientHeight));
        state.preferences[preference] = value;
        this.applyLayout();
      };
      const finish = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        state.setPreference(preference, state.preferences[preference]);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    }, { signal: this.abort.signal });
    handle.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
      const step = preference === "sidebarWidth" ? 10 : .02;
      state.setPreference(preference, Math.max(preference === "sidebarWidth" ? 180 : .15, Math.min(preference === "sidebarWidth" ? 400 : .65, state.preferences[preference] + direction * step)));
    }, { signal: this.abort.signal });
  }
  applyLayout() {
    const state = this.viewState;
    const prefs = state.preferences;
    const bottomAvailable = state.activeEditorKey.startsWith("difficulty:") || state.activeEditorKey === "latency";
    document.documentElement.dataset.theme = state.activeThemeToken;
    this.root.style.setProperty("--sidebar-width", `${prefs.sidebarWidth}px`);
    this.root.style.setProperty("--preview-width", `${prefs.previewWidthRatio * 100}%`);
    this.root.style.setProperty("--bottom-height", `${prefs.bottomPanelHeightRatio * 100}%`);
    this.root.style.setProperty("--ui-font-size", `${prefs.fontSize}px`);
    this.root.style.setProperty("--ui-font-family", uiFontFamily(prefs.languageToken || "zh"));
    this.root.style.setProperty("--code-font-size", `${prefs.editorFontSize}pt`);
    const spacing = Math.round(Math.max(1, Math.min(6, Math.round(prefs.editorFontSize * .18))) * (prefs.editorLineSpacing ?? 1));
    this.root.style.setProperty("--code-line-height", `calc(round(nearest, calc(var(--code-font-size) * var(--code-font-line-ratio) + 1px), 1px) + ${spacing}px)`);
    this.root.classList.toggle("sidebar-collapsed", !state.sidebarVisible);
    this.root.classList.toggle("sidebar-drawer", state.compactPanel === "sidebar");
    this.root.classList.toggle("bottom-drawer", bottomAvailable && state.compactPanel === "bottom");
    this.root.classList.toggle("bottom-collapsed", !bottomAvailable || !state.bottomPanelVisible);
    this.bottomToggle.disabled = !bottomAvailable;
    this.root.classList.toggle("preview-on-left", prefs.previewOnLeft);
    this.root.classList.toggle("show-preview", state.compactView === "preview");
    this.sourceEditor.setWrap(prefs.editorAutoWrap);
    this.sourceEditor.setPreferences(prefs);
  }
  update() {
    const state = this.viewState;
    this.applyLayout();
    this.timelineControls.update({});
    this.difficultyHeader.update(this.documentSession);
    for (const node of this.activityButtons) node.setAttribute("aria-pressed", String(node.dataset.view === state.activeSidebarView));
    this.titleLabel.textContent = this.documentSession.hasDocument ? `${this.documentSession.dirty ? "* " : ""}${this.documentSession.title || "未命名谱面"}` : "谱面编辑器";
    this.updateSidebar();
    this.editorTabs.update(this.documentSession);
    for (const [control, active, symbol] of [[this.sidebarToggle, state.sidebarVisible, "panel-left"], [this.bottomToggle, state.bottomPanelVisible, "panel-bottom"]]) {
      if (control.getAttribute("aria-pressed") !== String(active)) {
        control.setAttribute("aria-pressed", String(active));
        control.replaceChildren(icon(active ? `${symbol}-fill` : symbol));
      }
    }
    const difficultyActive = state.activeEditorKey.startsWith("difficulty:");
    this.cursorLabel.hidden = !difficultyActive;
    this.selectionLabel.hidden = !difficultyActive;
    this.formatStatus.hidden = !difficultyActive;
    this.metadataStatus.hidden = state.activeEditorKey !== "metadata";
    if (this.pageKey !== state.activeEditorKey) {
      this.pageKey = state.activeEditorKey;
      const node = this.pageKey.startsWith("difficulty:") ? this.difficultyEditor : createPage(this.pageKey || "welcome", { viewState: state, documentSession: this.documentSession, command: (id, args) => this.command(id, args), nativeCover: this.nativeCover });
      this.content.firstElementChild?.destroy?.();
      this.content.replaceChildren(node);
    }
    for (const node of this.bottomTabs.children) {
      if (!node.dataset.panel) continue;
      node.setAttribute("aria-selected", String(node.dataset.panel === state.bottomPanel));
      node.querySelector(".analysis-badge")?.remove();
      if (node.dataset.panel !== "timeline") {
        const result = analysisCount(this.documentSession[node.dataset.panel === "validation" ? "validationRows" : "muriRows"] || []);
        if (result.count) node.append(h("span", { className: `analysis-badge${result.error ? " error" : ""}` }, result.count));
      }
    }
    this.timelineControls.follow.hidden = state.bottomPanel !== "timeline";
    if (this.bottomKey !== state.bottomPanel) {
      this.bottomKey = state.bottomPanel;
      this.renderBottom();
    }
  }
  updateSidebar() {
    const state = this.viewState;
    const body = h("div", { className: "sidebar-body" });
    if (state.activeSidebarView === "chart") {
      const focused = this.sidebar.contains(document.activeElement) ? document.activeElement : null;
      const focusSelector = focused?.dataset.difficulty ? `[data-difficulty="${focused.dataset.difficulty}"]`
        : focused?.dataset.line ? `[data-line="${focused.dataset.line}"]`
        : focused?.classList.contains("difficulty-section-toggle") ? ".difficulty-section-toggle"
        : focused?.getAttribute("aria-label") ? `button[aria-label="${CSS.escape(focused.getAttribute("aria-label"))}"]` : null;
      this.sidebar.replaceChildren(...createChartSidebar({ viewState: state, documentSession: this.documentSession, command: (id, args) => this.command(id, args), menu: (trigger, items) => this.showMenu(trigger, items), dialogHost: this.root }));
      if (focusSelector) this.sidebar.querySelector(focusSelector)?.focus({ preventScroll: true });
      return;
    } else if (state.activeSidebarView === "export") {
      body.append(section("导出", button("视频导出", () => state.openEditor("export"), { symbol: "video", className: "nav-row" }), button("封面编辑", () => state.openEditor("cover"), { symbol: "image", className: "nav-row" })));
    }
    this.sidebar.replaceChildren(h("h2", { className: "panel-heading" }, state.activeSidebarView === "chart" ? "谱面" : state.activeSidebarView === "export" ? "导出" : "工具"), body);
  }
  renderBottom() {
    if (this.viewState.bottomPanel === "timeline") {
      this.bottomBody.replaceChildren(this.timelinePanel);
      this.timelineView.setState(this.documentSession.timelineSceneState || null);
    }
    else this.bottomBody.replaceChildren(createAnalysisPanel(this.viewState.bottomPanel, { documentSession: this.documentSession, command: (id, args) => this.command(id, args), language: this.viewState.preferences.languageToken || "zh" }));
  }
  showMenu(...args) { return this.popups.showMenu(...args); }
  openPopup(...args) { return this.popups.openPopup(...args); }
  closeMenu() { return this.popups.closeMenu(); }
  setDocument(snapshot) {
    this.documentSession = snapshot;
    this.previewTransport.setDocument(snapshot);
    this.noteStatistics.update(snapshot.statistics || [], { dataAvailable: snapshot.statisticsAvailable, noteSkin: snapshot.previewSettings?.noteSkin });
    this.sourceEditor.setDocument(snapshot.documentOpenGeneration, snapshot.activeDifficultyId, snapshot.chartText ?? snapshot.sourceText ?? "");
    this.sourceEditor.setAnnotations(snapshot);
    if (!this.viewState.activeEditorKey.startsWith("difficulty:")) this.pageKey = null;
    this.bottomKey = null;
    this.update();
  }
  status(message) { this.statusLabel.textContent = message; }
  setAnalysis(snapshot) {
    Object.assign(this.documentSession, snapshot);
    this.sourceEditor.setAnnotations(this.documentSession);
    this.bottomKey = null;
    this.update();
  }
  destroy() { this.content.firstElementChild?.destroy?.(); this.popups.destroy(); this.abort.abort(); this.editorTabs.destroy(); this.sourceEditor.destroy(); this.timelineView.destroy(); this.noteStatistics.destroy(); this.root.replaceChildren(); }
}

const preferenceKey = "miacode.web.preferences";
export const DEFAULT_PREFERENCES = Object.freeze({
  themeModeToken: "dark", darkThemeToken: "dark", lightThemeToken: "light", sidebarWidth: 240, previewWidthRatio: 0.42,
  bottomPanelHeightRatio: 0.29, previewOnLeft: false, fontSize: 13,
  editorFontSize: 14, editorAutoWrap: false, previewCanvasFreeAspect: false,
});

export class ViewState extends EventTarget {
  constructor(storage = globalThis.localStorage, systemTheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)")) {
    super();
    this.storage = storage;
    this.systemTheme = systemTheme;
    this.themeChanged = () => this.changed();
    systemTheme?.addEventListener("change", this.themeChanged);
    let saved = {};
    try { saved = JSON.parse(storage?.getItem(preferenceKey) || "{}"); } catch { /* Use the initial preferences. */ }
    this.preferences = { ...DEFAULT_PREFERENCES, ...saved };
    this.activeEditorKey = "welcome";
    this.openEditorTabs = ["welcome"];
    this.editorHistory = [];
    this.activeSidebarView = "chart";
    this.difficultySectionExpanded = true;
    this.expandedBookmarkGroups = new Map();
    this.sidebarVisible = true;
    this.bottomPanelVisible = true;
    this.bottomPanel = "timeline";
    this.compactPanel = "";
    this.compactView = "editor";
    this.editorCursorLine = 1;
    this.editorCursorColumn = 1;
  }
  changed() { this.dispatchEvent(new Event("change")); }
  bookmarkGroupExpanded(id) { return this.expandedBookmarkGroups.get(id) ?? true; }
  setBookmarkGroupExpanded(id, expanded) { this.expandedBookmarkGroups.set(id, expanded); this.changed(); }
  get activeThemeToken() {
    const prefs = this.preferences;
    const dark = prefs.themeModeToken === "system" ? this.systemTheme.matches : prefs.themeModeToken === "dark";
    return dark ? prefs.darkThemeToken : prefs.lightThemeToken;
  }
  openEditor(key) {
    if (!this.openEditorTabs.includes(key)) this.openEditorTabs.push(key);
    this.activeEditorKey = key;
    this.editorHistory = this.editorHistory.filter(item => item !== key);
    this.editorHistory.push(key);
    this.compactView = "editor";
    this.changed();
  }
  closeEditor(key) {
    this.openEditorTabs = this.openEditorTabs.filter(item => item !== key);
    this.editorHistory = this.editorHistory.filter(item => item !== key);
    if (this.activeEditorKey === key) this.activeEditorKey = this.editorHistory.at(-1) || this.openEditorTabs.at(-1) || "";
    this.changed();
  }
  setPreference(key, value) {
    this.preferences[key] = value;
    this.storage?.setItem(preferenceKey, JSON.stringify(this.preferences));
    this.changed();
  }
  destroy() { this.systemTheme?.removeEventListener("change", this.themeChanged); }
}

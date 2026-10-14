import { element as h, button, icon } from "../components/dom.mjs";
import { DIFFICULTY_NAMES } from "./chart-sidebar.mjs";

export class EditorTabs {
  constructor(viewState, command, menu, pageNames) {
    this.state = viewState;
    this.command = command;
    this.pageNames = pageNames;
    this.root = h("div", { className: "editor-tabs", role: "tablist", "aria-label": "编辑器标签" });
    this.viewport = h("div", { className: "editor-tab-viewport" });
    this.overflow = button("显示所有打开的编辑器", () => menu(this.overflow, this.state.openEditorTabs.map(key => {
      const entry = this.entries.get(key);
      return [entry.label.textContent, "editor.activate", undefined, { key }, { role: "menuitemradio", checked: key === this.state.activeEditorKey }];
    })), { className: "editor-tab-overflow", symbol: "more", iconOnly: true, "aria-haspopup": "menu" });
    this.root.append(this.viewport, this.overflow);
    this.entries = new Map();
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(this.root);
  }
  activate(key) {
    if (key.startsWith("difficulty:")) this.command("document.selectDifficulty", { difficulty: Number(key.slice(11)) });
    else this.state.openEditor(key);
  }
  update(doc) {
    const keys = this.state.openEditorTabs;
    for (const [key, entry] of this.entries) {
      if (!keys.includes(key)) { entry.root.remove(); this.entries.delete(key); }
    }
    for (const key of keys) {
      let entry = this.entries.get(key);
      const difficulty = key.startsWith("difficulty:") ? Number(key.slice(11)) : 0;
      const title = difficulty ? DIFFICULTY_NAMES[difficulty - 1] : this.pageNames[key] || key;
      if (!entry) {
        const label = h("span", { className: "editor-tab-label" });
        const activate = button(title, () => this.activate(key), { role: "tab", className: "editor-tab-activate" });
        activate.replaceChildren();
        if (difficulty) activate.append(h("span", { className: "difficulty-swatch", style: `background:var(--difficulty-${difficulty})`, "aria-hidden": "true" }));
        else if (key === "metadata" || key === "latency") activate.append(icon(key === "metadata" ? "metadata" : "metronome", 15));
        activate.append(label);
        const close = button(`关闭 ${title}`, () => this.command("editor.close", { key }), { className: "editor-tab-close", symbol: "close", iconOnly: true });
        const root = h("div", { className: "editor-tab", role: "presentation", dataset: { editorKey: key } }, activate, close);
        root.addEventListener("auxclick", event => { if (event.button === 1) { event.preventDefault(); this.command("editor.close", { key }); } });
        entry = { root, activate, label, close };
        this.entries.set(key, entry);
      }
      const dirty = difficulty ? doc.dirtyDifficultyIds?.includes(difficulty) : key === "metadata" && doc.metadataDirty;
      entry.label.textContent = `${dirty ? "*" : ""}${title}`;
      entry.root.classList.toggle("active", key === this.state.activeEditorKey);
      entry.activate.setAttribute("aria-selected", String(key === this.state.activeEditorKey));
      entry.activate.title = difficulty ? `${doc.filePath || "maidata.txt"}\n${title}` : title;
      const position = keys.indexOf(key);
      if (this.viewport.children[position] !== entry.root) this.viewport.insertBefore(entry.root, this.viewport.children[position] || null);
    }
    const changed = this.activeKey !== this.state.activeEditorKey;
    this.activeKey = this.state.activeEditorKey;
    this.layout(changed);
  }
  layout(reveal = true) {
    const count = this.entries.size;
    const width = this.root.clientWidth;
    const available = width - 10 - Math.max(0, count - 1) * 2;
    this.overflow.hidden = count * 100 <= available;
    this.root.style.setProperty("--editor-tab-width", `${count ? Math.max(100, Math.min(160, available / count)) : 160}px`);
    if (reveal) {
      const active = this.entries.get(this.activeKey)?.root;
      if (active) {
        const left = active.offsetLeft - this.viewport.offsetLeft;
        if (left < this.viewport.scrollLeft) this.viewport.scrollLeft = left;
        else if (left + active.offsetWidth > this.viewport.scrollLeft + this.viewport.clientWidth)
          this.viewport.scrollLeft = left + active.offsetWidth - this.viewport.clientWidth;
      }
    }
  }
  destroy() { this.resize.disconnect(); }
}

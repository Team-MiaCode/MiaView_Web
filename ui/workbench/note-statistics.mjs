import { element as h, icon } from "../components/dom.mjs";
import { translate } from "../components/translate.mjs";

export class NoteStatistics {
  constructor(language) {
    this.language = language;
    this.root = h("div", { className: "note-statistics", "aria-label": "音符统计" });
    this.cells = new Map();
    for (const kind of ["tap", "hold", "slide", "touch", "break", "total"]) {
      const image = kind === "total" ? icon("chart", 20) : h("img", { alt: "", width: 24, height: 24 });
      const name = h("span", { className: "note-stat-name" });
      const value = h("span", { className: "note-stat-value" });
      const cell = h("div", { className: "note-stat-cell", dataset: { kind } }, h("span", { className: "note-stat-icon" }, image),
        h("div", { className: "note-stat-text" }, name, value));
      this.cells.set(kind, { image, name, value });
      this.root.append(cell);
    }
    this.update([]);
    this.metrics = document.createElement("canvas").getContext("2d");
    this.resize = new ResizeObserver(() => this.measureFont());
    this.resize.observe(this.root);
    document.fonts.ready.then(() => this.measureFont());
  }
  measureFont() {
    if (!this.root.isConnected) return;
    const style = getComputedStyle(this.root);
    const font = `${style.fontSize} ${style.fontFamily}`;
    if (font === this.font) return;
    this.font = font;
    this.metrics.font = font;
    this.root.style.setProperty("--note-stat-text-width", `${this.metrics.measureText("8888/8888").width}px`);
  }
  update(statistics, { dataAvailable = false, noteSkin = "DX", efficientMode = false } = {}) {
    this.root.classList.toggle("efficient", efficientMode);
    for (const [kind, cell] of this.cells) {
      const entry = statistics.find(item => item.kind === kind);
      const name = entry?.name || translate(`note_stats.${kind}`, this.language());
      const value = dataAvailable && entry ? String(entry.value) : "—";
      if (cell.name.textContent !== name) cell.name.textContent = name;
      if (cell.value.textContent !== value) cell.value.textContent = value;
      if (kind !== "total") {
        const url = new URL(`../components/notes/${noteSkin === "SD" ? "SD" : "DX"}/${kind === "break" ? "tap_break" : kind}.png`, import.meta.url).href;
        if (cell.image.src !== url) cell.image.src = url;
      }
    }
  }
  destroy() { this.resize.disconnect(); }
}

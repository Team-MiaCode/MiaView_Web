import { element as h, icon } from "../components/dom.mjs";
import { translate } from "../components/translate.mjs";

export class NoteStatistics {
  constructor(language) {
    this.language = language;
    this.root = h("div", { className: "note-statistics", "aria-label": "音符统计" });
    this.cells = new Map();
    for (const kind of ["tap", "hold", "slide", "touch", "break", "total"]) {
      const image = kind === "total" ? icon("chart", 26) : h("img", { alt: "" });
      const name = h("span", { className: "note-stat-name" });
      const value = h("span", { className: "note-stat-value" });
      const reserve = h("span", { className: "note-stat-reserve", "aria-hidden": "true" });
      const cell = h("div", { className: "note-stat-cell", dataset: { kind } }, h("span", { className: "note-stat-icon" }, image),
        h("div", { className: "note-stat-text" }, name, h("div", { className: "note-stat-count" }, reserve, value)));
      this.cells.set(kind, { image, name, value, reserve });
      this.root.append(cell);
    }
    this.update([]);
  }
  update(statistics, { dataAvailable = false, noteSkin = "DX", efficientMode = false } = {}) {
    this.root.classList.toggle("efficient", efficientMode);
    for (const [kind, cell] of this.cells) {
      const entry = statistics.find(item => item.kind === kind);
      const name = entry?.name || translate(`note_stats.${kind}`, this.language());
      const value = dataAvailable && entry ? String(entry.value) : "—";
      const reserve = dataAvailable && entry?.total != null ? `${entry.total}/${entry.total}` : value;
      if (cell.name.textContent !== name) cell.name.textContent = name;
      if (cell.value.textContent !== value) cell.value.textContent = value;
      if (cell.reserve.textContent !== reserve) cell.reserve.textContent = reserve;
      if (kind !== "total") {
        const url = new URL(`../components/notes/${noteSkin === "SD" ? "SD" : "DX"}/${kind === "break" ? "tap_break" : kind}.png`, import.meta.url).href;
        if (cell.image.src !== url) cell.image.src = url;
      }
    }
  }
}

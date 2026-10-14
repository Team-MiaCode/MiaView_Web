import { element as h } from "../components/dom.mjs";

const clockText = seconds => {
  const milliseconds = Math.round(seconds * 1000);
  return `${String(Math.floor(milliseconds / 60000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
};

export class ExportRange {
  constructor({ totalSeconds, startSeconds, endSeconds, playheadSeconds = 0, minimumExportRangeSeconds = 5, labels, onRangeChanged }) {
    this.total = Math.max(0, totalSeconds);
    this.minimum = Math.min(minimumExportRangeSeconds, this.total);
    this.start = startSeconds;
    this.end = endSeconds;
    this.onRangeChanged = onRangeChanged;
    this.root = h("div", { className: "export-range-native" });
    const lane = h("div", { className: "export-range-lane" }, h("div", { className: "export-range-rail" }), h("div", { className: "export-range-selection" }), h("div", { className: "export-range-playhead", "aria-hidden": "true" }));
    this.root.style.setProperty("--range-playhead", this.total ? Math.max(0, Math.min(1, playheadSeconds / this.total)) : 0);
    this.handles = ["start", "end"].map((name, index) => {
      const handle = h("button", { type: "button", className: "export-range-handle", role: "slider", "aria-label": labels[index], disabled: this.total === 0 });
      handle.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
        const move = next => {
          const bounds = lane.getBoundingClientRect();
          this.move(name, (next.clientX - bounds.left - 10) / (bounds.width - 20) * this.total);
        };
        const finish = () => { handle.removeEventListener("pointermove", move); };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("lostpointercapture", finish, { once: true });
      });
      handle.addEventListener("keydown", event => {
        const current = name === "start" ? this.start : this.end;
        let next = current;
        if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)) next += (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1) * (event.shiftKey ? 1 : .1);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = this.total;
        else return;
        event.preventDefault(); this.move(name, next);
      });
      lane.append(handle);
      return handle;
    });
    this.root.append(lane, h("div", { className: "export-range-times" }, h("span", {}, clockText(0)), h("span", {}, clockText(this.total))));
    this.setRange(this.start, this.end);
  }
  move(name, value) {
    if (name === "start") this.start = Math.max(0, Math.min(this.end - this.minimum, value));
    else this.end = Math.min(this.total, Math.max(this.start + this.minimum, value));
    this.draw();
    this.onRangeChanged(this.start, this.end);
  }
  setRange(start, end) {
    this.end = Math.min(this.total, Math.max(this.minimum, end));
    this.start = Math.max(0, Math.min(this.end - this.minimum, start));
    this.draw();
  }
  draw() {
    this.root.style.setProperty("--range-start", this.total ? this.start / this.total : 0);
    this.root.style.setProperty("--range-end", this.total ? this.end / this.total : 1);
    for (const [index, handle] of this.handles.entries()) {
      handle.style.left = `calc(10px + (100% - 20px) * ${this.total ? (index ? this.end : this.start) / this.total : index} - 7px)`;
      handle.setAttribute("aria-valuemin", index ? this.start + this.minimum : 0);
      handle.setAttribute("aria-valuemax", index ? this.total : this.end - this.minimum);
      handle.setAttribute("aria-valuenow", index ? this.end : this.start);
      handle.setAttribute("aria-valuetext", clockText(index ? this.end : this.start));
    }
  }
}

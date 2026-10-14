import { element } from "../components/dom.mjs";
import { FindReplaceBar } from "./find-replace.mjs";
import { CompletionPopup } from "./completion-popup.mjs";
import { styleSourceLines } from "../../services/source-styles.mjs";

export class SourceEditor {
  constructor({ onInput, onCursor, command, language }) {
    this.onInput = onInput;
    this.onCursor = onCursor;
    this.root = element("div", { className: "source-editor" });
    this.gutter = element("pre", { className: "line-numbers", "aria-hidden": "true" });
    this.paint = element("pre", { className: "source-paint", "aria-hidden": "true" });
    this.followHighlight = `miacode-follow-${crypto.randomUUID()}`;
    const followStyle = element("style", {}, `.source-paint::highlight(${this.followHighlight}) { background-color: color-mix(in srgb, var(--state-follow-highlight) 25%, transparent); }`);
    this.input = element("textarea", {
      className: "source-input", "aria-label": "Simai 谱面正文", spellcheck: false,
      autocapitalize: "off", autocomplete: "off", autocorrect: "off", wrap: "off",
    });
    this.findBar = new FindReplaceBar({ command, language, dismiss: () => { this.findBar.hide(); this.focus(); } });
    this.viewport = element("div", { className: "source-viewport" }, this.gutter, this.paint, this.input);
    this.root.append(followStyle, this.findBar.root, this.viewport);
    this.completion = new CompletionPopup(this.viewport, command);
    this.completionState = { completionActive: false, completionCandidates: [], completionIndex: -1 };
    this.input.addEventListener("input", () => { this.draw(); this.onInput?.(this.input.value); this.cursor(); });
    this.input.addEventListener("scroll", () => this.scroll());
    this.input.addEventListener("keydown", event => {
      const state = this.completionState;
      if (!state.completionActive || !state.completionCandidates.length || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const index = (state.completionIndex + (event.key === "ArrowDown" ? 1 : -1) + state.completionCandidates.length) % state.completionCandidates.length;
        this.updateCompletion({ ...state, completionIndex: index });
        command("edit.selectCompletionIndex", { index });
      } else if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault(); command("edit.acceptCompletion", { index: state.completionIndex });
      } else if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); this.updateCompletion({ ...state, completionActive: false }); command("edit.dismissCompletion");
      }
    });
    for (const event of ["click", "keyup", "select"]) this.input.addEventListener(event, () => this.cursor());
    this.resize = new ResizeObserver(() => this.requestDraw());
    this.resize.observe(this.input);
    this.fontLoaded = () => this.requestDraw();
    document.fonts.addEventListener("loadingdone", this.fontLoaded);
  }
  setValue(value) {
    if (this.input.value !== value) {
      this.input.value = value;
      this.input.setSelectionRange(0, 0);
      this.input.scrollTop = 0; this.input.scrollLeft = 0;
    }
    this.draw();
    this.cursor();
  }
  requestDraw() {
    if (this.drawFrame) return;
    this.drawFrame = requestAnimationFrame(() => { this.drawFrame = 0; this.draw(); });
  }
  draw() {
    if (!this.input.clientWidth) return;
    const lines = this.input.value.split("\n");
    this.root.style.setProperty("--gutter-width", `calc(${String(lines.length).length}ch + 18px)`);
    this.paint.style.width = `${this.input.clientWidth}px`;
    this.paint.style.height = `${this.input.clientHeight}px`;
    this.paint.replaceChildren();
    const styles = styleSourceLines(this.input.value);
    for (const spans of styles) {
      const line = element("div", { className: "source-code-line" });
      for (const span of spans) line.append(span.kind ? element("span", { className: `syntax-${span.kind}` }, span.text) : document.createTextNode(span.text));
      if (!spans.length) line.append(document.createTextNode("\u200b"));
      this.paint.append(line);
    }
    const heights = [...this.paint.children].map(line => line.getBoundingClientRect().height);
    this.gutter.replaceChildren(...heights.map((height, index) => {
      const line = element("div", {}, String(index + 1));
      line.style.height = `${height}px`;
      return line;
    }));
    this.scroll();
    this.updateCurrentLine();
    if (this.followState) this.setFollowState(this.followState, true);
  }
  scroll() {
    this.gutter.style.transform = `translateY(${-this.input.scrollTop}px)`;
    this.paint.scrollTop = this.input.scrollTop;
    this.paint.scrollLeft = this.input.scrollLeft;
    this.updateCompletion(this.completionState);
  }
  cursor() {
    const prefix = this.input.value.slice(0, this.input.selectionStart);
    const lines = prefix.split("\n");
    this.updateCurrentLine(lines.length - 1);
    this.onCursor?.({ line: lines.length, column: lines.at(-1).length + 1 });
    this.updateCompletion(this.completionState);
  }
  updateCurrentLine(index = this.input.value.slice(0, this.input.selectionStart).split("\n").length - 1) {
    this.currentLine?.classList.remove("current-line");
    this.currentLine = this.input.selectionStart === this.input.selectionEnd ? this.paint.children[index] : null;
    this.currentLine?.classList.add("current-line");
  }
  updateCompletion(state) {
    this.completionState = state;
    if (!state.completionActive) { this.completion.root.hidden = true; return; }
    const lines = this.input.value.slice(0, this.input.selectionStart).split("\n");
    const line = this.paint.children[lines.length - 1];
    if (!line) return;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let remaining = lines.at(-1).length;
    let node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.length) break;
      remaining -= node.length;
    }
    if (!node) return;
    const range = document.createRange();
    range.setStart(node, remaining); range.collapse(true);
    const position = range.getBoundingClientRect(), host = this.viewport.getBoundingClientRect();
    this.completion.update(state, { left: position.left - host.left, top: position.top - host.top, height: position.height });
  }
  focus() { this.input.focus(); }
  textPoint(position) {
    const lines = this.input.value.slice(0, position).split("\n");
    const line = this.paint.children[lines.length - 1];
    if (!line) return null;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let remaining = lines.at(-1).length;
    let node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.length) return { node, offset: remaining };
      remaining -= node.length;
    }
    return null;
  }
  setFollowState(state, force = false) {
    const previous = this.followState;
    this.followState = state;
    if (!force && previous?.active === state.active && previous?.start === state.start && previous?.end === state.end && previous?.caret === state.caret) return;
    CSS.highlights.delete(this.followHighlight);
    if (!state.active) return;
    const start = this.textPoint(state.start), end = this.textPoint(state.end);
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    CSS.highlights.set(this.followHighlight, new Highlight(range));
    if (state.reveal) this.revealPosition(state.caret);
  }
  revealPosition(position) {
    const index = this.input.value.slice(0, position).split("\n").length - 1;
    const line = this.paint.children[index];
    if (!line) return;
    const top = line.offsetTop;
    if (top < this.input.scrollTop) this.input.scrollTop = top;
    else if (top + line.offsetHeight > this.input.scrollTop + this.input.clientHeight)
      this.input.scrollTop = top + line.offsetHeight - this.input.clientHeight;
    this.scroll();
  }
  jumpToPosition(position) {
    const target = Math.max(0, Math.min(this.input.value.length, position));
    this.input.setSelectionRange(target, target);
    this.focus();
    this.revealPosition(target); this.cursor();
  }
  showFind() { this.findBar.show(this.input.value.slice(this.input.selectionStart, this.input.selectionEnd)); }
  setWrap(enabled) {
    if (this.root.classList.contains("wrap") === enabled) return;
    this.input.wrap = enabled ? "soft" : "off";
    this.root.classList.toggle("wrap", enabled);
    this.draw();
  }
  destroy() { CSS.highlights.delete(this.followHighlight); this.resize.disconnect(); cancelAnimationFrame(this.drawFrame); document.fonts.removeEventListener("loadingdone", this.fontLoaded); this.completion.destroy(); }
}

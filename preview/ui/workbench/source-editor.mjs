import { element } from "../components/dom.mjs";
import { FindReplaceBar } from "./find-replace.mjs";
import { CompletionPopup } from "./completion-popup.mjs";
import { styleSourceLines } from "../../services/source-styles.mjs";
import { TextHistory } from "../../services/text-history.mjs";
import { searchRanges, findRange, replaceRanges } from "../../services/text-search.mjs";

export class SourceEditor {
  constructor({ onInput, onCursor, command, language }) {
    this.onInput = onInput;
    this.onCursor = onCursor;
    this.buffers = new Map();
    this.pending = Promise.resolve();
    this.graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    this.root = element("div", { className: "source-editor" });
    this.gutter = element("pre", { className: "line-numbers", "aria-hidden": "true" });
    this.paint = element("pre", { className: "source-paint", "aria-hidden": "true" });
    this.followHighlight = `miacode-follow-${crypto.randomUUID()}`;
    this.syntaxHighlights = new Map(["keyword", "comment", "duration"].map(kind => {
      const name = `miacode-${kind}-${crypto.randomUUID()}`, highlight = new Highlight();
      CSS.highlights.set(name, highlight);
      return [kind, { name, highlight }];
    }));
    const followStyle = element("style", {}, `.source-paint::highlight(${this.followHighlight}) { background-color: color-mix(in srgb, var(--state-follow-highlight) 25%, transparent); }\n`
      + [...this.syntaxHighlights].map(([kind, { name }]) => `.source-paint::highlight(${name}) { color: var(--syntax-${kind}); }`).join("\n"));
    this.input = element("textarea", {
      className: "source-input", "aria-label": "Simai 谱面正文", spellcheck: false,
      autocapitalize: "off", autocomplete: "off", autocorrect: "off", wrap: "off",
    });
    this.input.id = `source-${crypto.randomUUID()}`;
    this.ruler = element("div", { className: "source-overview-ruler", role: "scrollbar", tabindex: 0,
      "aria-label": "概览标尺", "aria-controls": this.input.id, "aria-orientation": "vertical", "aria-valuemin": "0" });
    this.rulerMarks = element("div", { className: "source-overview-marks", "aria-hidden": "true" });
    this.rulerThumb = element("div", { className: "source-overview-thumb", "aria-hidden": "true" });
    this.rulerCaret = element("div", { className: "source-overview-caret", "aria-hidden": "true" });
    this.ruler.append(this.rulerThumb,this.rulerMarks,this.rulerCaret);
    const rulerPosition = event => {
      const bounds=this.ruler.getBoundingClientRect();
      this.input.scrollTop=(event.clientY-bounds.top)/bounds.height*this.input.scrollHeight-this.input.clientHeight/2;
      this.scroll();
    };
    this.ruler.addEventListener("pointerdown",event=>{event.preventDefault();this.ruler.setPointerCapture(event.pointerId);rulerPosition(event);});
    this.ruler.addEventListener("pointermove",event=>{if(this.ruler.hasPointerCapture(event.pointerId))rulerPosition(event);});
    this.ruler.addEventListener("keydown",event=>{
      const delta={ArrowUp:-this.lineHeight(),ArrowDown:this.lineHeight(),PageUp:-this.input.clientHeight,PageDown:this.input.clientHeight};
      if (event.key in delta) this.input.scrollTop+=delta[event.key];
      else if(event.key==="Home")this.input.scrollTop=0;
      else if(event.key==="End")this.input.scrollTop=this.input.scrollHeight;
      else return;
      event.preventDefault();this.scroll();
    });
    this.findBar = new FindReplaceBar({ command, language, dismiss: () => { this.findBar.hide(); this.focus(); } });
    this.viewport = element("div", { className: "source-viewport" }, this.gutter, this.paint, this.input, this.ruler);
    this.root.append(followStyle, this.findBar.root, this.viewport);
    this.completion = new CompletionPopup(this.viewport, command);
    this.completionState = { completionActive: false, completionCandidates: [], completionIndex: -1 };
    this.input.addEventListener("beforeinput", event => {
      if (this.applyingTransaction) return;
      this.history?.remember(this.capture());
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        event.preventDefault(); command(event.inputType === "historyUndo" ? "edit.undo" : "edit.redo");
      } else if (this.nativePolicy && event.cancelable && !event.isComposing && ["insertText", "insertLineBreak", "deleteContentBackward", "deleteContentForward"].includes(event.inputType)) {
        event.preventDefault();
        const key = event.inputType === "insertLineBreak" ? 0x1000004 : event.inputType === "deleteContentBackward" ? 0x1000003 : event.inputType === "deleteContentForward" ? 0x1000007 : this.key?.key || 0;
        this.queueNative("edit.processKey", { input: event.data || "", key, modifiers: this.key?.modifiers || 0 }, event.inputType);
      }
    });
    this.input.addEventListener("input", event => {
      if (this.applyingTransaction) return;
      this.draw();
      this.history?.record(this.capture(), event.isComposing || event.inputType?.includes("Composition") ? "composition" : event.inputType || "");
      this.cursor(); this.onInput?.(this.input.value);
    });
    this.input.addEventListener("compositionstart", () => { this.compositionStart = this.capture(); this.history?.breakGroup(); });
    this.input.addEventListener("compositionend", event => this.finishComposition(event.data));
    this.gutter.addEventListener("contextmenu", event => {
      const line = [...this.gutter.children].indexOf(event.target.closest("div")) + 1;
      if (!line) return;
      event.preventDefault(); command("edit.bookmarkMenu", { line, trigger: event.target });
    });
    this.input.addEventListener("scroll", () => this.scroll());
    this.input.addEventListener("keydown", event => {
      const codes = { Enter: 0x1000004, Backspace: 0x1000003, Delete: 0x1000007 };
      this.key = { key: codes[event.key] || (event.key.length === 1 ? event.key.toUpperCase().charCodeAt(0) : 0),
        modifiers: (event.shiftKey ? 0x2000000 : 0) | (event.ctrlKey ? 0x4000000 : 0) | (event.altKey ? 0x8000000 : 0) | (event.metaKey ? 0x10000000 : 0) };
      if (event.key === "Enter" && event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault(); this.queueNative("edit.processKey", { input: "", ...this.key }, "insertLineBreak"); return;
      }
      if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        command(event.key.toLowerCase() === "y" || event.shiftKey ? "edit.redo" : "edit.undo");
        return;
      }
      const state = this.completionState;
      if (!state.completionActive || !state.completionCandidates.length || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        this.queueNative("edit.processKey", { input: "", key: event.key === "ArrowDown" ? 0x1000015 : 0x1000013, modifiers: 0 });
      } else if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault(); this.queueNative("edit.acceptCompletion", { index: state.completionIndex });
      } else if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); this.updateCompletion({ ...state, completionActive: false }); this.queueNative("edit.dismissCompletion");
      }
    });
    for (const event of ["click", "keyup", "select"]) this.input.addEventListener(event, () => {
      if(event==="keyup")this.key=null;
      this.cursor();
    });
    this.resize = new ResizeObserver(entries => {
      if (entries.some(entry => entry.target === this.viewport
        || this.renderedLines?.some(record => record.node === entry.target && record.height !== entry.contentRect.height))) this.draw();
    });
    this.resize.observe(this.viewport);
    this.fontLoaded = () => { this.lineGeometry = null; this.draw(); };
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
  capture() {
    const input = this.input;
    return { text: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd,
      selectionDirection: input.selectionDirection, scrollTop: input.scrollTop, scrollLeft: input.scrollLeft };
  }
  setDocument(generation, difficulty, text) {
    if (this.generation !== generation) { this.buffers.clear(); this.history = null; this.bufferKey = null; this.generation = generation; }
    if (this.bufferKey !== difficulty) {
      this.history?.remember(this.capture()); this.history?.breakGroup();
      this.bufferKey = difficulty;
      this.history = this.buffers.get(difficulty);
      if (!this.history) {
        this.restore({ text, selectionStart: 0, selectionEnd: 0, selectionDirection: "forward", scrollTop: 0, scrollLeft: 0 });
        this.history = new TextHistory(this.capture());
        this.buffers.set(difficulty, this.history);
      } else {
        if (this.history.state.text !== text) this.history.record({ ...this.history.state, text });
        this.restore(this.history.state);
      }
      this.updateCompletion({ completionActive: false, completionCandidates: [], completionIndex: -1 });
    } else if (this.input.value !== text) {
      this.history?.remember(this.capture());
      this.setValue(text); this.history?.record(this.capture());
    }
  }
  restore(state) {
    this.input.value = state.text;
    this.input.setSelectionRange(state.selectionStart, state.selectionEnd, state.selectionDirection);
    this.input.scrollTop = state.scrollTop; this.input.scrollLeft = state.scrollLeft;
    this.draw(); this.cursor();
  }
  undo() { this.restoreHistory(this.history?.undo()); }
  redo() { this.restoreHistory(this.history?.redo()); }
  restoreHistory(state) {
    if (!state) return;
    this.restore(state); this.updateCompletion({ completionActive: false, completionCandidates: [], completionIndex: -1 });
    this.onInput?.(state.text); this.focus();
  }
  queueNative(id, args = {}, inputType = "") {
    if (!this.nativePolicy) return;
    const generation = this.generation, key = this.bufferKey;
    this.pending = this.pending.then(async () => {
      if (generation !== this.generation || key !== this.bufferKey) return;
      const before = this.capture();
      const result = await this.nativePolicy(id, { ...args, text: before.text,
        anchor: before.selectionDirection === "backward" ? before.selectionEnd : before.selectionStart,
        position: before.selectionDirection === "backward" ? before.selectionStart : before.selectionEnd });
      if (generation !== this.generation || key !== this.bufferKey || before.text !== this.input.value) return;
      if (result.consumed) this.applyTransaction(result.transaction, inputType);
      else if (inputType && !result.suppressFallbackInsert) this.applyFallback(before, args.input, inputType);
      const completion = await this.nativePolicy("edit.updateCompletion", { text: this.input.value, position: this.input.selectionEnd });
      if (generation === this.generation && key === this.bufferKey) this.updateCompletion(completion);
    }).catch(error => this.onError?.(error));
    return this.pending;
  }
  finishComposition(input) {
    const before = this.compositionStart;
    this.compositionStart = null;
    if (!this.nativePolicy || !before || !input) { this.history?.breakGroup(); return; }
    const generation = this.generation, key = this.bufferKey;
    const expected = before.text.slice(0, before.selectionStart) + input + before.text.slice(before.selectionEnd);
    this.pending = this.pending.then(async () => {
      if (generation !== this.generation || key !== this.bufferKey || this.input.value !== expected) return;
      const result = await this.nativePolicy("edit.processKey", { text: before.text, anchor: before.selectionStart, position: before.selectionEnd, input, key: 0, modifiers: 0 });
      if (generation !== this.generation || key !== this.bufferKey || this.input.value !== expected) return;
      if (result.consumed && result.transaction.hasEdit && result.transaction.replacementText !== input)
        this.applyTransaction({ ...result.transaction, replacementEnd: before.selectionStart + input.length }, "composition");
      this.updateCompletion(result); this.history?.breakGroup();
    }).catch(error => this.onError?.(error));
  }
  applyFallback(before, input, inputType) {
    let start = before.selectionStart, end = before.selectionEnd;
    const parts = this.graphemes.segment(before.text);
    if (start === end && inputType === "deleteContentBackward") start = parts.containing(start - 1)?.index ?? 0;
    if (start === end && inputType === "deleteContentForward") {
      const part = parts.containing(end); end = part ? part.index + part.segment.length : end;
    }
    if (start === end && inputType === "insertText" && this.overwriteEnabled?.()) {
      for (const glyph of this.graphemes.segment(input)) {
        const part = parts.containing(end);
        if (!part || part.segment === "\n") break;
        end = part.index + part.segment.length;
      }
    }
    const text = inputType.startsWith("delete") ? "" : inputType === "insertLineBreak" ? "\n" : input;
    this.applyTransaction({ hasEdit: true, replacementStart: start, replacementEnd: end, replacementText: text, anchor: start + text.length, position: start + text.length }, inputType);
  }
  requestDraw() {
    if (this.drawFrame) return;
    this.drawFrame = requestAnimationFrame(() => { this.drawFrame = 0; this.draw(); });
  }
  draw() {
    const viewportStyle = getComputedStyle(this.viewport);
    const width = parseFloat(viewportStyle.width), height = parseFloat(viewportStyle.height);
    if (!width || !height) return;
    this.root.style.setProperty("--source-tail-height",`${this.preferences?.editorScrollPastEnd===false?0:Math.max(0,height-this.lineHeight())}px`);
    const lines = this.input.value.split("\n");
    this.root.style.setProperty("--gutter-width", `calc(${String(lines.length).length}ch + 18px)`);
    const gutterWidth = parseFloat(getComputedStyle(this.gutter).width);
    const overviewWidth = this.ruler.hidden ? 0 : parseFloat(getComputedStyle(this.ruler).width);
    // A shared pixel width keeps textarea and syntax wrapping on the same boundary.
    this.input.style.width = `${Math.max(0, Math.floor(width - gutterWidth - overviewWidth))}px`;
    this.input.style.height = `${height}px`;
    const scrollbarWidth = this.input.offsetWidth - this.input.clientWidth;
    this.paint.style.width = `calc(${this.input.style.width} - ${scrollbarWidth}px)`;
    this.paint.style.height = `${this.input.clientHeight}px`;
    const styles = styleSourceLines(this.input.value);
    const previous = this.renderedLines || [];
    this.visibleSyntax ||= new Set();
    const same = (record, spans) => record.spans.length === spans.length
      && record.spans.every((span, index) => span.kind === spans[index].kind && span.text === spans[index].text);
    let start = 0, oldEnd = previous.length, nextEnd = styles.length;
    while (start < oldEnd && start < nextEnd && same(previous[start], styles[start])) ++start;
    while (oldEnd > start && nextEnd > start && same(previous[oldEnd - 1], styles[nextEnd - 1])) { --oldEnd; --nextEnd; }
    for (let index = start; index < oldEnd; ++index) {
      const record = previous[index];
      for (const [kind, range] of record.ranges) this.syntaxHighlights.get(kind).highlight.delete(range);
      this.visibleSyntax.delete(record);
      this.resize.unobserve(record.node);
      record.node.remove(); record.gutter.remove();
    }
    const added = [], paint = document.createDocumentFragment(), gutter = document.createDocumentFragment();
    for (let index = start; index < nextEnd; ++index) {
      const spans = styles[index], ranges = [];
      const line = element("div", { className: "source-code-line" });
      const text = document.createTextNode(spans.map(span => span.text).join("") || "\u200b");
      line.append(text);
      const number = element("div", {}, String(index + 1));
      added.push({ node: line, gutter: number, spans, ranges, visible: true });
      paint.append(line); gutter.append(number);
    }
    this.paint.insertBefore(paint, previous[oldEnd]?.node || null);
    this.gutter.insertBefore(gutter, previous[oldEnd]?.gutter || null);
    this.renderedLines = [...previous.slice(0, start), ...added, ...previous.slice(oldEnd)];
    this.updateCurrentLine();
    const inputStyle = getComputedStyle(this.input);
    const geometry = `${this.paint.style.width}:${inputStyle.font}:${inputStyle.lineHeight}:${this.input.wrap}`;
    const resized = geometry !== this.lineGeometry;
    this.lineGeometry = geometry;
    if (resized) for (const record of this.renderedLines) {
      record.node.hidden = record.gutter.hidden = false; record.visible = true;
    }
    // Measure changed lines together; stable lines retain their wrap geometry.
    const heights = this.renderedLines.map(record => resized || record.visible || record.height === undefined
      ? record.node.offsetHeight : record.height);
    let top = 0;
    this.renderedLines.forEach((record, index) => {
      const number = String(index + 1);
      if (record.gutter.textContent !== number) record.gutter.textContent = number;
      if (record.height !== heights[index]) record.gutter.style.height = `${heights[index]}px`;
      record.height = heights[index];
      record.top = top; top += record.height;
    });
    this.contentHeight = top;
    this.paint.style.setProperty("--source-content-width", `${Math.max(0, this.input.scrollWidth
      - parseFloat(inputStyle.paddingLeft) - parseFloat(inputStyle.paddingRight))}px`);
    this.drawOverviewMarks();
    this.scroll();
    if (this.followState) this.setFollowState(this.followState, true);
  }
  scroll() {
    this.updateRenderedWindow();
    this.gutter.style.transform = `translateY(${-this.input.scrollTop}px)`;
    this.paint.scrollTop = this.input.scrollTop;
    this.paint.scrollLeft = this.input.scrollLeft;
    this.updateSyntaxHighlights();
    this.updateCompletion(this.completionState);
    this.updateOverview();
  }
  updateRenderedWindow() {
    const records = this.renderedLines || [], height = this.input.clientHeight, top = this.input.scrollTop;
    const lowerBound = offset => {
      let low = 0, high = records.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (records[middle].top < offset) low = middle + 1; else high = middle;
      }
      return low;
    };
    const start = Math.max(0, lowerBound(top - height) - 1);
    const end = Math.min(records.length, lowerBound(top + height * 2) + 1);
    const visibleRows = new Set(records.slice(start, end));
    for (const record of this.visibleRows || []) if (!visibleRows.has(record)) this.resize.unobserve(record.node);
    for (const record of visibleRows) if (!this.visibleRows?.has(record)) this.resize.observe(record.node);
    this.visibleRows = visibleRows;
    records.forEach((record, index) => {
      const visible = index >= start && index < end;
      if (visible !== record.visible) { record.node.hidden = record.gutter.hidden = !visible; record.visible = visible; }
    });
    for (const surface of [this.paint, this.gutter]) {
      surface.style.setProperty("--source-offset-start", `${records[start]?.top || 0}px`);
      surface.style.setProperty("--source-offset-end", `${(this.contentHeight || 0) - (records[end]?.top ?? this.contentHeight ?? 0)}px`);
    }
  }
  updateSyntaxHighlights() {
    const visible = this.visibleRows || new Set();
    for (const record of this.visibleSyntax || []) if (!visible.has(record)) {
      for (const [kind, range] of record.ranges) this.syntaxHighlights.get(kind).highlight.delete(range);
      record.ranges = [];
    }
    for (const record of visible) if (!this.visibleSyntax?.has(record)) {
      let offset = 0;
      for (const span of record.spans) {
        if (span.kind) {
          const range = document.createRange();
          range.setStart(record.node.firstChild, offset); range.setEnd(record.node.firstChild, offset + span.text.length);
          this.syntaxHighlights.get(span.kind).highlight.add(range); record.ranges.push([span.kind, range]);
        }
        offset += span.text.length;
      }
    }
    this.visibleSyntax = visible;
  }
  cursor() {
    const prefix = this.input.value.slice(0, this.input.selectionStart);
    const lines = prefix.split("\n");
    this.updateCurrentLine(lines.length - 1);
    this.updateOverview(lines.length-1);
    this.onCursor?.({ line: lines.length, column: lines.at(-1).length + 1 });
    this.onSelection?.();
    this.updateCompletion(this.completionState);
  }
  updateCurrentLine(index = this.input.value.slice(0, this.input.selectionStart).split("\n").length - 1) {
    const current = this.input.selectionStart === this.input.selectionEnd ? this.paint.children[index] : null;
    if (current === this.currentLine) return;
    this.currentLine?.classList.remove("current-line");
    this.currentLine = current;
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
    const line = this.renderedLines?.[index];
    if (!line) return;
    const top = line.top;
    if (top < this.input.scrollTop) this.input.scrollTop = top;
    else if (top + line.height > this.input.scrollTop + this.input.clientHeight)
      this.input.scrollTop = top + line.height - this.input.clientHeight;
    this.scroll();
  }
  jumpToPosition(position) {
    const target = Math.max(0, Math.min(this.input.value.length, position));
    this.input.setSelectionRange(target, target);
    this.focus();
    this.revealPosition(target); this.cursor();
  }
  showFind() { this.findBar.show(this.input.value.slice(this.input.selectionStart, this.input.selectionEnd)); }
  search(id, options) {
    const input = this.input;
    const focused = document.activeElement;
    let ranges = searchRanges(input.value, options);
    if (id === "edit.replaceAll") {
      if (!ranges.length) return 0;
      const replaced = replaceRanges(input.value, ranges, options.replacement, {
        anchor: input.selectionDirection === "backward" ? input.selectionEnd : input.selectionStart,
        position: input.selectionDirection === "backward" ? input.selectionStart : input.selectionEnd });
      this.applyTransaction({ hasEdit: true, replacementStart: 0, replacementEnd: input.value.length, replacementText: replaced.text,
        anchor: replaced.anchor, position: replaced.position });
      focused?.focus({ preventScroll: true });
      return ranges.length;
    }
    if (id === "edit.replaceAndFind" && ranges.some(range => range.start === input.selectionStart && range.end === input.selectionEnd)) {
      const start = input.selectionStart;
      this.applyTransaction({ hasEdit: true, replacementStart: start, replacementEnd: input.selectionEnd, replacementText: options.replacement,
        anchor: start, position: start + options.replacement.length });
      focused?.focus({ preventScroll: true });
      ranges = searchRanges(input.value, options);
    }
    const found = findRange(ranges, input.selectionStart, input.selectionEnd, id === "edit.findPrevious");
    if (!found) return false;
    this.history?.breakGroup();
    input.setSelectionRange(found.start, found.end);
    this.revealPosition(found.start); this.cursor();
    return true;
  }
  applyTransaction(transaction, inputType = "") {
    this.history?.remember(this.capture());
    if (!inputType) this.history?.breakGroup();
    if (transaction.hasEdit) {
      if (this.input.checkVisibility()) {
        this.input.focus({ preventScroll: true });
        this.input.setSelectionRange(transaction.replacementStart, transaction.replacementEnd);
        this.applyingTransaction = true;
        try {
          if (!document.execCommand("insertText", false, transaction.replacementText))
            throw new Error("浏览器文本编辑命令执行失败");
        } finally { this.applyingTransaction = false; }
      } else {
        // Compact preview keeps the source hidden while touch input edits it.
        this.input.setRangeText(transaction.replacementText, transaction.replacementStart, transaction.replacementEnd);
      }
    }
    this.input.setSelectionRange(Math.min(transaction.anchor, transaction.position), Math.max(transaction.anchor, transaction.position), transaction.anchor > transaction.position ? "backward" : "forward");
    if (transaction.hasEdit) this.input.dispatchEvent(new InputEvent("input", { inputType: inputType === "composition" ? "insertCompositionText" : inputType }));
    else { this.draw(); this.cursor(); }
    this.focus();
  }
  setWrap(enabled) {
    if (this.root.classList.contains("wrap") === enabled) return;
    this.input.wrap = enabled ? "soft" : "off";
    this.root.classList.toggle("wrap", enabled);
    this.draw();
  }
  lineHeight() { return parseFloat(getComputedStyle(this.input).lineHeight) || 22; }
  setPreferences(preferences) {
    const changed=this.preferences?.editorScrollPastEnd!==preferences.editorScrollPastEnd
      || this.preferences?.editorOverviewRulerEnabled!==preferences.editorOverviewRulerEnabled
      || this.preferences?.editorFontSize!==preferences.editorFontSize || this.preferences?.editorLineSpacing!==preferences.editorLineSpacing;
    this.preferences={editorScrollPastEnd:preferences.editorScrollPastEnd,editorOverviewRulerEnabled:preferences.editorOverviewRulerEnabled,
      editorFontSize:preferences.editorFontSize,editorLineSpacing:preferences.editorLineSpacing};
    const overview=preferences.editorOverviewRulerEnabled!==false;
    this.root.classList.toggle("overview-enabled",overview);this.ruler.hidden=!overview;
    this.input.inputMode=(preferences.editorInputHandlingMode ?? 1)===1?"url":"text";
    if(changed)this.requestDraw();
  }
  setAnnotations(snapshot) {
    const chart=snapshot.charts?.find(item=>item.id===snapshot.activeDifficultyId);
    this.annotations=[...(chart?.bookmarks || []).map(item=>({...item,kind:"bookmark"})),
      ...(snapshot.validationRows || []).filter(item=>item.revision==null || item.revision===snapshot.revision).map(item=>({...item,kind:item.severity}))];
    this.drawOverviewMarks();
  }
  drawOverviewMarks() {
    if (!this.annotations?.length) { if (this.rulerMarks.firstChild) this.rulerMarks.replaceChildren(); return; }
    if(!this.input.clientHeight)return;
    this.rulerMarks.replaceChildren(...(this.annotations || []).map(item=>{
      const line=this.renderedLines?.[item.line-1];
      return line?element("i",{className:`overview-${item.kind}`,style:`top:${line.top/this.input.scrollHeight*100}%`}):null;
    }).filter(Boolean));
  }
  updateOverview(line) {
    const height=this.input.scrollHeight;if(!height)return;
    this.rulerThumb.style.top=`${this.input.scrollTop/height*100}%`;
    this.rulerThumb.style.height=`${Math.min(100,this.input.clientHeight/height*100)}%`;
    this.ruler.setAttribute("aria-valuemax",String(Math.max(0,height-this.input.clientHeight)));
    this.ruler.setAttribute("aria-valuenow",String(this.input.scrollTop));
    if(line!=null)this.overviewLine=line;
    const current=this.renderedLines?.[this.overviewLine ?? 0];
    this.rulerCaret.style.top=`${(current?.top || 0)/height*100}%`;
  }
  destroy() { CSS.highlights.delete(this.followHighlight); for (const { name, highlight } of this.syntaxHighlights.values()) { CSS.highlights.delete(name); highlight.clear(); } this.visibleSyntax?.clear(); this.renderedLines = []; this.resize.disconnect(); cancelAnimationFrame(this.drawFrame); document.fonts.removeEventListener("loadingdone", this.fontLoaded); this.completion.destroy(); }
}

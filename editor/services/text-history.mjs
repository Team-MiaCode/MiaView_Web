function changeBetween(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = before.length, nextEnd = after.length;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  return { start, removed: before.slice(start, end), inserted: after.slice(start, nextEnd) };
}

export class TextHistory {
  constructor(state) {
    this.state = { ...state };
    this.undoEntries = [];
    this.redoEntries = [];
  }
  remember(state) { this.state = { ...state }; }
  record(state, group = "", time = performance.now()) {
    const before = this.state;
    this.state = { ...state };
    if (before.text === state.text) return;
    const change = changeBetween(before.text, state.text);
    const previous = this.undoEntries.at(-1);
    const joins = group && previous?.group === group && (group === "composition" || (time - previous.time < 750
      && previous.after.selectionStart === before.selectionStart && previous.after.selectionEnd === before.selectionEnd));
    if (joins) { previous.changes.push(change); previous.after = { ...state }; previous.time = time; }
    else this.undoEntries.push({ changes: [change], before: { ...before }, after: { ...state }, group, time });
    // Text lives in the active buffer; history stores replacement spans and cursor state.
    const entry = this.undoEntries.at(-1);
    delete entry.before.text; delete entry.after.text;
    this.redoEntries.length = 0;
  }
  breakGroup() { const last = this.undoEntries.at(-1); if (last) last.group = ""; }
  undo() {
    const entry = this.undoEntries.pop();
    if (!entry) return null;
    let text = this.state.text;
    for (const change of [...entry.changes].reverse()) text = text.slice(0, change.start) + change.removed + text.slice(change.start + change.inserted.length);
    this.redoEntries.push(entry);
    this.state = { text, ...entry.before };
    this.breakGroup();
    return this.state;
  }
  redo() {
    const entry = this.redoEntries.pop();
    if (!entry) return null;
    let text = this.state.text;
    for (const change of entry.changes) text = text.slice(0, change.start) + change.inserted + text.slice(change.start + change.removed.length);
    this.undoEntries.push(entry);
    this.state = { text, ...entry.after };
    this.breakGroup();
    return this.state;
  }
}

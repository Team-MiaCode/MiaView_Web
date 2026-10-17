import assert from "node:assert/strict";
import { test } from "node:test";
import { TextHistory } from "../services/text-history.mjs";

const state = (text, selectionStart = text.length, selectionEnd = selectionStart) => ({ text, selectionStart, selectionEnd, selectionDirection: "forward", scrollTop: 0, scrollLeft: 0 });
test("typing groups retain text, caret and redo across distinct edits", () => {
  const history = new TextHistory(state(""));
  history.record(state("1"), "insertText", 0);
  history.record(state("12"), "insertText", 10);
  history.record(state("123"), "insertText", 20);
  assert.equal(history.undoEntries.length, 1);
  history.breakGroup();
  history.record(state("123b"), "", 30);
  assert.deepEqual(history.undo(), state("123"));
  assert.deepEqual(history.undo(), state(""));
  assert.deepEqual(history.redo(), state("123"));
  assert.deepEqual(history.redo(), state("123b"));
});
test("replacement preserves reversed selection and scrolling, new input drops redo", () => {
  const before = { ...state("中文1,2,E", 2, 5), selectionDirection: "backward", scrollTop: 60, scrollLeft: 20 };
  const history = new TextHistory(before);
  history.record(state("中文8,7,E", 2, 5));
  assert.deepEqual(history.undo(), before);
  history.record(state("中文3,E"));
  assert.equal(history.redo(), null);
  assert.deepEqual(history.undo(), before);
});
test("cursor movement and time gaps separate typing groups", () => {
  const history = new TextHistory(state(""));
  history.record(state("1"), "insertText", 0);
  history.remember(state("1", 0));
  history.record(state("21", 1), "insertText", 10);
  history.record(state("231", 2), "insertText", 1000);
  assert.equal(history.undoEntries.length, 3);
  assert.equal(history.undo().text, "21");
  assert.equal(history.undo().text, "1");
});
test("one composition groups updates across typing pauses", () => {
  const history = new TextHistory(state("|| "));
  history.record(state("|| 主"), "composition", 0);
  history.record(state("|| 主歌"), "composition", 2000);
  assert.equal(history.undoEntries.length, 1);
  history.breakGroup();
  history.record(state("|| 主歌，"), "composition", 2500);
  history.record(state("|| 主歌,"), "composition", 2510);
  assert.equal(history.undo().text, "|| 主歌");
  assert.equal(history.undo().text, "|| ");
});

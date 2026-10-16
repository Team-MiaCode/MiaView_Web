import assert from "node:assert/strict";
import { test } from "node:test";
import { searchRanges, findRange, replaceRanges } from "../services/text-search.mjs";

test("literal search supports case, whole words, Unicode and regex punctuation", () => {
  assert.deepEqual(searchRanges("tap TAP tapper tap", { query: "tap", wholeWord: true }), [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 15, end: 18 }]);
  assert.deepEqual(searchRanges("tap TAP", { query: "tap", caseSensitive: true }), [{ start: 0, end: 3 }]);
  assert.deepEqual(searchRanges("中文词 中文", { query: "中文", wholeWord: true }), [{ start: 4, end: 6 }]);
  assert.deepEqual(searchRanges("1h[4:1],2h[4:1]", { query: "[4:1]" }), [{ start: 2, end: 7 }, { start: 10, end: 15 }]);
  assert.deepEqual(searchRanges("1,E", { query: "" }), []);
});
test("next and previous searches wrap at document boundaries", () => {
  const ranges = searchRanges("1,1,1", { query: "1" });
  assert.deepEqual(findRange(ranges, 0, 1), { start: 2, end: 3 });
  assert.deepEqual(findRange(ranges, 4, 5), { start: 0, end: 1 });
  assert.deepEqual(findRange(ranges, 0, 1, true), { start: 4, end: 5 });
  assert.deepEqual(findRange(ranges, 4, 5, true), { start: 2, end: 3 });
});
test("replace all treats dollar references literally and maps reversed selections", () => {
  const text = "中文 tap TAP";
  const ranges = searchRanges(text, { query: "tap" });
  assert.deepEqual(replaceRanges(text, ranges, "$&", { anchor: 10, position: 3 }), { text: "中文 $& $&", anchor: 8, position: 3 });
});

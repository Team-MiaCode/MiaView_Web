import test from "node:test";
import assert from "node:assert/strict";
import { styleSourceLines } from "../services/source-styles.mjs";

test("Simai styles preserve body text and distinguish timing, duration and ordinary notes", () => {
  const styled = styleSourceLines("(120){4}1h[4:1],E");
  assert.deepEqual(styled, [[{ kind: "keyword", text: "(120){4}" }, { kind: null, text: "1h" }, { kind: "duration", text: "[4:1]" }, { kind: null, text: ",E" }]]);
});

test("Incomplete timing stacks continue across lines and comments keep their own style", () => {
  assert.deepEqual(styleSourceLines("(120\n|| 主歌\n){4}E"), [
    [{ kind: "keyword", text: "(120" }], [{ kind: "comment", text: "|| 主歌" }],
    [{ kind: "keyword", text: "){4}" }, { kind: null, text: "E" }],
  ]);
});

test("HS directives and Unicode comments retain UTF-16 source content", () => {
  const source = "<HS*2>1,|| 段落\u{1f600}\n&custom=value";
  const styled = styleSourceLines(source);
  assert.deepEqual(styled[0], [{ kind: "keyword", text: "<HS*2>" }, { kind: null, text: "1," }, { kind: "comment", text: "|| 段落\u{1f600}" }]);
  assert.equal(styled.map(line => line.map(span => span.text).join("")).join("\n"), source);
  assert.deepEqual(styled[1], [{ kind: null, text: "&custom=value" }]);
});

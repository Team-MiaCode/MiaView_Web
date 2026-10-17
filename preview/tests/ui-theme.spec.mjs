import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readUiTheme } from "../scripts/sync-ui.mjs";
import { createHash } from "node:crypto";

test("Workbench themes and original SVG assets follow the pinned v2 source", () => {
  const source = "vendor/MiaCode/src/app/ui";
  const qml = readFileSync(`${source}/theme/Theme.qml`, "utf8");
  const data = readUiTheme(qml);
  assert.deepEqual(data, JSON.parse(readFileSync("ui/components/theme.json", "utf8")));
  assert.deepEqual(Object.keys(data.themes), ["dark", "light", "legacy", "legacy_light"]);
  assert.equal(data.uiFontSize, 13);
  for (const palette of Object.values(data.themes)) {
    for (const key of ["background-surface", "background-panel", "accent-primary", "text-editor", "text-primary", "syntax-keyword", "activity-icon-active", "button-state-hover", "popup-state-selected"]) assert.ok(palette[key], key);
  }
  for (const name of readdirSync(`${source}/resources/icons`).filter(name => name.endsWith(".svg"))) {
    assert.deepEqual(readFileSync(`ui/components/icons/${name}`), readFileSync(`${source}/resources/icons/${name}`), name);
  }
  assert.throws(() => readUiTheme(qml.replace("darkColors:", "deletedColors:")), /Missing theme palette: dark/);
});

test("Original editor font resources retain their pinned source and verified byte inventory", () => {
  const font = JSON.parse(readFileSync("ui/components/fonts/font.json", "utf8"));
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  assert.equal(font.sourceSha256, digest(readFileSync("vendor/MiaCode/assets/fonts/MapleMonoNormalNL-CN-Regular.ttf")));
  assert.equal(font.family, "Maple Mono Normal NL CN");
  assert.equal(font.characters, 22731);
  assert.deepEqual(font.files.map(file => file.unicodeRange), ["U+0-6FFF", "U+7000-10FFFF"]);
  for (const file of font.files) {
    const bytes = readFileSync(`ui/components/fonts/${file.path}`);
    assert.equal(bytes.length, file.byteSize);
    assert.equal(digest(bytes), file.sha256);
    assert.ok(bytes.length <= 5 * 1024 * 1024);
  }
  for (const file of font.cardFonts) {
    assert.equal(file.sourceSha256, digest(readFileSync(file.source)));
    const bytes = readFileSync(`ui/components/fonts/${file.path}`);
    assert.equal(bytes.length, file.byteSize);
    assert.equal(digest(bytes), file.sha256);
    assert.ok(bytes.length <= 5 * 1024 * 1024);
  }
});

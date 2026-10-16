import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, normalizeSkinFiles } from "../renderer/protocol.mjs";
import { skinFolder } from "../services/user-appearance.mjs";

test("Skin folders preserve v2 image paths and select one complete directory", () => {
  const file = path => ({ name: path.split("/").at(-1), webkitRelativePath: path });
  const tap = file("Green/tap.png"), judge = file("Green/JudgeTextSkins/critical_perfect.png");
  const result = skinFolder([tap, judge, file("Green/README.md"), file("Elsewhere/noise.png")]);
  assert.equal(result.name, "Green");
  assert.deepEqual(result.files, [{ path: "tap.png", file: tap }, { path: "JudgeTextSkins/critical_perfect.png", file: judge }]);
  assert.throws(() => skinFolder([tap, file("Other/tap.png")]), /单个皮肤目录/);
  assert.throws(() => skinFolder([judge]), /tap.png/);
});

test("Skin image transport keeps deterministic paths and rejects ambiguous or escaping names", () => {
  const image = new Blob(["image"]);
  const files = normalizeSkinFiles([{ path: "tap.png", image }, { path: "hold.png", image }]);
  assert.deepEqual(files.map(file => file.path), ["hold.png", "tap.png"]);
  for (const path of ["../tap.png", "/tap.png", "nested/../tap.png", "nested\\tap.png", "tap\0hidden.png", "tap.jpg"])
    assert.throws(() => normalizeSkinFiles([{ path: "tap.png", image }, { path, image }]), /路径/);
  assert.throws(() => normalizeSkinFiles([{ path: "tap.png", image }, { path: "TAP.png", image }]), /路径/);
});

test("Appearance settings address imported native assets through their stable identifiers", () => {
  const skin = `skin-${"a".repeat(64)}`, outline = `outline-${"b".repeat(64)}.png`;
  assert.deepEqual(normalizeSettings({ skinDirectoryName: skin, customOutlineFileName: outline }), { skinDirectoryName: skin, customOutlineFileName: outline });
  for (const skinDirectoryName of ["../skinDX", "/assets/skin/skinDX", "unknown", null]) assert.throws(() => normalizeSettings({ skinDirectoryName }));
  for (const customOutlineFileName of ["../outline.png", "outline.jpg", "folder/line.png", null]) assert.throws(() => normalizeSettings({ customOutlineFileName }));
});

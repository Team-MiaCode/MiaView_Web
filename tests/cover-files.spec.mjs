import assert from "node:assert/strict";
import test from "node:test";
import { coverAssetPaths, coverValuesFromComposition, coverResolution, remapCoverAssets, portableCoverLayout, coverFileName } from "../services/cover-files.mjs";

function layout() {
  return { kind: "miacode-cover-composition", version: 3, size: { w: 432, h: 288 },
    background: { mode: "custom", customPath: "/picture", blur: true, brightness: .45 },
    card: { mode: "DX", shadow: true, levelTextRender: true, longText: "ellipsis", fontDisplay: "/font", fontBody: "/font" },
    layout: { layers: [{ key: "image", kind: "image", imagePath: "/picture" }, { key: "text", kind: "text", fontPath: "/font", text: "/picture" }] } };
}

test("Portable cover files preserve asset bytes once per referenced path", async () => {
  const picture = new File([Uint8Array.of(0, 127, 255)], "image.png", { type: "image/png" });
  const font = new File([new Uint8Array(70000).fill(254)], "font.ttf");
  const original = layout();
  const result = await portableCoverLayout(original, new Map([["/picture", picture], ["/font", font], ["/unused", picture]]));
  assert.deepEqual(Object.keys(result.assets), ["/picture", "/font"]);
  assert.equal(result.kind, original.kind); assert.equal(result.version, 3);
  assert.deepEqual(Uint8Array.from(atob(result.assets["/picture"].data), value => value.charCodeAt(0)), new Uint8Array(await picture.arrayBuffer()));
  assert.equal(atob(result.assets["/font"].data).length, 70000);
  await assert.rejects(portableCoverLayout(original, new Map()), /导入布局素材/);
  assert.equal(original.assets, undefined);
});

test("Asset remapping changes resource paths while retaining layer keys and text", () => {
  const original = layout();
  const result = remapCoverAssets(original, new Map([["/picture", "/web-cover/hash"], ["/font", "/web-fonts/hash.ttf"]]));
  assert.deepEqual(coverAssetPaths(result), ["/web-cover/hash", "/web-fonts/hash.ttf"]);
  assert.equal(result.layout.layers[1].text, "/picture");
  assert.equal(result.layout.layers[0].key, "image");
  assert.equal(original.background.customPath, "/picture");
});

test("Imported dimensions and cover fields retain their native values", () => {
  const values = coverValuesFromComposition(layout());
  assert.equal(values.resolutionIndex, -1); assert.deepEqual(coverResolution(values), [432, 288]);
  assert.equal(values.backgroundMode, 1); assert.equal(values.cardShadow, true);
  assert.equal(values.cardFontDisplayPath, "/font"); assert.equal(values.longTextMode, "ellipsis");
  assert.deepEqual(coverResolution({ ...values, resolutionIndex: 0 }), [720, 720]);
  assert.equal(coverFileName("folder/card.PNG"), "card.PNG");
  assert.equal(coverFileName("test"), "test.jpg");
});

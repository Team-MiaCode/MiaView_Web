import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
for (const [inventoryPath, filesRoot] of [
  ["renderer/artifact-manifest.json", "renderer/"],
  ["native/upstream-manifest.json", "native/upstream/"],
]) {
  const manifest = JSON.parse(readFileSync(new URL(inventoryPath, root)));
  for (const file of manifest.files) {
    assert.ok(!file.path.includes("..") && !file.path.startsWith("/"));
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL(filesRoot + file.path, root)))
        .digest("hex"),
      file.sha256,
      file.path,
    );
  }
}
const player = readFileSync(new URL("renderer/player.mjs", root), "utf8");
assert.ok(player.includes("attachSdkBridge"));
assert.ok(
  !player.includes("manifest.player") &&
    !player.includes("/api/v1") &&
    !player.includes("trustedHostMessage"),
);
assert.ok(
  readFileSync(new URL("renderer/miacode-preview.wasm", root)).byteLength >
    1000000,
);
console.log(
  "Renderer hashes, source inventory and independent bridge verified",
);

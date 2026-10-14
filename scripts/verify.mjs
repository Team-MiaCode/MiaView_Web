import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rendererVersion, nativeInputsFingerprint } from "./build-identity.mjs";
import { sourcePin } from "./source-pin.mjs";
const root = new URL("../", import.meta.url);
assert.ok(existsSync(new URL("renderer/artifact-manifest.json", root)),
  "Renderer not built. Run npm run build:native or obtain the CI artifact for this commit.");
{
  const manifest = JSON.parse(readFileSync(new URL("renderer/artifact-manifest.json", root)));
  const paths = new Set();
  for (const file of manifest.files) {
    assert.ok(!file.path.includes("..") && !file.path.startsWith("/") && !file.path.includes("\\"));
    assert.ok(!paths.has(file.path), `Duplicate artifact: ${file.path}`);
    paths.add(file.path);
    const bytes = readFileSync(new URL("renderer/" + file.path, root));
    assert.equal(bytes.byteLength, file.byteSize, file.path);
    assert.equal(
      createHash("sha256")
        .update(bytes)
        .digest("hex"),
      file.sha256,
      file.path,
    );
  }
  for (const path of ["build-identity.json", "miacode-preview.js", "miacode-preview.wasm", "qtloader.js", "theme.css", "player.css", "player.mjs", "player-engine.mjs", "player-controller.mjs", "player-controls.mjs", "index.html", "LICENSE", "LICENSE_SCOPE.md", "THIRD_PARTY_NOTICES.md", "miacode-preview.js.br", "miacode-preview.js.gz", "miacode-preview.wasm.br", "miacode-preview.wasm.gz"])
    assert.ok(paths.has(path), `Missing artifact: ${path}`);
  for (const name of ["miacode-preview.js", "miacode-preview.wasm"]) {
    const bytes = readFileSync(new URL(`renderer/${name}`, root));
    assert.deepEqual(brotliDecompressSync(readFileSync(new URL(`renderer/${name}.br`, root))), bytes);
    assert.deepEqual(gunzipSync(readFileSync(new URL(`renderer/${name}.gz`, root))), bytes);
  }
}
const identity = JSON.parse(readFileSync(new URL("renderer/build-identity.json", root)));
assert.equal(identity.upstream, "MiaCodeWebGL");
assert.equal(identity.protocolVersion, 1);
assert.equal(identity.upstreamDirty, false, "Shipped artifacts must come from committed upstream source");
assert.match(identity.upstreamGitCommit, /^[a-f0-9]{40}$/);
assert.match(identity.sourceRevision, /^[a-f0-9]{64}$/);
assert.match(identity.nativeInputsFingerprint, /^[a-f0-9]{64}$/);
if (process.argv.includes("--source")) {
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(sourcePin(fileURLToPath(root)).upstreamGitCommit, identity.upstreamGitCommit);
  assert.equal(git("-C", "vendor/MiaCode", "rev-parse", "HEAD"), identity.upstreamGitCommit);
  const tree = git("-C", "vendor/MiaCode", "rev-parse", "HEAD^{tree}");
  assert.equal(tree, identity.upstreamTree);
  assert.equal(createHash("sha256").update(tree).digest("hex"), identity.sourceRevision);
  assert.equal(git("-C", "vendor/MiaCode", "status", "--porcelain", "--untracked-files=no"), "");
  const toolchain = JSON.parse(readFileSync(new URL("native/toolchain.json", root)));
  for (const [key, value] of Object.entries(toolchain)) assert.equal(identity[key], value);
  assert.equal(identity.nativeInputsFingerprint, nativeInputsFingerprint(identity.sourceRevision, toolchain,
    fileURLToPath(new URL("native/", root))), "Native inputs changed; rebuild JS/WASM");
  assert.equal(identity.version, rendererVersion(identity.sourceRevision, toolchain,
    fileURLToPath(new URL("native/", root)), fileURLToPath(new URL("renderer/", root))),
    "Adapter or renderer changed; rebuild the versioned artifacts");
}
const player = readFileSync(new URL("renderer/player.mjs", root), "utf8");
assert.ok(player.includes("attachSdkBridge"));
assert.ok(player.includes("createPlayerController"));
for (const name of readdirSync(new URL("renderer/", root)).filter(name => name.endsWith(".mjs"))) {
  const source = readFileSync(new URL(`renderer/${name}`, root), "utf8");
  assert.ok(!source.includes("../dev/") && !source.includes("__dev-charts"), name);
}
assert.ok(
  !player.includes("manifest.player") &&
    !player.includes("/api/v1") &&
    !player.includes("trustedHostMessage"),
);
assert.ok(
  readFileSync(new URL("renderer/miacode-preview.wasm", root)).byteLength >
    1000000,
);
console.log("Renderer hashes and independent bridge verified" +
  (process.argv.includes("--source") ? "; source matches the pinned submodule" : ""));

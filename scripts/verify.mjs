import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rendererVersion } from "./build-identity.mjs";
const root = new URL("../", import.meta.url);
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
  for (const path of ["build-identity.json", "miacode-preview.js", "miacode-preview.wasm", "qtloader.js", "theme.css", "player.css", "player.mjs", "index.html"])
    assert.ok(paths.has(path), `Missing artifact: ${path}`);
}
const identity = JSON.parse(readFileSync(new URL("renderer/build-identity.json", root)));
assert.equal(identity.upstream, "MiaCodeWebGL");
assert.equal(identity.protocolVersion, 1);
assert.equal(identity.upstreamDirty, false, "Shipped artifacts must come from committed upstream source");
assert.match(identity.upstreamGitCommit, /^[a-f0-9]{40}$/);
assert.match(identity.sourceRevision, /^[a-f0-9]{64}$/);
if (process.argv.includes("--source")) {
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(git("ls-files", "--stage", "vendor/MiaCode").split(" ")[1], identity.upstreamGitCommit);
  assert.equal(git("-C", "vendor/MiaCode", "rev-parse", "HEAD"), identity.upstreamGitCommit);
  const tree = git("-C", "vendor/MiaCode", "rev-parse", "HEAD^{tree}");
  assert.equal(tree, identity.upstreamTree);
  assert.equal(createHash("sha256").update(tree).digest("hex"), identity.sourceRevision);
  assert.equal(git("-C", "vendor/MiaCode", "status", "--porcelain", "--untracked-files=no"), "");
  const toolchain = JSON.parse(readFileSync(new URL("native/toolchain.json", root)));
  for (const [key, value] of Object.entries(toolchain)) assert.equal(identity[key], value);
  assert.equal(identity.version, rendererVersion(identity.sourceRevision, toolchain,
    fileURLToPath(new URL("native/", root)), fileURLToPath(new URL("renderer/", root))),
    "Adapter or renderer changed; rebuild the versioned artifacts");
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
console.log("Renderer hashes and independent bridge verified" +
  (process.argv.includes("--source") ? "; source matches the pinned submodule" : ""));

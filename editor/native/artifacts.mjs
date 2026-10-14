import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import { rendererVersion, nativeInputsFingerprint } from "../scripts/build-identity.mjs";
import { writeRendererInventory } from "../scripts/update-artifacts.mjs";
import { sourcePin } from "../scripts/source-pin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const publicRoot = join(root, "renderer");
// A native build supplies provenance; a JS-only sync must preserve and verify it.
export function writeArtifacts(builtIdentity) {
  const toolchain = JSON.parse(readFileSync(join(here, "toolchain.json"), "utf8"));
  const identity = builtIdentity ?? JSON.parse(readFileSync(join(publicRoot, "build-identity.json"), "utf8"));
  if (!builtIdentity) {
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || "Initialize vendor/MiaCode before syncing artifacts");
      return result.stdout.trim();
    };
    const revision = git("-C", "vendor/MiaCode", "rev-parse", "HEAD");
    const recorded = sourcePin(root).upstreamGitCommit;
    const dirty = git("-C", "vendor/MiaCode", "status", "--porcelain");
    if (revision !== identity.upstreamGitCommit || recorded !== revision || dirty || identity.upstreamDirty ||
      identity.nativeInputsFingerprint !== nativeInputsFingerprint(identity.sourceRevision, toolchain, here))
      throw new Error("Native source or toolchain changed; run build:native before sync:artifacts");
  }
  identity.version = rendererVersion(identity.sourceRevision, toolchain, here, publicRoot);
  writeFileSync(join(publicRoot, "build-identity.json"), JSON.stringify(identity, null, 2) + "\n");
  for (const name of ["miacode-preview.wasm", "miacode-preview.js"]) {
    const bytes = readFileSync(join(publicRoot, name));
    writeFileSync(join(publicRoot, `${name}.br`), brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
    }));
    writeFileSync(join(publicRoot, `${name}.gz`), gzipSync(bytes, { level: 9 }));
  }
  writeRendererInventory(publicRoot);
  console.log(`Updated preview inventory: ${identity.version}`);
  return identity;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeArtifacts();

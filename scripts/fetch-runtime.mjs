import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeInputsFingerprint } from "./build-identity.mjs";
import { syncTheme } from "./sync-theme.mjs";
import { writeArtifacts } from "../native/artifacts.mjs";
import { sourcePin } from "./source-pin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = new URL(process.argv[2] || "https://team-miacode.github.io/MiaView_Web/renderer/");
if (!base.pathname.endsWith("/")) base.pathname += "/";
async function bytes(path) {
  const response = await fetch(new URL(path, base));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const identity = JSON.parse(await bytes("build-identity.json"));
const manifest = JSON.parse(await bytes("artifact-manifest.json"));
const toolchain = JSON.parse(readFileSync(join(root, "native/toolchain.json")));
if (sourcePin(root).upstreamGitCommit !== identity.upstreamGitCommit || identity.upstreamDirty ||
    nativeInputsFingerprint(identity.sourceRevision, toolchain, join(root, "native")) !== identity.nativeInputsFingerprint)
  throw new Error("Published runtime does not match the pinned native source; build:native is required");
const generated = new Set(["miacode-preview.js", "miacode-preview.wasm", "qtloader.js", "build-identity.json", "LICENSE", "LICENSE_SCOPE.md", "THIRD_PARTY_NOTICES.md"]);
const files = manifest.files.filter(file => generated.has(file.path) || file.path.startsWith("sfx/"));
for (let start = 0; start < files.length; start += 3) {
  await Promise.all(files.slice(start, start + 3).map(async file => {
    const destination = resolve(root, "renderer", file.path);
    if (!destination.startsWith(resolve(root, "renderer") + "/") && !destination.startsWith(resolve(root, "renderer") + "\\")) throw new Error("Invalid runtime path");
    if (existsSync(destination) && createHash("sha256").update(readFileSync(destination)).digest("hex") === file.sha256) return;
    const data = await bytes(file.path);
    if (data.length !== file.byteSize || createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error(`Runtime checksum mismatch: ${file.path}`);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, data);
    console.log(`Verified ${file.path}: ${data.length} bytes`);
  }));
}
syncTheme(join(root, "vendor/MiaCode"), identity.upstreamGitCommit);
writeArtifacts();

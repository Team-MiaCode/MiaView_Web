import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generated = new Set([
  "miacode-preview.js", "miacode-preview.wasm", "miacode-analysis.js", "miacode-analysis.wasm", "qtloader.js", "theme.css",
  "build-identity.json", "artifact-manifest.json", "LICENSE", "LICENSE_SCOPE.md",
  "THIRD_PARTY_NOTICES.md",
]);
const product = existsSync(resolve(root, "source-config.json"));
function sourceFiles(directory = "") {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (!directory && [".deps", "vendor", "node_modules", "build-devtools", "artifacts", ".git", ".logs", ".vscode", "charts"].includes(entry.name)) return [];
    if (entry.name === "__pycache__" || path.startsWith("native/build-") || path.startsWith("native/build/")) return [];
    if (path.startsWith("renderer/") && (generated.has(path.slice(9)) || /\.(br|gz)$/.test(path) || path.startsWith("renderer/sfx/"))) return [];
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}
const tracked = product ? { status: 0, stdout: sourceFiles().join("\0") }
  : spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
assert.equal(tracked.status, 0, tracked.stderr);
for (const path of tracked.stdout.split("\0").filter(Boolean)) {
  if (path.startsWith("renderer/")) {
    const name = path.slice("renderer/".length);
    assert.ok(!generated.has(name) && !/\.(br|gz)$/.test(name) && !name.startsWith("sfx/"),
      `Generated runtime must stay out of Git: ${path}`);
  }
  const file = statSync(resolve(root, path));
  if (file.isFile()) assert.ok(file.size <= 5 * 1024 * 1024, `Tracked file exceeds 5 MiB: ${path}`);
}
const player = readFileSync(resolve(root, "renderer/player.mjs"), "utf8");
assert.ok(player.includes("createPlayerController") && player.includes("attachSdkBridge"));
for (const name of readdirSync(resolve(root, "renderer")).filter(name => name.endsWith(".mjs"))) {
  const source = readFileSync(resolve(root, "renderer", name), "utf8");
  assert.ok(!source.includes("../dev/") && !source.includes("__dev-charts"), name);
}
console.log(product ? "Product source boundaries and file sizes verified" : "Source boundaries and repository artifact policy verified");

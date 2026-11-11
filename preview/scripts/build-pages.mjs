import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const synchronize = resolve(root, "scripts/sync-products.mjs");
if (existsSync(synchronize)) {
  const result = spawnSync(process.execPath, [synchronize, "--runtime"], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
}
const checked = spawnSync(process.execPath, [resolve(root, "scripts/verify.mjs")], {
  cwd: root, encoding: "utf8",
});
if (checked.error || checked.status !== 0)
  throw new Error(checked.error?.message ?? checked.stderr ?? "Build and verify the renderer before packaging Pages");
const output = resolve(root, process.argv[2] ?? "artifacts/pages");
if (existsSync(output)) throw new Error(`Use an empty Pages output directory: ${output}`);
mkdirSync(output, { recursive: true });
const wasmFiles = new Map();
function copyRenderer(source, target) {
  const manifest = JSON.parse(readFileSync(resolve(source, "artifact-manifest.json"), "utf8"));
  const binaries = new Map(manifest.files.filter(file => file.path.endsWith(".wasm")).map(file => [file.path, file.sha256]));
  cpSync(source, target, { recursive: true, filter: path => !/\.wasm(?:\.(?:br|gz))?$/.test(relative(source, path)) });
  for (const file of manifest.files) {
    const match = /^(.*\.wasm)(\.(?:br|gz))?$/.exec(file.path);
    if (!match) continue;
    const path = resolve(output, "wasm", binaries.get(match[1]) + ".wasm" + (match[2] ?? ""));
    if (!wasmFiles.has(path)) {
      mkdirSync(dirname(path), { recursive: true });
      copyFileSync(resolve(source, file.path), path);
      wasmFiles.set(path, { byteSize: file.byteSize, sha256: file.sha256 });
    }
    Object.assign(file, wasmFiles.get(path), { url: relative(target, path).replaceAll("\\", "/") });
  }
  writeFileSync(resolve(target, "artifact-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}
for (const name of ["sdk", "ui", "services"])
  cpSync(resolve(root, name), resolve(output, name), { recursive: true });
copyRenderer(resolve(root, "renderer"), resolve(output, "renderer"));
for (const name of ["index.html", "app.mjs", "page.css", "preview-window.html"])
  copyFileSync(resolve(root, name), resolve(output, name));
mkdirSync(resolve(output, "examples"));
copyFileSync(resolve(root, "examples/pages.html"), resolve(output, "examples/index.html"));
copyFileSync(resolve(root, "examples/pages-demo.mjs"), resolve(output, "examples/pages-demo.mjs"));
copyFileSync(resolve(root, "examples/react-preview.jsx"), resolve(output, "examples/react-preview.jsx"));
copyFileSync(resolve(root, "examples/chart-website-adapter.mjs"), resolve(output, "examples/chart-website-adapter.mjs"));
if (existsSync(resolve(root, "examples/editor.html"))) {
  copyFileSync(resolve(root, "examples/editor.html"), resolve(output, "examples/editor.html"));
  copyFileSync(resolve(root, "examples/editor-demo.mjs"), resolve(output, "examples/editor-demo.mjs"));
}
for (const product of ["editor", "preview"]) {
  if (!existsSync(resolve(root, product, "source-config.json"))) continue;
  const target = resolve(output, product);
  mkdirSync(target, { recursive: true });
  for (const name of ["sdk", "ui", "services", "examples"])
    cpSync(resolve(root, product, name), resolve(target, name), { recursive: true });
  copyRenderer(resolve(root, product, "renderer"), resolve(target, "renderer"));
  for (const name of ["index.html", "app.mjs", "page.css", "preview-window.html"])
    copyFileSync(resolve(root, product, name), resolve(target, name));
}
// Keep the original examples/ paths so project Pages URLs retain their prefix.
writeFileSync(resolve(output, ".nojekyll"), "");
console.log(`Pages static files prepared: ${output}`);

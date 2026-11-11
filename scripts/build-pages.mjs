import { cpSync, copyFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checked = spawnSync(process.execPath, [resolve(root, "scripts/verify.mjs")], {
  cwd: root, encoding: "utf8",
});
if (checked.error || checked.status !== 0)
  throw new Error(checked.error?.message ?? checked.stderr ?? "Build and verify the renderer before packaging Pages");
const output = resolve(root, process.argv[2] ?? "build-devtools/pages");
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
for (const name of ["react-preview.jsx", "chart-website-adapter.mjs"]) {
  if (existsSync(resolve(root, "examples", name)))
    copyFileSync(resolve(root, "examples", name), resolve(output, "examples", name));
}
if (existsSync(resolve(root, "examples/editor.html"))) {
  copyFileSync(resolve(root, "examples/editor.html"), resolve(output, "examples/editor.html"));
  copyFileSync(resolve(root, "examples/editor-demo.mjs"), resolve(output, "examples/editor-demo.mjs"));
}
const copyEntry = (source, target, transform = value => value) => {
  const path = resolve(output, target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, transform(readFileSync(resolve(root, source), "utf8")));
};
if (existsSync(resolve(root, "products/preview/index.html"))) {
  // The published product routes share the SDK, renderer and UI at the site root.
  copyEntry("index.html", "editor/index.html", html => html.replace("<head>", '<head>\n    <base href="../">'));
  const shared = source => source.replace(/(^|["'])\.?\/(sdk|ui|services)\//g, "$1../$2/")
    .replace(/(["'])(sdk|ui|services)\//g, "$1../$2/");
  for (const name of ["index.html", "app.mjs", "page.css"])
    copyEntry(`products/preview/${name}`, `preview/${name}`, shared);
  for (const product of ["editor", "preview"]) {
    copyEntry("examples/pages.html", `${product}/examples/index.html`, html =>
      html.replace("<head>", '<head>\n    <base href="../../examples/">'));
  }
  copyEntry("examples/editor.html", "editor/examples/editor.html", html =>
    html.replace("<head>", '<head>\n    <base href="../../examples/">'));
}
writeFileSync(resolve(output, ".nojekyll"), "");
console.log(`Pages static files prepared: ${output}`);

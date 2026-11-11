import { cpSync, copyFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
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
for (const name of ["sdk", "renderer", "ui", "services"])
  cpSync(resolve(root, name), resolve(output, name), { recursive: true });
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

import { cpSync, copyFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
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
for (const name of ["sdk", "renderer", "ui", "services"])
  cpSync(resolve(root, name), resolve(output, name), { recursive: true });
for (const name of ["index.html", "app.mjs", "page.css", "preview-window.html"])
  copyFileSync(resolve(root, name), resolve(output, name));
mkdirSync(resolve(output, "examples"));
copyFileSync(resolve(root, "examples/pages.html"), resolve(output, "examples/index.html"));
copyFileSync(resolve(root, "examples/pages-demo.mjs"), resolve(output, "examples/pages-demo.mjs"));
if (existsSync(resolve(root, "examples/editor.html"))) {
  copyFileSync(resolve(root, "examples/editor.html"), resolve(output, "examples/editor.html"));
  copyFileSync(resolve(root, "examples/editor-demo.mjs"), resolve(output, "examples/editor-demo.mjs"));
}
for (const product of ["editor", "preview"]) {
  if (!existsSync(resolve(root, product, "source-config.json"))) continue;
  const target = resolve(output, product);
  mkdirSync(target, { recursive: true });
  for (const name of ["sdk", "renderer", "ui", "services", "examples"])
    cpSync(resolve(root, product, name), resolve(target, name), { recursive: true });
  for (const name of ["index.html", "app.mjs", "page.css", "preview-window.html"])
    copyFileSync(resolve(root, product, name), resolve(target, name));
}
// Keep the original examples/ paths so project Pages URLs retain their prefix.
writeFileSync(resolve(output, ".nojekyll"), "");
console.log(`Pages static files prepared: ${output}`);

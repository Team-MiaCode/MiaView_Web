import { cpSync, copyFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
// Keep the original examples/ paths so project Pages URLs retain their prefix.
writeFileSync(resolve(output, ".nojekyll"), "");
console.log(`Pages static files prepared: ${output}`);

import { cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourcePin } from "./source-pin.mjs";
import { rendererVersion } from "./build-identity.mjs";
import { writeRendererInventory } from "./update-artifacts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.argv.includes("--runtime");
const generated = new Set(["miacode-preview.js", "miacode-preview.wasm", "miacode-analysis.js", "miacode-analysis.wasm", "qtloader.js", "theme.css", "build-identity.json", "artifact-manifest.json", "LICENSE", "LICENSE_SCOPE.md", "THIRD_PARTY_NOTICES.md", "sfx"]);
const rootOnly = new Set(["scripts/sync-products.mjs", "tests/editor-template-smoke.mjs", "tests/products-smoke.mjs", "tests/product-closure.mjs", "tests/product-builds.mjs"]);
const configuration = sourcePin(root);
const packageSource = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
function sameFile(source, target) {
  if (!existsSync(target)) return false;
  const from = lstatSync(source), to = lstatSync(target);
  return from.isFile() && to.isFile() && from.size === to.size && readFileSync(source).equals(readFileSync(target));
}
function copy(source, target) {
  if (!sameFile(source, target)) { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); }
}
for (const product of ["editor", "preview"]) {
  const destination = join(root, product);
  mkdirSync(destination, { recursive: true });
  const excluded = new Set(rootOnly);
  if (product === "preview") for (const path of ["sdk/editor.mjs", "sdk/editor.d.mts", "renderer/editor.html", "renderer/editor.mjs", "examples/editor.html", "examples/editor-demo.mjs", "tests/types-editor.ts"]) excluded.add(path);
  for (const name of ["sdk", "renderer", "services", "ui", "native", "scripts", "dev", "tests", "examples", "backend", "docs", ".assets"]) {
    cpSync(join(root, name), join(destination, name), { recursive: true, filter: (path, target) => {
      const relative = path.slice(root.length + 1).replaceAll("\\", "/");
      const local = relative.slice(name.length + 1);
      if (excluded.has(relative) || relative.split("/").includes("__pycache__") || relative.endsWith(".pyc")) return false;
      if (name === "native" && ["build", "build-release", "build-dev-refactor-release"].includes(local.split("/")[0])) return false;
      if (name === "renderer" && !runtime && (generated.has(local.split("/")[0]) || /\.(br|gz)$/.test(local))) return false;
      return !sameFile(path, target);
    } });
  }
  for (const path of [...excluded, "ui/workbench/media-tools.mjs"]) rmSync(join(destination, path), { force: true });
  for (const name of ["index.html", "app.mjs", "page.css", "preview-window.html", "tsconfig.json"])
    copy(join(root, product === "preview" && ["index.html", "app.mjs", "page.css"].includes(name) ? "products/preview" : "", name), join(destination, name));
  copy(join(root, "examples/pages.html"), join(destination, "examples/index.html"));
  copy(join(root, "products", product, "README.md"), join(destination, "README.md"));
  const productPackage = { ...packageSource, name: `miacode-web-${product}`, description: product === "editor" ? "MiaCode Web Editor" : "MiaView Web Preview", scripts: { ...packageSource.scripts }, exports: { ...packageSource.exports } };
  for (const command of ["sync:products", "test:editor-template", "test:products", "check:products"]) delete productPackage.scripts[command];
  if (product === "editor") {
    productPackage.main = "./sdk/editor.mjs"; productPackage.types = "./sdk/editor.d.mts";
    productPackage.exports["./preview"] = packageSource.exports["."];
    productPackage.exports["."] = packageSource.exports["./editor"];
  } else {
    delete productPackage.exports["./editor"];
    const previewScripts = new Set(["build:pages", "dev", "test", "check", "check:repo", "check:source", "check:types", "build:native", "sync:artifacts", "sync:ui", "sync:fonts", "sync:labels", "source:init", "runtime:fetch", "sync:media",
      "test:browser", "test:firework", "test:ui", "test:video-geometry", "test:pv-sync", "test:analysis-worker", "test:preview-lifecycle", "test:preview-resources", "test:preview-benchmark", "test:preview-parity"]);
    productPackage.scripts = Object.fromEntries(Object.entries(productPackage.scripts).filter(([name]) => previewScripts.has(name)));
  }
  productPackage.files = ["index.html", "app.mjs", "page.css", "preview-window.html", "sdk", "renderer", "ui", "services", "backend", "README.md"];
  writeFileSync(join(destination, "package.json"), JSON.stringify(productPackage, null, 2) + "\n");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  lock.name = productPackage.name; lock.packages[""].name = productPackage.name;
  writeFileSync(join(destination, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
  writeFileSync(join(destination, "source-config.json"), JSON.stringify(configuration, null, 2) + "\n");
  writeFileSync(join(destination, ".gitignore"), readFileSync(join(root, ".gitignore"), "utf8") + "\n/vendor/MiaCode/\n");
  if (product === "preview") {
    const typeConfig = JSON.parse(readFileSync(join(destination, "tests/tsconfig.json"), "utf8"));
    typeConfig.files = typeConfig.files.filter(path => path !== "types-editor.ts");
    writeFileSync(join(destination, "tests/tsconfig.json"), JSON.stringify(typeConfig, null, 2) + "\n");
    if (runtime) {
      const renderer = join(destination, "renderer"), native = join(destination, "native");
      const identity = JSON.parse(readFileSync(join(renderer, "build-identity.json"), "utf8"));
      identity.version = rendererVersion(identity.sourceRevision, JSON.parse(readFileSync(join(native, "toolchain.json"), "utf8")), native, renderer);
      writeFileSync(join(renderer, "build-identity.json"), JSON.stringify(identity, null, 2) + "\n");
      writeRendererInventory(renderer);
    }
  }
  console.log(`Synchronized ${product}: ${destination}`);
}

import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const base = resolve(process.env.MIACODE_PRODUCTS_ROOT || ".");
const authority = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generated = new Set(["miacode-preview.js", "miacode-preview.wasm", "miacode-analysis.js", "miacode-analysis.wasm", "qtloader.js", "theme.css", "build-identity.json", "artifact-manifest.json", "LICENSE", "LICENSE_SCOPE.md", "THIRD_PARTY_NOTICES.md"]);
const commonDirectories = new Set(["sdk", "renderer", "services", "ui", "native", "scripts", "dev", "backend"]);
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    if ([".deps", "vendor", "node_modules", "build-devtools", "artifacts", ".git"].includes(item.name)) return [];
    const path = join(directory, item.name);
    assert.ok(!lstatSync(path).isSymbolicLink(), `Product symlink: ${path}`);
    return item.isDirectory() ? files(path) : [path];
  });
}
for (const product of ["editor", "preview"]) {
  const root = realpathSync(join(base, product));
  let checked = 0;
  for (const file of files(root)) {
    const local = relative(root, file).replaceAll("\\", "/");
    if (commonDirectories.has(local.split("/")[0])
      && !(local.startsWith("renderer/") && (generated.has(local.slice(9)) || /\.(br|gz)$/.test(local) || local.startsWith("renderer/sfx/")))) {
      const source = resolve(authority, local);
      assert.ok(existsSync(source), `${product}: unexpected common source ${local}`);
      assert.ok(readFileSync(file).equals(readFileSync(source)), `${product}: shared source differs ${local}`);
    }
    if (![".mjs", ".mts", ".css", ".html", ".ts"].includes(extname(file)) || local.startsWith("renderer/vendor/") || local.startsWith("tests/")) continue;
    const source = readFileSync(file, "utf8");
    const references = [];
    if (/\.(?:mjs|mts|ts)$/.test(file)) {
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']/g)) references.push(match[1]);
      for (const match of source.matchAll(/\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) references.push(match[1]);
    } else if (extname(file) === ".css") {
      for (const match of source.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)) references.push(match[1]);
    } else {
      for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/g)) references.push(match[1]);
      for (const match of source.matchAll(/\bimport\(\s*["'](\.[^"']+)["']\s*\)/g)) references.push(match[1]);
    }
    for (const reference of references) {
      if (/^(?:[a-z]+:|#|\/)/i.test(reference) || reference.includes("${")) continue;
      const target = resolve(dirname(file), reference.split(/[?#]/)[0]);
      assert.ok(target === root || target.startsWith(root + sep), `${product}/${local}: parent dependency ${reference}`);
      // TS resolves .mjs declarations through their same-name .d.mts files.
      assert.ok(!extname(target) || existsSync(target) || /\.mjs$/.test(target) && existsSync(target.replace(/\.mjs$/, ".d.mts")), `${product}/${local}: missing ${reference}`);
      ++checked;
    }
  }
  const { sourcePin } = await import(pathToFileURL(join(root, "scripts/source-pin.mjs")));
  assert.deepEqual(sourcePin(root), JSON.parse(readFileSync(join(root, "source-config.json"), "utf8")));
  const { rendererVersion, nativeInputsFingerprint } = await import(pathToFileURL(join(root, "scripts/build-identity.mjs")));
  const identity = JSON.parse(readFileSync(join(root, "renderer/build-identity.json"), "utf8"));
  const toolchain = JSON.parse(readFileSync(join(root, "native/toolchain.json"), "utf8"));
  assert.equal(identity.nativeInputsFingerprint, nativeInputsFingerprint(identity.sourceRevision, toolchain, join(root, "native")));
  assert.equal(identity.version, rendererVersion(identity.sourceRevision, toolchain, join(root, "native"), join(root, "renderer")));
  for (const name of ["index.html", "app.mjs", "page.css"]) {
    const source = resolve(authority, product === "preview" ? "products/preview" : "", name);
    assert.ok(readFileSync(join(root, name)).equals(readFileSync(source)), `${product}: entry differs ${name}`);
  }
  console.log(`${product}: ${checked} local imports and resources remain within the product; source and runtime identities verified`);
}

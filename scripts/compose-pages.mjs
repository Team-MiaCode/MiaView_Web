import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [mainInput, featureInput, target] = process.argv.slice(2);
if (!mainInput || !featureInput || !target) throw new Error("Usage: node scripts/compose-pages.mjs MAIN FEATURE OUTPUT");
const main = resolve(mainInput), feature = resolve(featureInput), output = resolve(target);
if (existsSync(output)) throw new Error(`Use an empty Pages output directory: ${output}`);
for (const directory of [main, feature]) {
  for (const file of ["index.html", "sdk/index.mjs", "renderer/index.html", "renderer/miacode-preview.wasm"])
    if (!existsSync(resolve(directory, file))) throw new Error(`Pages input is missing ${file}: ${directory}`);
}
mkdirSync(output, { recursive: true });
cpSync(main, output, { recursive: true });
cpSync(feature, resolve(output, "feature"), { recursive: true });
writeFileSync(resolve(output, ".nojekyll"), "");
writeFileSync(resolve(output, "deployment.json"), JSON.stringify({
  main: { branch: "main", commit: process.env.MAIN_SHA, path: "/" },
  feature: { branch: "feature/web-editor-migration", commit: process.env.FEATURE_SHA, path: "/feature/" },
}, null, 2) + "\n");
console.log(`Main and feature Pages prepared: ${output}`);

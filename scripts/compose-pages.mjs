import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [mainInput, featureInput, sdkPreviewInput, target] = process.argv.slice(2);
if (!mainInput || !featureInput || !sdkPreviewInput || !target)
  throw new Error("Usage: node scripts/compose-pages.mjs MAIN FEATURE SDK_PREVIEW OUTPUT");
const main = resolve(mainInput), feature = resolve(featureInput), sdkPreview = resolve(sdkPreviewInput), output = resolve(target);
if (existsSync(output)) throw new Error(`Use an empty Pages output directory: ${output}`);
for (const directory of [main, feature]) {
  for (const file of ["index.html", "sdk/index.mjs", "renderer/index.html", "renderer/miacode-preview.wasm"])
    if (!existsSync(resolve(directory, file))) throw new Error(`Pages input is missing ${file}: ${directory}`);
}
for (const file of ["examples/sdk-preview/index.html", "examples/sdk-preview/app.mjs", "examples/sdk-preview/page.css",
  "sdk/index.mjs", "renderer/index.html", "renderer/artifact-manifest.json", "wasm", "ui", "services"])
  if (!existsSync(resolve(sdkPreview, file))) throw new Error(`SDK preview Pages input is missing ${file}: ${sdkPreview}`);
mkdirSync(output, { recursive: true });
cpSync(main, output, { recursive: true });
cpSync(feature, resolve(output, "feature"), { recursive: true });
for (const path of ["examples/sdk-preview", "sdk", "renderer", "wasm", "ui", "services"])
  cpSync(resolve(sdkPreview, path), resolve(output, "standalone-preview", path), { recursive: true });
writeFileSync(resolve(output, ".nojekyll"), "");
writeFileSync(resolve(output, "deployment.json"), JSON.stringify({
  main: { branch: "main", commit: process.env.MAIN_SHA, path: "/" },
  feature: { branch: "feature/web-editor-migration", commit: process.env.FEATURE_SHA, path: "/feature/" },
  sdkPreview: { branch: "standalone-preview", commit: process.env.SDK_PREVIEW_SHA, path: "/standalone-preview/examples/sdk-preview/" },
}, null, 2) + "\n");
console.log(`Main, feature and SDK preview Pages prepared: ${output}`);

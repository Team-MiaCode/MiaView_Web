import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [mainInput, featureInput, sdkReleaseInput, target] = process.argv.slice(2);
if (!mainInput || !featureInput || !sdkReleaseInput || !target)
  throw new Error("Usage: node scripts/compose-pages.mjs MAIN FEATURE SDK_RELEASE OUTPUT");
const main = resolve(mainInput), feature = resolve(featureInput), output = resolve(target);
const demoPath = "examples/sdk-preview";
const demo = resolve(sdkReleaseInput, demoPath);
if (existsSync(output)) throw new Error(`Use an empty Pages output directory: ${output}`);
for (const directory of [main, feature]) {
  for (const file of ["index.html", "sdk/index.mjs", "renderer/index.html", "renderer/artifact-manifest.json"])
    if (!existsSync(resolve(directory, file))) throw new Error(`Pages input is missing ${file}: ${directory}`);
}
for (const file of ["index.html", "app.mjs", "page.css"])
  if (!existsSync(resolve(demo, file))) throw new Error(`SDK demo is missing ${file}: ${demo}`);
mkdirSync(output, { recursive: true });
const publishedBranches = new Set([resolve(main, "feature"), resolve(main, "standalone-preview")]);
cpSync(main, output, { recursive: true, filter: path => !publishedBranches.has(path) });
cpSync(feature, resolve(output, "feature"), { recursive: true });
const featureDemo = resolve(output, "feature", demoPath);
mkdirSync(featureDemo, { recursive: true });
for (const file of ["index.html", "app.mjs", "page.css"])
  cpSync(resolve(demo, file), resolve(featureDemo, file));
const demoEntry = resolve(output, "standalone-preview", demoPath);
mkdirSync(demoEntry, { recursive: true });
const html = readFileSync(resolve(demo, "index.html"), "utf8");
writeFileSync(resolve(demoEntry, "index.html"), html.replace("<head>", `<head>\n  <base href="../../../feature/${demoPath}/">`));
writeFileSync(resolve(output, ".nojekyll"), "");
writeFileSync(resolve(output, "deployment.json"), JSON.stringify({
  main: { branch: "main", commit: process.env.MAIN_SHA, path: "/" },
  feature: { branch: "feature/web-editor-migration", commit: process.env.FEATURE_SHA, path: "/feature/" },
  sdkPreview: { branch: "standalone-preview", commit: process.env.SDK_PREVIEW_SHA, runtimeCommit: process.env.FEATURE_SHA, path: `/standalone-preview/${demoPath}/` },
}, null, 2) + "\n");
console.log(`Main, feature and SDK preview Pages prepared: ${output}`);

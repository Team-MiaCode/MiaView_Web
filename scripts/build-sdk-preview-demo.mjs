import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const [packagePath, outputPath = "build-devtools/sdk-preview-demo"] = process.argv.slice(2);
if (!packagePath) throw new Error("Usage: npm run build:sdk-preview-demo -- SDK_PACKAGE [OUTPUT]");
const sdk = resolve(packagePath);
const output = resolve(root, outputPath);
const runtimeDirectories = ["sdk", "renderer", "ui", "services"];
if (existsSync(output)) throw new Error(`Use an empty demo output directory: ${output}`);
for (const path of [...runtimeDirectories, "scripts/verify.mjs"]) {
  if (!existsSync(resolve(sdk, path))) throw new Error(`SDK package is missing ${path}: ${sdk}`);
}
const verified = spawnSync(process.execPath, ["scripts/verify.mjs"], { cwd: sdk, stdio: "inherit" });
if (verified.error || verified.status !== 0)
  throw new Error(verified.error?.message ?? `SDK package failed verification: ${sdk}`);

const example = "examples/sdk-preview";
mkdirSync(resolve(output, "examples"), { recursive: true });
for (const directory of runtimeDirectories)
  cpSync(resolve(sdk, directory), resolve(output, directory), { recursive: true });
cpSync(resolve(root, example), resolve(output, example), { recursive: true });
for (const file of ["react-preview.jsx", "chart-website-adapter.mjs"])
  copyFileSync(resolve(root, "examples", file), resolve(output, "examples", file));
copyFileSync(resolve(root, example, "README.md"), resolve(output, "README.md"));
console.log(`SDK demo static files prepared: ${output}`);

import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, process.argv[2] ?? "build-devtools/sdk-preview-demo");
if (existsSync(output)) throw new Error(`Use an empty demo output directory: ${output}`);
const verified = spawnSync(process.execPath, ["scripts/verify.mjs"], { cwd: root, stdio: "inherit" });
if (verified.error || verified.status !== 0)
  throw new Error(verified.error?.message ?? "Build and verify the renderer before packaging the SDK demo");

const example = "examples/sdk-preview";
mkdirSync(resolve(output, "examples"), { recursive: true });
for (const directory of ["sdk", "renderer", "ui", "services", example])
  cpSync(resolve(root, directory), resolve(output, directory), { recursive: true });
copyFileSync(resolve(root, example, "README.md"), resolve(output, "README.md"));
console.log(`SDK demo static files prepared: ${output}`);

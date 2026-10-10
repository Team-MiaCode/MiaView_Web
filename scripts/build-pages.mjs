import { cpSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, process.argv[2] ?? "artifacts/pages");
if (existsSync(output)) throw new Error(`Use an empty Pages output directory: ${output}`);
mkdirSync(output, { recursive: true });
for (const name of ["sdk", "renderer", "examples"])
  cpSync(resolve(root, name), resolve(output, name), { recursive: true });
// Keep the original examples/ paths so project Pages URLs retain their prefix.
writeFileSync(resolve(output, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>MiaView Web</title><meta http-equiv="refresh" content="0;url=./examples/index.html"><a href="./examples/index.html">打开谱面预览</a></html>\n`);
writeFileSync(resolve(output, ".nojekyll"), "");
console.log(`Pages static files prepared: ${output}`);

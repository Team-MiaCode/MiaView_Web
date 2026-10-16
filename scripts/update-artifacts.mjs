import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function writeRendererInventory(directory = join(root, "renderer")) {
  const paths = readdirSync(directory).filter(name =>
    /\.(wasm|js|mjs|css|html|json|br|gz)$/.test(name) && name !== "artifact-manifest.json");
  paths.push(...readdirSync(join(directory, "sfx")).map(name => `sfx/${name}`));
  paths.push("LICENSE", "LICENSE_SCOPE.md", "THIRD_PARTY_NOTICES.md");
  paths.push("vendor/mediabunny/index.mjs", "vendor/mediabunny/LICENSE", "vendor/mediabunny/NOTICE.md");
  const files = paths.sort().map(path => {
    const bytes = readFileSync(join(directory, path));
    return { path, byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  writeFileSync(join(directory, "artifact-manifest.json"), JSON.stringify({ files }, null, 2) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeRendererInventory();
  console.log("Renderer inventory updated");
}

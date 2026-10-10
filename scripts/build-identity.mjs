import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function rendererVersion(sourceRevision, toolchain, native, renderer) {
  const hash = createHash("sha256").update(sourceRevision).update(JSON.stringify(toolchain));
  for (const name of ["browser-host.cpp", "CMakeLists.txt", "browser-assets.qrc.in"])
    hash.update(name).update(readFileSync(join(native, name)));
  for (const name of readdirSync(renderer).filter(name => /\.(wasm|js|mjs|css|html)$/.test(name)).sort())
    hash.update(name).update(readFileSync(join(renderer, name)));
  return `miaview-web-2-${hash.digest("hex").slice(0, 12)}`;
}

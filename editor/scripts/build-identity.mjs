import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function hashNativeInputs(hash, native) {
  for (const name of ["browser-host.cpp", "CMakeLists.txt", "browser-assets.qrc.in",
    "firework-layer.cpp", "firework-layer.h", "cover-scene.cpp", "cover-scene.h", "timeline-bridge.cpp", "timeline-bridge.h", "document-bridge.cpp", "document-bridge.h"])
    hash.update(name).update(readFileSync(join(native, name), "utf8").replace(/\r\n/g, "\n"));
  return hash;
}

export function rendererVersion(sourceRevision, toolchain, native, renderer) {
  const hash = createHash("sha256").update(sourceRevision).update(JSON.stringify(toolchain));
  hashNativeInputs(hash, native);
  for (const name of readdirSync(renderer).filter(name => /\.(wasm|js|mjs|css|html)$/.test(name)).sort()) {
    const content = name.endsWith(".wasm") ? readFileSync(join(renderer, name)) : readFileSync(join(renderer, name), "utf8").replace(/\r\n/g, "\n");
    hash.update(name).update(content);
  }
  return `miaview-web-2-${hash.digest("hex").slice(0, 12)}`;
}

// Inputs compiled into JS/WASM, independently of UI edits.
export function nativeInputsFingerprint(sourceRevision, toolchain, native) {
  const hash = createHash("sha256").update(sourceRevision).update(JSON.stringify(toolchain));
  return hashNativeInputs(hash, native).digest("hex");
}

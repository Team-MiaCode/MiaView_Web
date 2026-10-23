import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeInputsFingerprint, rendererVersion } from "../scripts/build-identity.mjs";

test("Web firework implementation and header invalidate native provenance and renderer version", () => {
  const root = mkdtempSync(join(tmpdir(), "miaview-build-identity-"));
  try {
    const native = join(root, "native"), renderer = join(root, "renderer");
    mkdirSync(native);
    mkdirSync(renderer);
    mkdirSync(join(renderer,"vendor/mediabunny"),{recursive:true});
    writeFileSync(join(renderer,"vendor/mediabunny/index.mjs"),"export const version = 'test';\n");
    for (const name of ["browser-host.cpp", "analysis-host.cpp", "CMakeLists.txt", "browser-assets.qrc.in",
      "firework-brightness.cmake", "firework-layer.cpp", "firework-layer.h", "cover-scene.cpp", "cover-scene.h", "timeline-bridge.cpp", "timeline-bridge.h", "document-bridge.cpp", "document-bridge.h", "editor-bridge.cpp", "editor-bridge.h", "touch-bridge.cpp", "touch-bridge.h", "latency-bridge.cpp", "latency-bridge.h", "preferences-bridge.cpp", "preferences-bridge.h", "appearance-bridge.cpp", "appearance-bridge.h", "export-bridge.cpp", "export-bridge.h"])
      writeFileSync(join(native, name), name);
    const revision = "a".repeat(64), toolchain = { qtVersion: "test" };
    const fingerprint = () => nativeInputsFingerprint(revision, toolchain, native);
    const version = () => rendererVersion(revision, toolchain, native, renderer);
    const originalFingerprint = fingerprint(), originalVersion = version();
    for (const name of ["firework-brightness.cmake", "firework-layer.cpp", "firework-layer.h", "cover-scene.cpp", "cover-scene.h", "timeline-bridge.cpp", "timeline-bridge.h", "document-bridge.cpp", "document-bridge.h", "editor-bridge.cpp", "editor-bridge.h", "touch-bridge.cpp", "touch-bridge.h", "latency-bridge.cpp", "latency-bridge.h", "preferences-bridge.cpp", "preferences-bridge.h", "appearance-bridge.cpp", "appearance-bridge.h", "export-bridge.cpp", "export-bridge.h"]) {
      const path = join(native, name), original = readFileSync(path);
      writeFileSync(path, `${original.toString()}\nchanged`);
      assert.notEqual(fingerprint(), originalFingerprint, name);
      assert.notEqual(version(), originalVersion, name);
      writeFileSync(path, original);
      assert.equal(fingerprint(), originalFingerprint);
      assert.equal(version(), originalVersion);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Text checkout line endings preserve build identity while binary WASM changes invalidate it", () => {
  const root = mkdtempSync(join(tmpdir(), "miaview-build-identity-"));
  try {
    const native = join(root, "native"), renderer = join(root, "renderer");
    mkdirSync(native); mkdirSync(renderer);
    mkdirSync(join(renderer,"vendor/mediabunny"),{recursive:true});
    writeFileSync(join(renderer,"vendor/mediabunny/index.mjs"),"export const version = 'test';\n");
    const names = ["browser-host.cpp", "analysis-host.cpp", "CMakeLists.txt", "browser-assets.qrc.in", "firework-brightness.cmake", "firework-layer.cpp", "firework-layer.h", "cover-scene.cpp", "cover-scene.h", "timeline-bridge.cpp", "timeline-bridge.h", "document-bridge.cpp", "document-bridge.h", "editor-bridge.cpp", "editor-bridge.h", "touch-bridge.cpp", "touch-bridge.h", "latency-bridge.cpp", "latency-bridge.h", "preferences-bridge.cpp", "preferences-bridge.h", "appearance-bridge.cpp", "appearance-bridge.h", "export-bridge.cpp", "export-bridge.h"];
    for (const name of names) writeFileSync(join(native, name), `${name}\nsource\n`);
    writeFileSync(join(renderer, "player.mjs"), "export const label = '谱面';\n");
    const binary = Buffer.from([0, 97, 115, 109, 13, 10]);
    writeFileSync(join(renderer, "preview.wasm"), binary);
    const fingerprint = nativeInputsFingerprint("revision", {}, native);
    const version = rendererVersion("revision", {}, native, renderer);
    for (const name of names) writeFileSync(join(native, name), `${name}\r\nsource\r\n`);
    writeFileSync(join(renderer, "player.mjs"), "export const label = '谱面';\r\n");
    writeFileSync(join(renderer,"vendor/mediabunny/index.mjs"),"export const version = 'test';\r\n");
    assert.equal(nativeInputsFingerprint("revision", {}, native), fingerprint);
    assert.equal(rendererVersion("revision", {}, native, renderer), version);
    writeFileSync(join(renderer,"vendor/mediabunny/index.mjs"),"export const version = 'changed';\n");
    assert.notEqual(rendererVersion("revision", {}, native, renderer),version);
    writeFileSync(join(renderer,"vendor/mediabunny/index.mjs"),"export const version = 'test';\n");
    writeFileSync(join(renderer, "preview.wasm"), Buffer.from([0, 97, 115, 109, 10]));
    assert.notEqual(rendererVersion("revision", {}, native, renderer), version);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

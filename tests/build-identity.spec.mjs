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
    for (const name of ["browser-host.cpp", "CMakeLists.txt", "browser-assets.qrc.in",
      "firework-layer.cpp", "firework-layer.h"])
      writeFileSync(join(native, name), name);
    const revision = "a".repeat(64), toolchain = { qtVersion: "test" };
    const fingerprint = () => nativeInputsFingerprint(revision, toolchain, native);
    const version = () => rendererVersion(revision, toolchain, native, renderer);
    const originalFingerprint = fingerprint(), originalVersion = version();
    for (const name of ["firework-layer.cpp", "firework-layer.h"]) {
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

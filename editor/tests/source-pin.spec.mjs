import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourcePin } from "../scripts/source-pin.mjs";

test("Standalone source configuration resolves without a parent Git checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "miacode-source-pin-"));
  try {
    const expected = { upstream: "https://github.com/Team-MiaCode/MiaCode.git", upstreamGitCommit: "f".repeat(40) };
    writeFileSync(join(root, "source-config.json"), JSON.stringify(expected));
    assert.deepEqual(sourcePin(root), expected);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

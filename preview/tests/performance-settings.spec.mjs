import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERFORMANCE, frameRateForMode, performanceSettings } from "../renderer/performance-settings.mjs";

test("workbench frame rate modes preserve the upstream 30/60/120/display-refresh values", () => {
  assert.deepEqual([0, 1, 2, 3].map(frameRateForMode), [30, 60, 120, "unlimited"]);
  const updated = performanceSettings(DEFAULT_PERFORMANCE, { canvasFrameRateMode: 0, videoDecodePrefersSoftware: true });
  assert.equal(updated.stageMediaFrameRateMode, 1); assert.equal(updated.canvasFrameRateMode, 0);
  assert.equal(updated.videoDecodePrefersSoftware, true); assert.equal(DEFAULT_PERFORMANCE.videoDecodePrefersSoftware, false);
});
test("performance settings reject malformed values before applying a change", () => {
  for (const changes of [null, [], { canvasFrameRateMode: 4 }, { stageMediaFrameRateMode: "1" },
    { videoDecodePrefersSoftware: 1 }, { fps: 60 }]) assert.throws(() => performanceSettings(DEFAULT_PERFORMANCE, changes));
});

import test from "node:test";
import assert from "node:assert/strict";
import { timelinePlayheadX, timelineCenteredScroll } from "../ui/workbench/timeline-playback.mjs";

const state = { timelineLeft: 40, leadingCenteringPadding: 310.5, displayStartSeconds: -2,
  pixelsPerSecond: 83.75, viewportSize: { width: 701 }, contentWidth: 5000 };
test("playback centers the fractional scene coordinate in an odd-width viewport", () => {
  const second = 13.123;
  const scene = 40 + 310.5 + (second + 2) * 83.75;
  assert.equal(timelinePlayheadX(state, second), scene);
  assert.equal(timelineCenteredScroll(state, second), scene - 350.5);
  assert.ok(timelineCenteredScroll(state, second) % 1 > 0);
});
test("timeline follow clamps at both content edges and supports short content", () => {
  assert.equal(timelineCenteredScroll(state, -20), 0);
  assert.equal(timelineCenteredScroll(state, 1000), 4299);
  assert.equal(timelineCenteredScroll({ ...state, contentWidth: 500 }, 30), 0);
});

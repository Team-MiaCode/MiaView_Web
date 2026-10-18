import test from "node:test";
import assert from "node:assert/strict";
import { timelinePlayheadX, timelineCenteredScroll, timelineSecondAtX } from "../ui/workbench/timeline-playback.mjs";
import { TimelineView } from "../ui/workbench/timeline-view.mjs";

const state = { timelineLeft: 40, leadingCenteringPadding: 310.5, displayStartSeconds: -2,
  pixelsPerSecond: 83.75, viewportSize: { width: 701 }, contentWidth: 5000, maxNavigableSecond: 100 };
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

test("playback scroll continues when the native scene omits the playhead overlay", () => {
  const world = { setAttribute(name, value) { this[name] = value; } };
  const view = { state, playhead: null, worlds: [world], refreshing: true };
  TimelineView.prototype.updatePlayhead.call(view, 10, true);
  assert.equal(view.scrollValue, timelineCenteredScroll(state, 10));
  assert.equal(world.transform, `translate(${-view.scrollValue} 0)`);
});

test("dragging uses the exact viewport center time and clamps to the chart bounds", () => {
  const second = 13.123, scroll = timelineCenteredScroll(state, second);
  assert.ok(Math.abs(timelineSecondAtX(state, state.viewportSize.width / 2, scroll) - second) < 1e-12);
  assert.equal(timelineSecondAtX(state, -10000, 0), 0);
  assert.equal(timelineSecondAtX(state, 100000, 0), 100);
});

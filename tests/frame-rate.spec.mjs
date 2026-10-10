import assert from "node:assert/strict";
import test from "node:test";
import { previewMaxFps as sdkMaxFps } from "../sdk/frame-rate.mjs";
import {
  previewMaxFps,
  maxFpsFromSearch,
  PreviewFrameLimiter,
} from "../renderer/frame-rate.mjs";

test("maximum FPS accepts >=30 integers and unlimited; URL input is strict", () => {
  assert.equal(sdkMaxFps, previewMaxFps);
  assert.equal(previewMaxFps(), 60);
  assert.equal(maxFpsFromSearch("?width=720&height=720"), 60);
  for (const value of [30, 45, 60, 120, 144, 240, 1000, "unlimited"]) {
    assert.equal(previewMaxFps(value), value);
    assert.equal(maxFpsFromSearch(`?maxFps=${value}`), value);
  }
  for (const value of [null, 0, 29, 30.5, -1, NaN, Infinity, "60", "bad", {}])
    assert.throws(() => previewMaxFps(value));
  for (const value of ["", "0", "29", "30.5", "Infinity", "060", "1e2", "60&maxFps=120"])
    assert.throws(() => maxFpsFromSearch(`?maxFps=${value}`));

});

test("frame limiter preserves requested cadence across display refresh rates", () => {
  for (const refreshRate of [60, 75, 120, 144, 165, 240]) {
    for (const maxFps of [30, 45, 60, 120, 144, 240, "unlimited"]) {
      const limiter = new PreviewFrameLimiter(maxFps);
      let accepted = 0;
      for (let frame = 0; frame < refreshRate * 10; frame++)
        if (limiter.accept((frame * 1000) / refreshRate)) accepted++;
      const expected =
        Math.min(refreshRate, maxFps === "unlimited" ? refreshRate : maxFps) * 10;
      assert.ok(Math.abs(accepted - expected) <= 1,
        `${maxFps} FPS on ${refreshRate} Hz: ${accepted} frames, expected ${expected}`);
    }
  }
});

test("frame limiter drops missed frames after stalls and instances are independent", () => {
  const slow = new PreviewFrameLimiter(30);
  const fast = new PreviewFrameLimiter("unlimited");
  assert.equal(slow.accept(0), true);
  assert.equal(slow.accept(10), false);
  assert.equal(fast.accept(10), true);
  assert.equal(slow.accept(5000), true);
  assert.equal(slow.accept(5001), false);
  assert.equal(slow.accept(5034), true);
});

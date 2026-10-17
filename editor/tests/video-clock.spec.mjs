import test from "node:test";
import assert from "node:assert/strict";
import { synchronizeVideoClock } from "../renderer/video-clock.mjs";

test("PV drift converges to the audio clock without repeated small seeks", () => {
  for (const rate of [.5, 1, 2]) for (const initial of [-.08, .08]) {
    const video = { currentTime: 1 + initial, playbackRate: rate, duration: 10, readyState: 2, seeking: false };
    let second = 1, seeks = 0;
    for (let frame = 0; frame < 120; ++frame) {
      seeks += Number(synchronizeVideoClock(video, second, rate, true));
      assert.ok(Math.abs(video.playbackRate - rate) <= .100001);
      video.currentTime += video.playbackRate / 60; second += rate / 60;
    }
    assert.equal(seeks, 0); assert.ok(Math.abs(video.currentTime - second) < 1 / 60);
    synchronizeVideoClock(video, second, rate, false); assert.equal(video.playbackRate, rate);
  }
});

test("PV seeks follow discontinuities and leave in-flight seeks and end frames intact", () => {
  const video = { currentTime: 1, duration: 10, playbackRate: 1.1, readyState: 2, seeking: false };
  assert.equal(synchronizeVideoClock(video, 5, 1, true), true);
  assert.equal(video.currentTime, 5); assert.equal(video.playbackRate, 1);
  video.seeking = true;
  assert.equal(synchronizeVideoClock(video, 8, 1, true), false); assert.equal(video.currentTime, 5);
  video.seeking = false;
  synchronizeVideoClock(video, 12, .5, true); assert.equal(video.currentTime, 10);
});

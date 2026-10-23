import test from "node:test";
import assert from "node:assert/strict";
import { createWorkbenchPreview } from "../services/preview-window.mjs";

test("closing an intro window preserves its song position and returns a paused audition", async () => {
  const restored = {};
  const owner = { on() {},
    async getState() { return { exportPreview: null }; },
    async setPlayback(value) { restored.playback = value; },
    async seek(value) {
      assert.equal(restored.detached, false, "Show the embedded renderer before awaiting its video frame");
      restored.second = value;
    },
    async setIntroAudition(value) { restored.intro = value; },
    async play() { throw new Error("Window transitions must return paused"); } };
  const preview = createWorkbenchPreview(owner, { changed: value => { restored.detached = value; },
    introSettings: () => ({ introEnabled: true, introAuditionLoop: false, introPvStartSeconds: 0 }) });
  const router = preview.windowRouter;
  router.presenting = true;
  router.popup = { window: { closed: true }, abort: new AbortController(), preview: { destroy() {} },
    closingState: {
      clock: { currentTime: .4, observedAt: performance.now() - 2000, playing: true, duration: 12, rate: .5, playback: { rate: .5 } },
      intro: { active: true, playing: true, elapsed: 2.5, introAuditionLoop: true, introPvStartSeconds: .7 },
    } };
  await router.attach(true);
  assert.equal(restored.second, .4);
  assert.equal(restored.playback.rate, .5);
  assert.equal(restored.intro.elapsed, 2.5);
  assert.equal(restored.intro.playing, false);
  assert.equal(restored.intro.introAuditionLoop, true);
  assert.equal(restored.intro.introPvStartSeconds, .7);
  assert.equal(restored.detached, false);
  assert.equal(router.popup, null);
});

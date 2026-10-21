import assert from "node:assert/strict";
import { waitForAsync } from "./wait-async.mjs";

async function within(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function verifyEditorPlaybackControls(page, index, rendererBody) {
  const command = (id, args = {}) => page.evaluate(([index, id, args]) => editors[index].command(id, args), [index, id, args]);
  const state = () => page.evaluate(index => editors[index].getState(), index);
  for (const [id, expected] of [["timeline.pause", .75], ["preview.stop", 0]]) {
    await rendererBody.evaluate(async () => {
      const { BrowserVideoFrames } = await import("./browser-video.mjs");
      const probe = window.sdkFrameProbe = { ready: BrowserVideoFrames.prototype.ready };
      BrowserVideoFrames.prototype.ready = function (signal) {
        if (probe.waiting) return probe.ready.call(this, signal);
        probe.waiting = true;
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      };
    });
    try {
      const seeking = command("preview.seek", { second: .75 });
      void seeking.catch(() => {});
      await waitForAsync(rendererBody, () => window.sdkFrameProbe.waiting, undefined, { timeout: 5000 });
      await within(Promise.all([seeking, command(id)]), `Editor SDK ${id} must interrupt a pending seek`);
      const snapshot = await state();
      assert.equal(snapshot.playing, false); assert.equal(snapshot.currentTime, expected);
    } finally {
      await rendererBody.evaluate(async () => {
        const { BrowserVideoFrames } = await import("./browser-video.mjs");
        BrowserVideoFrames.prototype.ready = window.sdkFrameProbe.ready;
        delete window.sdkFrameProbe;
      });
    }
  }
  const before = await state();
  await rendererBody.evaluate(() => {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    const probe = window.sdkResumeProbe = { resume: Context.prototype.resume };
    Context.prototype.resume = function (...args) {
      probe.waiting = true;
      return new Promise((resolve, reject) => {
        probe.release = () => probe.resume.apply(this, args).then(resolve, reject);
      });
    };
  });
  try {
    const playing = command("preview.toggle");
    void playing.catch(() => {});
    await waitForAsync(rendererBody, () => window.sdkResumeProbe.waiting, undefined, { timeout: 5000 });
    await within(Promise.all([playing, command("preview.toggle")]), "Editor SDK toggle must cancel pending playback");
    const snapshot = await state();
    assert.equal(snapshot.playing, false); assert.equal(snapshot.currentTime, before.currentTime);
  } finally {
    await rendererBody.evaluate(() => {
      const Context = window.AudioContext ?? window.webkitAudioContext, probe = window.sdkResumeProbe;
      Context.prototype.resume = probe.resume; delete window.sdkResumeProbe;
      return probe.release?.();
    });
  }
}

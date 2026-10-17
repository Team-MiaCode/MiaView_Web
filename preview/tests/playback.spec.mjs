import test from "node:test";
import assert from "node:assert/strict";
import { PreviewAudio } from "../renderer/runtime.mjs";
import { DEFAULT_PLAYBACK, playbackSettings } from "../renderer/playback.mjs";

test("Playback bounds reject invalid changes before replacing the current settings", () => {
  const current = { ...DEFAULT_PLAYBACK, exportEndSeconds: 10 };
  assert.deepEqual(playbackSettings(current, { rate: .5, rangePlaybackEnabled: true, exportStartSeconds: 2, exportEndSeconds: 5 }, 10),
    { rate: .5, rangePlaybackEnabled: true, exportStartSeconds: 2, exportEndSeconds: 5 });
  for (const changes of [{ rate: 0 }, { rate: NaN }, { rate: "1" }, { exportStartSeconds: -1 }, { exportEndSeconds: 11 },
    { exportStartSeconds: 6, exportEndSeconds: 5 }, { rangePlaybackEnabled: "true" }, { unknown: true }])
    assert.throws(() => playbackSettings(current, changes, 10));
  assert.equal(current.rate, 1);
});

test("Audio rate changes keep the song clock and judgment scheduling aligned", () => {
  const sources = [];
  const context = {
    currentTime: 0, destination: {},
    createBufferSource() {
      const source = { playbackRate: { value: 1 }, connect() { return this; }, disconnect() {},
        start(...args) { this.startArgs = args; }, stop(second) { this.stopSecond = second; } };
      sources.push(source); return source;
    },
    createGain() { return { gain: { value: 1 }, connect() { return this; }, disconnect() {} }; },
  };
  const audio = new PreviewAudio(context);
  audio.track = { duration: 10 };
  audio.buffers.set("tap.wav", { duration: .2 });
  audio.duration = 10;
  audio.events = [{ second: 2, file: "tap.wav", gain: .1, nextSameKindSecond: -1 }];
  audio.setRate(.5);
  audio.start();
  assert.equal(sources[0].playbackRate.value, .5);
  assert.deepEqual(sources[0].startArgs, [.03, 0]);
  assert.equal(sources[0].stopSecond, 20.03);
  context.currentTime = 2.03;
  assert.ok(Math.abs(audio.currentSecond() - 1) < 1e-9);
  context.currentTime = 3.97;
  audio.schedule();
  assert.equal(sources[1].playbackRate.value, 1);
  assert.deepEqual(sources[1].startArgs, [4.03, 0]);
  const position = audio.currentSecond();
  audio.setRate(2);
  assert.equal(audio.offset, position);
  assert.equal([...sources].reverse().find(source => source.buffer === audio.track).playbackRate.value, 2);
  context.currentTime = 4.5;
  assert.ok(Math.abs(audio.currentSecond() - (position + 1)) < 1e-9);
  audio.pause();
  assert.equal(audio.playing, false);
  assert.equal(audio.voices.size, 0);
});

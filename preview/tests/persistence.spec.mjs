import test from "node:test";
import assert from "node:assert/strict";
import { coverPreferences } from "../services/cover-preferences.mjs";
import { normalizeSettings } from "../renderer/protocol.mjs";
import { wavHeader, wavPcm } from "../renderer/export-wav.mjs";
import { BrowserFiles } from "../services/browser-files.mjs";

test("Cover defaults share styles and retained assets while project paths stay local", () => {
  const result = coverPreferences({ outputFile: "one.jpg", backgroundPath: "/one.png", backgroundMode: 1,
    selectedDifficultyId: 5, cardShadow: true, cardFontBodyPath: "/font.otf" }, [{ imagePath: "/layer.png" }],
    ["/font.otf", "/layer.png", "/one.png"].map(path => ({ path })));
  assert.deepEqual(result.coverValues, { backgroundMode: 0, cardShadow: true, cardFontBodyPath: "/font.otf" });
  assert.deepEqual(result.coverFiles.map(file => file.path), ["/font.otf", "/layer.png"]);
});

test("Muri and firework controls enforce native parameter bounds", () => {
  assert.deepEqual(normalizeSettings({ handRadiusPx: 60, staticTapOnSlideThresholdMs: 250, fireworkBrightness: 1.2, wifiNeedC: true }),
    { handRadiusPx: 60, staticTapOnSlideThresholdMs: 250, fireworkBrightness: 1.2, wifiNeedC: true });
  for (const values of [{ handRadiusPx: 61 }, { staticTapOnSlideThresholdMs: 149 }, { fireworkBrightness: .49 }, { showTouchTrail: 1 }])
    assert.throws(() => normalizeSettings(values));
});

test("WAV output declares stereo PCM and clips/interleaves samples", () => {
  const header = new DataView(wavHeader(3));
  assert.equal(header.getUint32(40, true), 12); assert.equal(header.getUint16(22, true), 2);
  const samples = new DataView(wavPcm({ length: 3, getChannelData: channel => channel ? [1, -.5, 2] : [-1, .5, 0] }));
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => samples.getInt16(index * 2, true)), [-32768, 32767, 16384, -16384, 0, 32767]);
});

test("File pickers retain purpose and project directory identity across calls and cancellation", async () => {
  const calls = [], entries = new Map(), handle = { kind: "directory", name: "Music", async *values() {} };
  const assets = { get: async id => entries.get(id), put: async item => entries.set(item.id, item) };
  const files = new BrowserFiles({ assets, pickDirectory: async options => { calls.push(options); return handle; },
    pickOpenFile: async options => { calls.push(options); return [{ getFile: async () => "file" }]; } });
  await files.openFolder(); await files.openFolder(); assert.equal(calls[1].startIn, handle);
  assert.deepEqual(await files.openFiles({ purpose: "cover_image", projectId: "a", accept: ".png" }), ["file"]);
  assert.equal(calls[2].id, "cover_image-a");
  files.pickDirectory = async () => { throw new DOMException("cancel", "AbortError"); };
  assert.equal(await files.openFolder(), null); assert.equal(entries.size, 1);
});

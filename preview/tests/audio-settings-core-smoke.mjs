import { waitForAsync } from "./helpers/wait-async.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  const command = (id, args) => page.evaluate(({ id, args }) => document.getElementById("workbench").editor.command(id, args), { id, args });
  const initial = await command("audio.getSettings");
  assert.equal(initial.channels.global.percent, 30); assert.equal(initial.channels.answer.percent, 80);
  assert.equal(initial.gains.track, .3); assert.equal(initial.gains.answer, .24); assert.equal(initial.gains.judge, .09);
  await command("page.audio-settings");
  const global = page.locator('[data-channel="global"] input[type="range"]');
  assert.equal(await global.inputValue(), "30");
  await global.fill("50"); await global.dispatchEvent("input");
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.audio.channels.global.percent === 50);
  const half = await command("audio.getSettings");
  assert.equal(half.gains.track, .5); assert.equal(half.gains.answer, .4);
  const track = page.locator('[data-channel="track"] button');
  await track.click(); await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.audio.channels.track.muted);
  assert.equal((await command("audio.getSettings")).gains.track, 0);
  assert.equal(await page.locator('[data-channel="track"] input[type="range"]').inputValue(), "0");
  await track.click(); await page.waitForFunction(() => !document.getElementById("workbench").editor.workbench.documentSession.audio.channels.track.muted);
  assert.equal((await command("audio.getSettings")).channels.track.percent, 100);
  await command("audio.channelMuted", { key: "global", muted: true });
  const restoredByChannel = await command("audio.channelPercent", { key: "tap", percent: 40 });
  assert.equal(restoredByChannel.channels.global.percent, 50); assert.equal(restoredByChannel.gains.judge, .2);
  for (const key of ["global", "track", "answer", "tap", "ex", "break", "breakSlide", "slide", "touch", "firework", "intro"]) {
    const value = await command("audio.channelPercent", { key, percent: 63 });
    assert.equal(value.channels[key].percent, 63);
    assert.equal((await command("audio.channelMuted", { key, muted: true })).channels[key].percent, 0);
    assert.equal((await command("audio.channelMuted", { key, muted: false })).channels[key].percent, 63);
  }
  await command("audio.breakSlideTailCheerMuted", { value: true });
  const savedDefault = await command("audio.saveAsSoftwareDefault");
  await command("audio.channelPercent", { key: "track", percent: 10 });
  assert.deepEqual(await command("audio.restoreSoftwareDefault"), savedDefault);
  const rejected = await page.evaluate(async () => {
    const preview = document.getElementById("workbench").editor.preview;
    const cases = [["audio.channelPercent", { key: "track", percent: 101 }], ["audio.channelPercent", { key: "track", percent: 2.5 }],
      ["audio.channelMuted", { key: "typo", muted: true }], ["audio.restoreSettings", { settings: { track_volume: "1" } }]];
    return Promise.all(cases.map(async ([id, args]) => { try { await preview.audioCommand(id, args); return false; } catch { return true; } }));
  });
  assert.deepEqual(rejected, [true, true, true, true]);
  assert.deepEqual(await command("audio.getSettings"), savedDefault);
  const rendered = await page.evaluate(async gains => {
    const { PreviewAudio } = await import("./renderer/runtime.mjs");
    async function render(gains, kind) {
      const context = new OfflineAudioContext(1, 9600, 48000);
      const audio = new PreviewAudio(context); audio.setMix(gains);
      const buffer = context.createBuffer(1, 9600, 48000); buffer.getChannelData(0).fill(.5);
      audio.duration = .2;
      if (kind === "track") audio.track = buffer;
      else { audio.buffers.set("tone", buffer); audio.events = [{ kind, second: 0, file: "tone", gain: 1, nextSameKindSecond: -1 }]; }
      audio.start();
      const result = await context.startRendering();
      return result.getChannelData(0)[4800];
    }
    return { track: await render(gains, "track"), judge: await render(gains, "judge"), muted: await render({ ...gains, track: 0 }, "track") };
  }, savedDefault.gains);
  assert.ok(Math.abs(rendered.track - .5 * savedDefault.gains.track) < 1e-6);
  assert.ok(Math.abs(rendered.judge - .5 * savedDefault.gains.judge) < 1e-6);
  assert.equal(rendered.muted, 0);
  await page.reload(); await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  assert.deepEqual(await command("audio.getSettings"), savedDefault);
  await command("file.demo"); await command("preview.toggle");
  await waitForAsync(page, async () => (await document.getElementById("workbench").editor.preview.getState()).playing);
  await command("audio.breakSlideTailCheerMuted", { value: false });
  assert.equal((await page.evaluate(() => document.getElementById("workbench").editor.preview.getState())).playing, true);
  await command("preview.stop");
  assert.deepEqual(errors, []);
  const output = resolve("artifacts/audio-settings-core"); mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ initial, savedDefault, rendered, rejected, errors }, null, 2) + "\n");
  console.log("Native channel defaults, UI mute/restore, local defaults, invalid settings, WebAudio sample gains and playback passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/resources-core"); mkdirSync(output, { recursive: true });
function tone(seconds) {
  const samples = 24000 * seconds, wave = Buffer.alloc(44 + samples * 2);
  wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28); wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
  for (let index = 0; index < samples; index++) wave.writeInt16LE(Math.round(Math.sin(index / 24000 * 2 * Math.PI * 440) * 800), 44 + index * 2);
  return wave;
}
writeFileSync(resolve(output, "track.wav"), tone(12)); writeFileSync(resolve(output, "long.wav"), tone(40));
writeFileSync(resolve(output, "invalid.png"), "invalid image");
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    window.activeObjectUrls = new Set();
    URL.createObjectURL = blob => { const url = create(blob); activeObjectUrls.add(url); return url; };
    URL.revokeObjectURL = url => { activeObjectUrls.delete(url); revoke(url); };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  const rejection = await page.evaluate(async () => {
    try { await document.getElementById("workbench").editor.preview.setResources({ cover: "/ui/components/icons/app.png" }); }
    catch (error) { return error.message; }
  });
  assert.match(rejection, /document/);
  const command = (id, args) => page.evaluate(({ id, args }) => document.getElementById("workbench").editor.command(id, args), { id, args });
  const documentState = () => page.evaluate(() => document.getElementById("workbench").editor.preview.getDocument());
  const setResources = resources => page.evaluate(resources => document.getElementById("workbench").editor.preview.setResources(resources), resources);
  const state = () => page.evaluate(() => document.getElementById("workbench").editor.preview.getState());
  const video = page.frameLocator('.preview-container iframe').locator('#stage-video');
  const liveUrls = () => video.evaluate(() => [...window.activeObjectUrls]);
  await command("file.demo");
  await page.locator('.source-input').fill("(120){4}1,2,3,E"); await command("file.flushRecovery");
  const before = await documentState(); assert.equal(before.dirty, true);
  const chartDuration = (await state()).duration;
  const loaded = await setResources({ audio: "/artifacts/resources-core/track.wav", cover: "/ui/components/icons/app.png", video: "/tests/fixtures/bg-pattern.webm" });
  assert.deepEqual(await documentState(), before);
  assert.equal(loaded.duration, 12); assert.equal(loaded.media.audioAvailable, true);
  assert.equal(loaded.media.coverAvailable, true); assert.equal(loaded.media.videoAvailable, true);
  assert.equal(await video.evaluate(node => node.readyState >= 2 && node.videoWidth > 0 && node.muted), true);
  assert.equal((await liveUrls()).length, 1);
  const renderer = page.frames().find(frame => frame.url().includes("/renderer/index.html"));
  await renderer.evaluate(async () => {
    const { BrowserVideoFrames } = await import("./browser-video.mjs");
    window.restoreVideoReady = BrowserVideoFrames.prototype.ready;
    BrowserVideoFrames.prototype.ready = function (signal) {
      window.waitingVideoPresentation = true;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    };
  });
  let pausedFrameSeek, frameWaitTimeout;
  try {
    const seeking = page.evaluate(() => document.getElementById("workbench").editor.preview.seek(.75));
    void seeking.catch(() => {});
    await waitForAsync(renderer, () => window.waitingVideoPresentation, undefined, { timeout: 5000 });
    pausedFrameSeek = await page.evaluate(() => document.getElementById("workbench").editor.preview.pause());
    await Promise.race([seeking, new Promise((_, reject) => {
      frameWaitTimeout = setTimeout(() => reject(new Error("Pause must release pending video presentation")), 5000);
    })]);
    assert.equal(pausedFrameSeek.playing, false); assert.equal(pausedFrameSeek.currentTime, .75);
    assert.equal((await state()).currentTime, .75);
  } finally {
    clearTimeout(frameWaitTimeout);
    await renderer.evaluate(async () => {
      const { BrowserVideoFrames } = await import("./browser-video.mjs");
      BrowserVideoFrames.prototype.ready = window.restoreVideoReady;
      delete window.restoreVideoReady; delete window.waitingVideoPresentation;
    });
  }
  await command("timeline.viewport");
  assert.ok(await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState.waveformBars.length > 0));
  await page.evaluate(async () => { const preview = document.getElementById("workbench").editor.preview; await preview.seek(1); await preview.play(); });
  const beforeReplacement = await state(), replacementStarted = performance.now();
  const playing = await setResources({ video: "/tests/fixtures/bg-pattern.webm" });
  const replacementDurationMs = performance.now() - replacementStarted;
  assert.equal(playing.playing, true);
  assert.ok(playing.currentTime >= beforeReplacement.currentTime && playing.currentTime < playing.duration,
    `Media replacement retains playing progress: ${JSON.stringify({ beforeReplacement, playing, replacementDurationMs })}`);
  assert.equal((await liveUrls()).length, 1);
  let releaseVideo, videoRequested;
  const videoGate = new Promise(resolve => { releaseVideo = resolve; });
  const videoRequest = new Promise(resolve => { videoRequested = resolve; });
  const videoRoute = "**/tests/fixtures/bg-pattern.webm";
  await page.route(videoRoute, async route => { videoRequested(); await videoGate; await route.continue(); });
  let pausedReplacement;
  try {
    const preparing = setResources({ video: "/tests/fixtures/bg-pattern.webm" });
    await videoRequest;
    const paused = await page.evaluate(() => document.getElementById("workbench").editor.preview.pause());
    assert.equal(paused.playing, false, "pause completes while media preparation is pending");
    releaseVideo();
    pausedReplacement = await preparing;
    assert.equal(pausedReplacement.playing, false);
    assert.equal(pausedReplacement.currentTime, paused.currentTime, "media completion retains the requested pause position");
  } finally { releaseVideo(); await page.unroute(videoRoute); }
  const oldVideo = await video.evaluate(node => node.src);
  const invalid = await page.evaluate(async () => {
    try { await document.getElementById("workbench").editor.preview.setResources({ audio: "/artifacts/resources-core/long.wav", cover: "/artifacts/resources-core/invalid.png", video: "/tests/fixtures/bg-pattern.webm" }); }
    catch (error) { return error.message; }
  });
  assert.ok(invalid); assert.equal((await state()).duration, 12);
  assert.equal(await video.evaluate(node => node.src), oldVideo); assert.equal((await liveUrls()).length, 1);
  assert.deepEqual(await documentState(), before);
  await page.evaluate(() => document.getElementById("workbench").editor.preview.pause());
  const removedVideo = await setResources({ video: null });
  assert.equal(removedVideo.media.videoAvailable, false); assert.equal(removedVideo.media.coverAvailable, true);
  assert.equal((await liveUrls()).length, 0); assert.equal(await video.isVisible(), false);
  const removed = await setResources({ audio: null, cover: null });
  assert.equal(removed.media.audioAvailable, false); assert.equal(removed.media.coverAvailable, false);
  assert.equal(removed.duration, chartDuration); assert.deepEqual(await documentState(), before);
  await command("document.metadataVideoPath", { value: "assets/pv.webm" });
  assert.equal((await documentState()).metadataVideoPath, "assets/pv.webm");
  const saved = await page.evaluate(() => document.getElementById("workbench").editor.preview.getDocumentSaveText());
  assert.match(saved.sourceText, /&video=assets\/pv\.webm/);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ before, loaded, playing, beforeReplacement, replacementDurationMs, pausedReplacement, pausedFrameSeek, removed, invalid, errors }, null, 2) + "\n");
  console.log("Real media decoding, waveform replacement, document/save-point retention, playback, rejected batches, PV URL cleanup and video metadata passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

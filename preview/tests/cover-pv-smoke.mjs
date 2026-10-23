import { observeFilePicker } from "./helpers/file-picker.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";
import { observeVideoDecoders, decoderSnapshot } from "./helpers/video-decoder-probe.mjs";
import { Input, BufferSource, ALL_FORMATS } from "../renderer/vendor/mediabunny/index.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium";
const software = process.env.MIACODE_SOFTWARE_VIDEO === "1";
const output = resolve("artifacts/cover-pv", `${name}${software ? "-software" : ""}`), folder = join(output, "Project"); mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "maidata.txt"), `&title=Cover PV\n&video=clip.webm\n&inote_5=(120){4}${",".repeat(80)}1,E\n`);
copyFileSync("tests/fixtures/bg-pattern.webm", join(folder, "clip.webm"));
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(browsers, name);
const errors = [], result = {};
const fixture = new Input({ source: new BufferSource(readFileSync("tests/fixtures/bg-pattern.webm")), formats: ALL_FORMATS });
const fixtureDuration = await fixture.computeDuration(); fixture.dispose();
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  await observeVideoDecoders(page);
  await page.addInitScript(() => {
    window.showDirectoryPicker = undefined;
    window.objectURLs = new Set();
    window.mediaURLs = new Set();
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); objectURLs.add(url); if (blob.type !== "application/javascript") mediaURLs.add(url); return url; };
    URL.revokeObjectURL = url => { objectURLs.delete(url); mediaURLs.delete(url); revoke(url); };
  });
  await observeFilePicker(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  const command = (id, args = {}) => page.evaluate(([id, args]) => document.getElementById("workbench").editor.command(id, args), [id, args]);
  if (software) await command("preferences.performance", { videoDecodePrefersSoftware: true });
  const picker = page.waitForEvent("filechooser");
  await page.evaluate(() => { window.opening = document.getElementById("workbench").editor.command("file.open"); });
  await (await picker).setFiles(folder); await page.evaluate(() => opening);
  await command("page.cover"); await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.ready);
  result.objectURLsBaseline = await page.frameLocator(".cover-editor iframe").locator("body").evaluate(() => mediaURLs.size);
  await page.locator(".cover-menu summary").last().click(); await page.getByRole("button", { name: "添加谱面帧", exact: true }).click();
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.some(layer => layer.kind === "chartFrame"));
  await page.evaluate(async () => {
    window.cover = document.querySelector(".cover-editor").coverRenderer.preview;
    const state = await cover.getCoverComposition(); window.frameKey = state.activeLayerKey;
    await cover.setCoverComposition({ outputWidth: 512, outputHeight: 512, backgroundMode: 2 });
    await cover.coverCommand("cover.layer", { key: "card", visible: false });
    window.reference = document.createElement("video"); reference.muted = true; reference.preload = "auto";
    const loaded = new Promise((resolve, reject) => { reference.onloadeddata = resolve; reference.onerror = reject; });
    reference.src = "/tests/fixtures/bg-pattern.webm"; await loaded;
    window.pvFrames = [];
  });
  const capture = (mode, second, patch = {}) => page.evaluate(async ({ mode, second, patch }) => {
    await cover.coverCommand("cover.layer", { key: frameKey, sizeFraction: 1, frameBgMode: mode, frameBgBrightness: 1, frameSeconds: second, ...patch });
    const { blob } = await cover.exportCover({ type: "image/png" }); pvFrames.push(blob);
    const image = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); image.close();
    const samples = [[256, 256], [256, 90], [170, 220]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
    const outside = [...context.getImageData(0, 0, 1, 1).data];
    if (Math.abs(reference.currentTime - second) > .00001) {
      const sought = new Promise(resolve => reference.addEventListener("seeked", resolve, { once: true })); reference.currentTime = second; await sought;
    }
    context.fillStyle = "#000"; context.fillRect(0, 0, 512, 512);
    const scale = (mode === "pvFit" ? Math.min : Math.max)(512 / reference.videoWidth, 512 / reference.videoHeight);
    const width = reference.videoWidth * scale, height = reference.videoHeight * scale;
    context.drawImage(reference, (512 - width) / 2, (512 - height) / 2, width, height);
    const expected = [[256, 256], [256, 90], [170, 220]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
    return { samples, expected, outside, hash };
  }, { mode, second, patch });
  result.metadata = await page.evaluate(duration => ({ duration, browserDuration: Number.isFinite(reference.duration) ? reference.duration : null,
    width: reference.videoWidth, height: reference.videoHeight }), fixtureDuration);
  const early = Math.min(.1, result.metadata.duration / 10), later = result.metadata.duration * .65;
  result.fill = await capture("pv", early); result.fit = await capture("pvFit", early);
  result.later = await capture("pv", later);
  for (const view of [result.fill, result.fit, result.later]) for (let index = 0; index < view.samples.length; index++) {
    for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(view.samples[index][channel] - view.expected[index][channel]) <= 7,
      `PV composition sample ${index}/${channel}: ${JSON.stringify(view)}`);
    assert.equal(view.samples[index][3], 255);
  }
  assert.notEqual(result.fill.hash, result.fit.hash, "PV fill and fit produce different framing");
  for (const view of [result.fill, result.fit, result.later]) assert.equal(view.outside[3], 0, "PV remains clipped to the playfield disk");
  assert.notEqual(result.fill.hash, result.later.hash, "PV follows the layer's selected time");
  const dimmed = await capture("pv", later, { frameBgBrightness: .5 });
  for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(dimmed.samples[0][channel] - result.later.samples[0][channel] * .5) <= 4);
  result.dimmed = dimmed.samples;
  await page.evaluate(async () => {
    await cover.coverCommand("cover.layer", { key: frameKey, frameSeconds: .1, frameBgBrightness: 1 });
    await cover.coverCommand("cover.toggleActiveLayerPlayback");
  });
  await waitForAsync(page, async () => {
    const value = await cover.getCoverComposition(), layer = value.layout.layers.find(layer => layer.key === frameKey);
    return value.chartFramePlaying && layer.frameSeconds > .5 && layer.pvFrameRevision > 3;
  });
  const exported = await page.evaluate(async () => {
    const { blob } = await cover.exportCover(); pvFrames.push(blob); return cover.getCoverComposition();
  });
  assert.equal(exported.chartFramePlaying, false); result.exportedFrame = exported.layout.layers.find(layer => layer.key === exported.activeLayerKey);
  const before = result.exportedFrame.pvFrameRevision;
  await page.evaluate(async () => {
    const copy = await cover.coverCommand("cover.duplicateActiveLayer"); window.copyKey = copy.activeLayerKey;
    await cover.coverCommand("cover.layer", { key: copyKey, frameSeconds: 1, nx: .75, sizeFraction: .3 });
    await cover.coverCommand("cover.selectLayerKey", { key: frameKey });
    await cover.coverCommand("cover.layer", { key: frameKey, frameSeconds: .1 });
  });
  const independent = await page.evaluate(() => cover.getCoverComposition());
  assert.equal(independent.layout.layers.find(layer => layer.key !== "card" && layer.key !== independent.activeLayerKey).frameSeconds, 1);
  assert.ok(independent.layout.layers.find(layer => layer.key === independent.activeLayerKey).pvFrameRevision > before);
  const images = await page.evaluate(async () => Promise.all(pvFrames.map(async blob => [...new Uint8Array(await blob.arrayBuffer())])));
  for (let index = 0; index < images.length; index++) writeFileSync(join(output, `frame-${index}.png`), Buffer.from(images[index]));
  await page.evaluate(() => document.querySelector(`.cover-layer-row[data-key="${frameKey}"]`).click());
  await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.pending);
  await page.screenshot({ path: join(output, "pv-layers.png") });
  const nativeFrame = page.frameLocator(".cover-editor iframe").locator("body");
  result.objectURLsBefore = await nativeFrame.evaluate(() => mediaURLs.size);
  result.runtimeURLs = await nativeFrame.evaluate(() => objectURLs.size - mediaURLs.size); assert.ok(result.runtimeURLs <= 1);
  if (software) {
    result.decoders = await nativeFrame.evaluate(decoderSnapshot);
    assert.ok(result.decoders.frames > 0); assert.ok(result.decoders.configurations.length > 0);
    assert.ok(result.decoders.configurations.every(value => value === "prefer-software"));
  }
  assert.equal(result.objectURLsBefore - result.objectURLsBaseline, 2);
  await page.evaluate(async () => {
    const doc = await cover.getDocument(); await cover.load({ maidata: doc.sourceText });
  });
  result.objectURLsAfter = await nativeFrame.evaluate(() => mediaURLs.size);
  assert.equal(result.objectURLsAfter, result.objectURLsBaseline);
  assert.equal(await nativeFrame.evaluate(() => document.body.classList.contains("cover-view")), false);
  const restored = await page.evaluate(() => cover.getCoverComposition());
  assert.ok(restored.layout.layers.every(layer => layer.pvFrameRevision === -1));
  if (software) {
    const released = await nativeFrame.evaluate(decoderSnapshot); assert.equal(released.active, 0); assert.equal(released.frames, 0);
  }
  await command("page.metadata");
  await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.pending);
  assert.equal((await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition())).chartFramePlaying, false);
  await page.evaluate(() => document.getElementById("workbench").editor.viewState.closeEditor("cover"));
  assert.equal(await page.locator(".cover-editor iframe").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Cover PV source, exact frame pixels, fill/fit, brightness, playback, export and independent layer times passed");
} catch (error) {
  result.failure = await page?.evaluate(async () => ({ composition: await cover.getCoverComposition(), state: (await cover.getState()).videoPresentation })).catch(() => null);
  throw error;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify({ ...result, errors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

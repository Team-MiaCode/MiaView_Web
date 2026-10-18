import { launchPreviewBrowser } from "./preview-browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const browserName = process.env.MIACODE_BROWSER || "chromium";
const output = resolve("artifacts/cover-chart-frame", browserName); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(browsers, browserName);
const errors = [], result = {};
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  const command = (id, args = {}) => page.evaluate(([id, args]) => document.getElementById("workbench").editor.command(id, args), [id, args]);
  const state = () => page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition());
  const coverCommand = (id, args = {}) => page.evaluate(([id, args]) => document.querySelector(".cover-editor").coverRenderer.preview.coverCommand(id, args), [id, args]);
  await command("file.demo"); await command("page.cover");
  await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.ready);
  // Cover frames use the existing parser/scene and do not initialize an audio engine.
  await page.frameLocator(".cover-editor iframe").locator("body").evaluate(() => {
    window.AudioContext = class { constructor() { throw new Error("Unexpected cover audio engine"); } };
    window.webkitAudioContext = window.AudioContext;
  });
  await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.run(() => document.querySelector(".cover-editor").coverRenderer.ensureChart()));
  await page.locator(".cover-menu summary").last().click(); await page.getByRole("button", { name: "添加谱面帧", exact: true }).click();
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.some(layer => layer.kind === "chartFrame"));
  let value = await state(); const key = value.activeLayerKey;
  await page.locator(`.cover-layer-row[data-key="${key}"]`).click();
  assert.ok(value.chartFrameDuration > 2);
  await coverCommand("cover.layer", { key: "card", visible: false });
  await coverCommand("cover.layer", { key, sizeFraction: .9, frameSeconds: 0 });
  await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.preview.setCoverComposition({ backgroundMode: 2 }));
  const capture = () => page.evaluate(async () => {
    const { blob } = await document.querySelector(".cover-editor").coverRenderer.preview.exportCover({ mimeType: "image/png" });
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
    const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0); bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 128) opaque++;
    return { hash, opaque };
  });
  result.start = await capture(); assert.ok(result.start.opaque > 1000, "native chart scene draws visible pixels");
  await coverCommand("cover.layer", { key, frameSeconds: 1 }); result.later = await capture();
  assert.notEqual(result.start.hash, result.later.hash, "native chart notes follow the selected time");
  await coverCommand("cover.layer", { key, frameSeconds: .5 });
  result.phase = "transport";
  await page.evaluate(() => {
    const preview = document.querySelector(".cover-editor").coverRenderer.preview, command = preview.coverCommand.bind(preview);
    window.coverCommandTrace = [];
    window.coverInputTrace = [];
    for (const type of ["pointerdown", "pointerup", "click"]) document.addEventListener(type, event => {
      coverInputTrace.push({ type, tag: event.target.tagName, label: event.target.getAttribute("aria-label"),
        className: String(event.target.className) });
    }, { capture: true });
    preview.coverCommand = async (id, args) => {
      const state = await command(id, args);
      coverCommandTrace.push({ id, args, playing: state.chartFramePlaying, active: state.activeLayerKey,
        seconds: state.layout.layers.find(layer => layer.key === state.activeLayerKey)?.frameSeconds });
      return state;
    };
  });
  await page.locator(".cover-editor iframe").evaluate(frame => { frame.style.visibility = "hidden"; });
  await page.getByRole("button", { name: "播放 / 暂停（空格）", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.chartFramePlaying
    && Number(document.querySelector("[data-cover-frame-time]").value) > .8);
  await page.getByRole("button", { name: "播放 / 暂停（空格）", exact: true }).click();
  value = await state(); assert.equal(value.chartFramePlaying, false);
  result.paused = value.layout.layers.find(layer => layer.key === key).frameSeconds;
  assert.ok(result.paused > .8);
  await page.locator(".cover-editor iframe").evaluate(frame => { frame.style.visibility = ""; });
  // Space and arrow seeking also work when the native canvas owns focus.
  const canvas = page.frameLocator(".cover-editor iframe").locator(".qt-window").first(); await canvas.click();
  assert.equal((await state()).activeLayerKey, key);
  result.keyboardFocus = await page.evaluate(() => document.activeElement?.matches(".cover-editor iframe"));
  assert.equal(result.keyboardFocus, true, "canvas pointer input transfers keyboard focus into the cover renderer");
  await page.keyboard.press("Space");
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).chartFramePlaying);
  await page.keyboard.press("Space");
  await waitForAsync(page, async () => !(await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).chartFramePlaying);
  const beforeSeek = (await state()).layout.layers.find(layer => layer.key === key).frameSeconds;
  await page.keyboard.press("ArrowRight");
  value = await state(); assert.ok(value.layout.layers.find(layer => layer.key === key).frameSeconds > beforeSeek);
  const duplicate = await coverCommand("cover.duplicateActiveLayer"), copy = duplicate.activeLayerKey;
  await coverCommand("cover.layer", { key: copy, frameSeconds: 2, nx: .75, sizeFraction: .3 });
  await coverCommand("cover.selectLayerKey", { key });
  value = await state(); assert.equal(value.layout.layers.find(layer => layer.key === copy).frameSeconds, 2);
  result.layers = value.layout.layers;
  await page.locator(`.cover-layer-row[data-key="${key}"]`).click();
  await page.locator(`.cover-layer-row[data-key="${copy}"]`).waitFor();
  await page.screenshot({ path: join(output, "frames.png") });
  await coverCommand("cover.toggleActiveLayerPlayback"); await command("page.metadata");
  await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.pending);
  assert.equal((await state()).chartFramePlaying, false);
  assert.equal(await page.locator(".cover-page").isVisible(), false);
  await page.evaluate(() => document.getElementById("workbench").editor.viewState.closeEditor("cover"));
  assert.equal(await page.locator(".cover-editor iframe").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Native cover chart pixels, independent frame positions, transport and canvas keyboard passed");
} catch (error) {
  result.failure = String(error);
  if (page) {
    result.details = await page.evaluate(async () => ({ trace: window.coverCommandTrace, input: window.coverInputTrace,
      canvas: document.querySelector(".cover-editor iframe").getBoundingClientRect().toJSON(),
      state: await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition(),
      status: document.getElementById("workbench").editor.workbench.statusLabel.textContent })).catch(() => null);
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify({ ...result, errors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

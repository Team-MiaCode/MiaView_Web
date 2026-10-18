import { launchPreviewBrowser } from "./preview-browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", software = process.env.MIACODE_SOFTWARE_VIDEO === "1";
const output = resolve("artifacts/preview-window", `${name}${software ? "-software" : ""}`); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(browsers, name); const errors = [], results = {};
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(90000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  const command = (id, args = {}) => page.evaluate(([id, args]) => document.getElementById("workbench").editor.command(id, args), [id, args]);
  const state = () => page.evaluate(() => document.getElementById("workbench").editor.preview.getState());
  const doc = () => page.evaluate(() => document.getElementById("workbench").editor.preview.getDocument());
  if (software) await command("preferences.performance", { videoDecodePrefersSoftware: true });
  const opened = async () => {
    const event = page.waitForEvent("popup"); await page.getByRole("button", { name: "分离预览", exact: true }).click();
    const popup = await event; popup.on("pageerror", error => errors.push(error.message));
    try { await waitForAsync(page, () => document.getElementById("workbench").editor.preview.windowRouter.presenting); }
    catch (error) {
      results.opening = await page.evaluate(() => ({ status: document.getElementById("workbench").editor.workbench.statusLabel.textContent,
        popup: Boolean(document.getElementById("workbench").editor.preview.windowRouter.popup) }));
      await popup.screenshot({ path: join(output, "opening.png") }); throw error;
    }
    return popup;
  };
  await command("file.demo"); await command("preview.seek", { second: .4 });
  await command("preview.values", { showTimestamp: false });
  await page.evaluate(async () => {
    const wave = new ArrayBuffer(44 + 24000 * 12 * 2), view = new DataView(wave), bytes = new Uint8Array(wave);
    const text = (offset, value) => [...value].forEach((value, index) => bytes[offset + index] = value.charCodeAt(0));
    text(0,"RIFF");view.setUint32(4,wave.byteLength-8,true);text(8,"WAVEfmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,24000,true);view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,wave.byteLength-44,true);
    const [cover, video] = await Promise.all([fetch("/ui/components/icons/app.png").then(response=>response.blob()),fetch("/tests/fixtures/bg-pattern.webm").then(response=>response.blob())]);
    await document.getElementById("workbench").editor.preview.setResources({audio:new File([wave],"track.wav",{type:"audio/wav"}), cover, video});
  });
  const before = await doc(); results.documentGeneration = before.documentOpenGeneration;
  const popup = await opened();
  assert.equal((await doc()).documentOpenGeneration, before.documentOpenGeneration);
  assert.equal((await state()).playing, false); assert.ok(Math.abs((await state()).currentTime - .4) < .02);
  assert.deepEqual((await state()).media, {hidePv:false,audioAvailable:true,coverAvailable:true,videoAvailable:true});
  assert.equal((await state()).videoPresentation.decoder, software ? "software" : "browser");
  assert.equal(await popup.locator("#preview-window-attach").count(), 1);
  results.phase = "play-button";
  await popup.getByRole("button", { name: "播放", exact: true }).click();
  await waitForAsync(page, async () => (await document.getElementById("workbench").editor.preview.getState()).playing);
  assert.equal(await page.evaluate(async () => (await document.getElementById("workbench").editor.preview.windowRouter.owner.getState()).playing), false);
  await command("document.metadataTitle", { value: "Detached preview edit" });
  await waitForAsync(page, async () => (await document.getElementById("workbench").editor.preview.windowRouter.popup.preview.getDocument()).title === "Detached preview edit");
  assert.match(await popup.title(), /Detached preview edit/);
  await command("preview.rate", { rate: .5 }); assert.equal((await state()).playback.rate, .5);
  await page.evaluate(() => document.getElementById("workbench").editor.preview.pause());
  await popup.frameLocator("iframe").locator(".qt-window").first().click();
  results.phase = "canvas-keyboard";
  await popup.keyboard.press("Control+Shift+X");
  await waitForAsync(page, async () => (await document.getElementById("workbench").editor.preview.getState()).playing);
  await popup.keyboard.press("Control+Shift+X");
  await waitForAsync(page, async () => !(await document.getElementById("workbench").editor.preview.getState()).playing);
  for (const size of [{ width: 520, height: 900 }, { width: 1200, height: 420 }]) {
    await popup.setViewportSize(size);
    await waitForAsync(page, async () => {
      const router = document.getElementById("workbench").editor.preview.windowRouter, native = await router.popup.preview.getState();
      const bounds = router.popup.window.document.getElementById("preview-window-stage").getBoundingClientRect();
      return Math.abs(native.resolution.width - Math.min(bounds.width, bounds.height)) <= 2;
    });
    const overflow = await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
    assert.equal(overflow, false);
    await waitForAsync(page, async () => !(await document.getElementById("workbench").editor.preview.getState()).settings.showTimestamp);
  }
  await popup.screenshot({ path: join(output, "detached.png") });
  await command("page.export");
  await command("export.settings", { introEnabled: true, introPvPreview: true, introPvStartSeconds: .2, introAuditionLoop: true });
  await command("export.toggleIntroAudition");
  await page.evaluate(() => document.getElementById("workbench").editor.preview.setSettings({ touchPadAuthoringContext: false }));
  await waitForAsync(page, async () => (await document.getElementById("workbench").editor.preview.getState()).introAudition?.elapsed > .3);
  const paused = await state(); await popup.getByRole("button", { name: "嵌回编辑器", exact: true }).click();
  await waitForAsync(page, () => !document.getElementById("workbench").editor.preview.windowRouter.presenting);
  assert.equal((await doc()).documentOpenGeneration, before.documentOpenGeneration);
  assert.equal((await state()).playback.rate, .5); assert.ok(Math.abs((await state()).currentTime - paused.currentTime) < .1);
  const restoredIntro = (await state()).introAudition;
  assert.equal(restoredIntro.playing, true); assert.equal(restoredIntro.introAuditionLoop, true);
  assert.ok(restoredIntro.elapsed >= paused.introAudition.elapsed - .1);
  await page.evaluate(() => document.getElementById("workbench").editor.preview.setIntroAudition({ enabled: false }));
  results.phase = "window-close";
  const second = await opened(); await command("preview.toggle");
  const running = await state(); assert.equal(running.playing, true);
  await page.evaluate(() => { window.closingPreview = document.getElementById("workbench").editor.preview.windowRouter.popup; });
  results.closing = await page.evaluate(() => ({ ...document.getElementById("workbench").editor.preview.windowRouter.popup.clock }));
  await second.close({ runBeforeUnload: true });
  await waitForAsync(page, async () => !document.getElementById("workbench").editor.preview.windowRouter.presenting && (await document.getElementById("workbench").editor.preview.getState()).playing);
  assert.equal(await page.evaluate(() => window.closingPreview.closingState.clock.playing), true);
  results.restored = await state(); assert.ok(results.restored.currentTime >= running.currentTime - .1);
  await page.evaluate(() => document.getElementById("workbench").editor.preview.pause());
  results.phase = "document-close";
  const third = await opened(); await command("preview.toggle");
  const closing = command("file.close");
  await page.getByRole("button", { name: "放弃修改", exact: true }).click(); await closing;
  assert.equal((await doc()).hasDocument, false);
  assert.equal(await page.evaluate(() => document.getElementById("workbench").editor.preview.windowRouter.popup), null);
  await third.waitForEvent("close").catch(error => { if (!third.isClosed()) throw error; });
  assert.equal(third.isClosed(), true);
  assert.deepEqual(errors, []); console.log("Detached controls, document ownership, edits, keyboard, responsive window and playback restoration passed");
} catch (error) {
  results.failure = await page?.evaluate(async () => {
    const editor = document.getElementById("workbench").editor, router = editor.preview.windowRouter;
    return { status: editor.workbench.statusLabel.textContent, presenting: router.presenting, attaching: router.attaching,
      popup: Boolean(router.popup), clock: router.popup?.clock, closing: window.closingPreview?.closingState,
      activation: navigator.userActivation.hasBeenActive, state: await editor.preview.getState() };
  }).catch(() => null);
  console.error(JSON.stringify({ phase: results.phase, failure: results.failure, errors }));
  throw error;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify({ ...results, errors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

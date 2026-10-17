import { launchPreviewBrowser } from "./preview-browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";
import { observeVideoDecoders, decoderSnapshot } from "./helpers/video-decoder-probe.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", output = resolve("artifacts/performance-settings", name);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(browsers, name); const errors = [], results = {};
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(120000);
  page.on("pageerror", error => errors.push(error.message));
  await observeVideoDecoders(page);
  const base = `http://127.0.0.1:${server.address().port}`;
  const mount = async () => {
    await page.addStyleTag({ url: `${base}/ui/components/theme.css` }); await page.addStyleTag({ url: `${base}/page.css` });
    await page.evaluate(async () => {
      const { createWorkbench } = await import("/app.mjs"), root = document.createElement("main"); root.className = "workbench";
      document.body.replaceChildren(root); window.editor = createWorkbench(root, { preview: { resolution: { width: 320, height: 320 } } });
      window.addEventListener("pagehide", () => editor.destroy(), { once: true }); await editor.ready;
    });
  };
  await page.goto(`${base}/tests/host.html`); await mount();
  const command = (id, args = {}) => page.evaluate(([id, args]) => editor.command(id, args), [id, args]);
  const state = () => page.evaluate(() => editor.preview.getState());
  await command("file.demo");
  await page.evaluate(async () => {
    const media = await import("/renderer/vendor/mediabunny/index.mjs"), target = new media.BufferTarget();
    const output = new media.Output({ format: new media.WebMOutputFormat(), target });
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d"), source = new media.CanvasSource(canvas, { codec: "vp8", bitrate: 200000 });
    output.addVideoTrack(source, { frameRate: 60 }); await output.start();
    for (let frame = 0; frame < 360; ++frame) {
      context.fillStyle = `rgb(${frame % 200},80,${255 - frame % 200})`; context.fillRect(0, 0, 128, 128); await source.add(frame / 60, 1 / 60);
    }
    await output.finalize(); window.pv = new Blob([target.buffer], { type: "video/webm" });
    await editor.preview.setResources({ video: pv });
  });
  results.phase = "software";
  const generation = await page.evaluate(async () => (await editor.preview.getDocument()).documentOpenGeneration);
  await command("page.preferences"); await page.getByRole("tab", { name: "性能", exact: true }).click();
  await page.getByLabel("视频解码", { exact: true }).selectOption("true");
  await waitForAsync(page, async () => (await editor.preview.getState()).videoPresentation.decoder === "software");
  assert.equal(await page.evaluate(async () => (await editor.preview.getDocument()).documentOpenGeneration), generation);
  const renderer = page.frames().find(frame => frame.url().includes("/renderer/index.html"));
  const configurations = await renderer.evaluate(() => decoderConfigurations);
  assert.ok(configurations.length > 0); assert.ok(configurations.every(value => value === "prefer-software"));
  await editorSeek(.5);
  async function editorSeek(second) {
    await page.evaluate(second => editor.preview.seek(second), second);
    await waitForAsync(page, async second => {
      const state = await editor.preview.getState(); return Math.abs(state.videoPresentation.timestamp - second) <= 1 / 60 + .001;
    }, second);
  }
  const pixel = await renderer.locator("#stage-pv").evaluate(canvas => [...canvas.getContext("2d").getImageData(160, 160, 1, 1).data]);
  assert.ok(Math.abs(pixel[0] - 30) < 8 && Math.abs(pixel[1] - 80) < 8 && Math.abs(pixel[2] - 225) < 8, JSON.stringify(pixel));
  results.pixel = pixel;
  await page.evaluate(async () => {
    await editor.preview.play();
    await Promise.all([editor.command("preferences.performance", { videoDecodePrefersSoftware: false }),
      editor.command("preferences.performance", { canvasFrameRateMode: 0 }),
      editor.command("preferences.performance", { videoDecodePrefersSoftware: true })]);
  });
  assert.equal((await state()).playing, true); assert.equal((await state()).performance.videoDecodePrefersSoftware, true);
  assert.equal((await state()).maxFps, 30); await page.evaluate(() => editor.preview.pause());
  assert.equal(await page.getByLabel("画布帧率", { exact: true }).inputValue(), "0");
  for (const [label, field] of [["画布帧率", "canvasFrameRateMode"], ["PV 帧率", "stageMediaFrameRateMode"], ["时间轴帧率", "timelineFrameRateMode"]]) {
    await page.getByLabel(label, { exact: true }).selectOption("0");
    await waitForAsync(page, field => editor.viewState.preferences[field] === 0, field);
  }
  assert.equal((await state()).maxFps, 30);
  assert.equal((await state()).performance.stageMediaFrameRateMode, 0);
  await command("page.open", { key: "difficulty:5" });
  const sample = async mode => {
    await command("preferences.performance", { canvasFrameRateMode: mode, stageMediaFrameRateMode: mode, timelineFrameRateMode: mode });
    await page.evaluate(async () => {
      await editor.preview.pause(); await editor.preview.seek(.3);
      window.timelineTicks = 0; window.playheadObserver?.disconnect();
      window.playheadObserver = new MutationObserver(records => { timelineTicks += records.filter(record => record.attributeName === "x1" && record.target.getAttribute("data-overlay") === "playheadLine").length; });
      playheadObserver.observe(editor.workbench.timelineView.root, { attributes: true, subtree: true }); await editor.preview.play();
    });
    const before = await state(), timelineBefore = await page.evaluate(() => ({ ticks: timelineTicks, now: performance.now() }));
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1200)));
    const after = await state(), timelineAfter = await page.evaluate(() => ({ ticks: timelineTicks, now: performance.now() }));
    const pvFrames = after.videoPresentation.frames - before.videoPresentation.frames, ticks = timelineAfter.ticks - timelineBefore.ticks;
    const pvSeconds = after.currentTime - before.currentTime, timelineSeconds = (timelineAfter.now - timelineBefore.now) / 1000;
    await page.evaluate(() => editor.preview.pause()); return { pvFrames, timelineTicks: ticks, pvSeconds, timelineSeconds,
      pvFps: pvFrames / pvSeconds, timelineFps: ticks / timelineSeconds };
  };
  results.slow = await sample(0); results.fast = await sample(1);
  assert.ok(results.slow.pvFps >= 25 / 1.2 && results.slow.pvFps <= 39 / 1.2, JSON.stringify(results.slow));
  assert.ok(results.fast.pvFps > results.slow.pvFps + 10 / 1.2, JSON.stringify(results.fast));
  assert.ok(results.slow.timelineFps >= 25 / 1.2 && results.slow.timelineFps <= 40 / 1.2, JSON.stringify(results.slow));
  assert.ok(results.fast.timelineFps > results.slow.timelineFps + 10 / 1.2, JSON.stringify(results.fast));
  results.phase = "persistence";
  await command("preferences.performance", { canvasFrameRateMode: 2, stageMediaFrameRateMode: 0, timelineFrameRateMode: 2 });
  assert.equal((await state()).maxFps, 120);
  await page.reload(); await mount();
  const restored = await state(); assert.equal(restored.maxFps, 120); assert.equal(restored.performance.videoDecodePrefersSoftware, true);
  assert.equal(restored.performance.stageMediaFrameRateMode, 0); assert.equal(await page.evaluate(() => editor.viewState.preferences.timelineFrameRateMode), 2);
  await command("file.demo"); await page.evaluate(async () => editor.preview.setResources({ video: await fetch("/tests/fixtures/bg-pattern.webm").then(response => response.blob()) }));
  assert.equal((await state()).videoPresentation.decoder, "software");
  await command("preferences.performance", { videoDecodePrefersSoftware: false, canvasFrameRateMode: 3 });
  assert.equal((await state()).maxFps, "unlimited"); assert.equal((await state()).videoPresentation.decoder, "browser");
  const activeRenderer = page.frames().find(frame => frame.url().includes("/renderer/index.html"));
  const remaining = await activeRenderer.evaluate(decoderSnapshot);
  results.decoderRelease = remaining;
  assert.equal(remaining.active, 0); assert.equal(remaining.softwareFrames, 0);
  assert.ok(remaining.browserFrames <= 3, JSON.stringify(remaining));
  await page.evaluate(() => editor.preview.setResources({ video: null }));
  const cleared = await activeRenderer.evaluate(decoderSnapshot);
  results.cleared = cleared; assert.equal(cleared.frames, 0); assert.deepEqual(errors, []);
  console.log("Performance UI, decoder preference, PV pixels, independent frame rates, persistence and decoder release passed");
} catch (error) {
  results.failure = String(error); if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {}); throw error;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify({ ...results, errors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

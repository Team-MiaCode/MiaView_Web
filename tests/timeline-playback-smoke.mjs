import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", output = resolve("artifacts/timeline-playback", name);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(playwright, name), results = [];
const deadline = setTimeout(() => { console.error("Timeline playback acceptance exceeded 180 seconds"); void browser.close(); }, 180000);
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(120000); const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  console.log("Timeline playback: load");
  await page.evaluate(async () => {
    window.editor = document.getElementById("workbench").editor; await editor.ready;
    await editor.load({ maidata: "&title=Timeline follow\n&inote_5=(120){4}" + "1,2,3,4,".repeat(128) + "E", difficulty: 5 });
  });
  for (const [zoomScale, rate, mode] of [[.25, .5, 0], [.5, 1, 1], [1.5, 2, 2], [3, 1, 3]]) {
    console.log(JSON.stringify({ zoomScale, rate, mode }));
    await page.evaluate(async ({ zoomScale, rate, mode }) => {
      await editor.preview.pause(); await editor.preview.setPlayback({ rate });
      await editor.command("timeline.settings", { zoomScale });
      await editor.command("preferences.performance", { timelineFrameRateMode: mode });
      await editor.preview.seek(60); await editor.preview.play();
    }, { zoomScale, rate, mode });
    await waitForAsync(page, () => editor.workbench.timelineView.clock.playing && editor.workbench.timelineView.scrollValue > 0);
    const sample = await page.evaluate(async () => {
      const view = editor.workbench.timelineView, samples = [];
      for (let frame = 0; frame < 45; ++frame) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const line = view.playhead, matrix = line.getScreenCTM(), rect = view.root.getBoundingClientRect();
        const point = new DOMPoint(Number(line.getAttribute("x1")), 0).matrixTransform(matrix);
        samples.push({ error: Math.abs(point.x - rect.x - rect.width / 2), scroll: view.scrollValue });
      }
      return { samples, nativeState: view.state, mode: view.frameLimiter.maxFps };
    });
    assert.ok(sample.samples.every(item => item.error <= 1), JSON.stringify(sample.samples));
    assert.ok(sample.samples.at(-1).scroll > sample.samples[0].scroll);
    await page.evaluate(() => editor.preview.pause());
    await waitForAsync(page, () => !editor.workbench.timelineView.clock.playing);
    const stopped = await page.evaluate(async () => {
      const view = editor.workbench.timelineView, scroll = view.scrollValue;
      await new Promise(resolve => setTimeout(resolve, 150)); return { scroll, after: view.scrollValue, animation: view.animation };
    });
    assert.equal(stopped.scroll, stopped.after); assert.equal(stopped.animation, null);
    results.push({ zoomScale, rate, mode, maximumCenterError: Math.max(...sample.samples.map(item => item.error)),
      firstScroll: sample.samples[0].scroll, lastScroll: sample.samples.at(-1).scroll, stopped });
  }
  await page.evaluate(async () => {
    await editor.command("timeline.settings", { followProgressEnabled: false }); await editor.preview.play();
  });
  const fixed = await page.evaluate(async () => {
    const view = editor.workbench.timelineView, scroll = view.scrollValue;
    await new Promise(resolve => setTimeout(resolve, 250)); return { scroll, after: view.scrollValue };
  });
  assert.equal(fixed.scroll, fixed.after); assert.deepEqual(errors, []);
  console.log("Timeline follows v2's fractional centered playback at four zoom/frame-rate settings, three playback rates, pause and follow-off");
} finally {
  clearTimeout(deadline);
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

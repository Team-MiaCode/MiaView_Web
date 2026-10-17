import { launchPreviewBrowser } from "./preview-browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", output = resolve("artifacts/video-geometry", name);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(browsers, name), results = [], errors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 640, height: 600 } }); page.setDefaultTimeout(120000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);
  await page.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs");
    const host = document.getElementById("one"); host.style.width = "427px";
    window.preview = createPreview(host, { resolution: { width: 320, height: 180 }, controls: false }); await preview.ready;
    const video = document.createElement("video"); video.muted = true; video.src = "/tests/fixtures/bg-pattern.webm";
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    await new Promise(resolve => { video.onseeked = resolve; video.currentTime = .1; });
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const cover = window.geometryCover = await new Promise(resolve => canvas.toBlob(resolve));
    await preview.load({ maidata: "&title=Geometry\n&inote_5=(120){4},,,,,,,,,,,,,,,,E", difficulty: 5,
      cover, video: "/tests/fixtures/bg-pattern.webm" });
    await preview.setSettings({ outerBrightness: 1, innerBrightness: 1, showTimestamp: false, showDebugInfo: false,
      showChartInfoHud: false, showObjectStatsHud: false, centerDisplay: 0, layoutSquareScale: .75 });
    await preview.seek(.1);
  });
  const renderer = page.frames().find(frame => frame.url().includes("/renderer/index.html"));
  for (const software of [false, true]) {
    await page.evaluate(software => preview.setPerformance({ videoDecodePrefersSoftware: software }), software);
    for (const [width, height] of [[320, 180], [180, 320], [320, 320], [427, 233]]) {
      await page.evaluate(async ({ width, height }) => {
        document.getElementById("one").style.width = `${width}px`; await preview.setCanvasSize({ width, height });
        await preview.setSettings({ showTimestamp: false, showDebugInfo: false, showChartInfoHud: false, showObjectStatsHud: false });
      }, { width, height });
      for (const scaleMode of [0, 1, 2, 3]) {
        const frames = await page.evaluate(async () => (await preview.getState()).videoPresentation.frames);
        await page.evaluate(async scaleMode => { await preview.setSettings({ scaleMode }); await preview.setMediaSettings({ hidePv: true }); }, scaleMode);
        const native = await renderer.locator("#stage").screenshot();
        await page.evaluate(() => preview.setMediaSettings({ hidePv: false }));
        await waitForAsync(page, async before => (await preview.getState()).videoPresentation.frames > before, frames);
        const browser = await renderer.locator("#stage").screenshot();
        const compared = await page.evaluate(async ({ native, browser }) => {
          const pixels = async buffer => {
            const image = await createImageBitmap(new Blob([new Uint8Array(buffer)], { type: "image/png" }));
            const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); image.close();
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const [left, right] = await Promise.all([pixels(native), pixels(browser)]); let total = 0, mismatched = 0;
          for (let index = 0; index < left.length; index += 4) {
            const error = Math.max(...[0, 1, 2].map(channel => Math.abs(left[index + channel] - right[index + channel])));
            total += error; if (error > 8) ++mismatched;
          }
          return { meanError: total / (left.length / 4), mismatchedFraction: mismatched / (left.length / 4) };
        }, { native: [...native], browser: [...browser] });
        const result = { software, width, height, scaleMode, ...compared }; results.push(result);
        if (result.meanError >= 3 || result.mismatchedFraction >= .025) {
          writeFileSync(join(output, "native.png"), native); writeFileSync(join(output, "browser.png"), browser);
          console.log(JSON.stringify(await page.evaluate(() => preview.getState())));
        }
        assert.ok(result.meanError < 3 && result.mismatchedFraction < .025, JSON.stringify(result));
      }
    }
    await page.evaluate(async () => {
      await preview.setMediaSettings({ hidePv: true });
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d"); context.fillStyle = "rgb(20,40,200)"; context.fillRect(0, 0, 64, 64);
      await preview.setResources({ cover: await new Promise(resolve => canvas.toBlob(resolve)) });
    });
    const replaced = await renderer.locator("#stage").screenshot();
    const center = await page.evaluate(async bytes => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); image.close();
      return [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
    }, [...replaced]);
    assert.ok(Math.abs(center[0] - 20) < 3 && Math.abs(center[1] - 40) < 3 && Math.abs(center[2] - 200) < 3, JSON.stringify(center));
    await page.evaluate(async () => { await preview.setResources({ cover: geometryCover }); await preview.setMediaSettings({ hidePv: false }); });
  }
  assert.deepEqual(errors, []);
  console.log("Native and browser PV geometry match across four scale modes, aspect ratios and decoder paths");
} catch (error) {
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {}); throw error;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify({ results, errors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

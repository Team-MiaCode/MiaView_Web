import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../dev/server.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/cover-native");
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const logs = [];
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
  page.on("console", message => logs.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", error => logs.push({ type: "pageerror", text: error.message }));
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=cover-card&native=1`);
  await page.locator(".cover-editor").waitFor();
  const initial = await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.ready);
  assert.equal(initial.activeLayerKey, "card");
  assert.equal(initial.layout.layers.length, 3);
  assert.equal(initial.outputWidth, 1080);
  assert.equal(initial.outputHeight, 1080);
  await page.locator('.cover-layer-row[data-key="card"]').waitFor();
  const frame = page.frameLocator("iframe");
  assert.equal(await frame.locator("#transport").isVisible(), false);
  assert.equal(await frame.locator("#fps").isVisible(), false);
  async function checkCanvas(width = 1080, height = 1080) {
    const outer = await page.locator(".cover-canvas-pane").boundingBox();
    const iframe = await page.locator("iframe").boundingBox();
    assert.ok(iframe.x >= outer.x + 11 && iframe.x + iframe.width <= outer.x + outer.width - 11, "cover iframe horizontal bounds");
    assert.ok(iframe.y >= outer.y + 11 && iframe.y + iframe.height <= outer.y + outer.height - 11, "cover iframe vertical bounds");
    const surface = await frame.locator("#viewport").boundingBox();
    const state = await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition());
    assert.equal(state.outputWidth, width);
    assert.equal(state.outputHeight, height);
    assert.ok(Math.abs(surface.width / surface.height - width / height) < .005, "cover output aspect");
    return { outer, iframe, surface, width: state.outputWidth, height: state.outputHeight };
  }
  results.push(await checkCanvas());
  await page.screenshot({ path: resolve(output, "card-dark.png") });
  await page.locator('.settings-tabs button[data-page="canvas"]').click();
  for (const [index, width, height] of [[1, 960, 720], [2, 1280, 720], [3, 1080, 1080]]) {
    await page.getByLabel("大小", { exact: true }).selectOption(String(index));
    await page.waitForFunction(async ([width, height]) => {
      const state = await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition();
      return state.outputWidth === width && state.outputHeight === height;
    }, [width, height]);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    results.push(await checkCanvas(width, height));
  }
  await page.getByRole("option", { name: "文字", exact: true }).click();
  await page.getByRole("textbox", { name: "文字", exact: true }).fill("MiaCode Local");
  await page.getByRole("textbox", { name: "文字", exact: true }).press("Tab");
  await page.waitForFunction(async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.find(layer => layer.key === "text").text === "MiaCode Local");
  const rejected = await page.evaluate(async () => {
    try { await document.querySelector(".cover-editor").coverRenderer.preview.setCoverComposition({ outputWidth: -1 }); return false; }
    catch { return true; }
  });
  assert.equal(rejected, true);
  results.push(await checkCanvas());
  await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.preview.load({ maidata: "&title=Cover return\n&inote_5=(120){4}1,2,E" }));
  assert.equal(await frame.locator("#transport").isVisible(), true);
  assert.equal(await frame.locator("body").evaluate(node => node.classList.contains("cover-view")), false);
  assert.equal((await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.preview.getState())).resolution.width, 1080);
  const intrinsic = await page.evaluate(async () => {
    const { createPreview } = await import("../sdk/index.mjs");
    const container = document.createElement("div");
    container.style.width = "400px";
    document.body.append(container);
    const api = createPreview(container, { resolution: { width: 720, height: 720 }, diagnostics: false });
    try {
      await api.ready;
      await api.setCoverComposition({ outputWidth: 960, outputHeight: 720 });
      const coverHeight = container.getBoundingClientRect().height;
      await api.load({ maidata: "&inote_5=(120){4}1,E" });
      return { coverHeight, previewHeight: container.getBoundingClientRect().height, resolution: (await api.getState()).resolution };
    } finally { api.destroy(); container.remove(); }
  });
  assert.equal(intrinsic.coverHeight, 300);
  assert.equal(intrinsic.previewHeight, 480);
  assert.equal(intrinsic.resolution.width, 720);
  assert.deepEqual(logs.filter(log => log.type === "pageerror"), []);
  console.log("Native cover geometry, output aspects, layer edits and preview return passed");
} finally {
  writeFileSync(resolve(output, "logs.json"), JSON.stringify(logs, null, 2) + "\n");
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

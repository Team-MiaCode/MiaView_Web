import { launchPreviewBrowser } from "./preview-browser.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../dev/server.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const browserName = process.env.MIACODE_BROWSER || "chromium";
const output = resolve("artifacts/cover-native", browserName);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await listenForBrowser(server);
const browser = await launchPreviewBrowser(browsers, browserName);
const logs = [];
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
  page.on("console", message => logs.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", error => logs.push({ type: "pageerror", text: error.message }));
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=cover-card&native=1`);
  await page.locator(".cover-editor").waitFor();
  const menus = await page.locator(".cover-menu summary").elementHandles();
  const inspectorTabs = await page.locator(".cover-inspector [role=tab]").elementHandles();
  const initial = await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.ready);
  for (const menu of menus) assert.equal(await menu.evaluate(node => node.isConnected), true, "Native composition initialization retains menu controls");
  for (const tab of inspectorTabs) assert.equal(await tab.evaluate(node => node.isConnected), true, "Native composition initialization retains inspector tabs");
  assert.equal(initial.activeLayerKey, "card");
  assert.equal(initial.layout.layers.length, 3);
  assert.equal(initial.outputWidth, 1080);
  assert.equal(initial.outputHeight, 1080);
  const modes = await page.evaluate(async () => {
    const preview = document.querySelector(".cover-editor").coverRenderer.preview;
    const sourceText = "&title=Mode detection\n&inote_2=(120){4}1,2,E\n&inote_5=(120){4}A1,2,E";
    const modes = [];
    for (const [difficulty, mode] of [[2, "auto"], [5, "auto"], [2, "DX"], [5, "Standard"], [2, "auto"]]) {
      const result = await preview.setCoverComposition({ sourceText, difficulty, trackOverrides: { title: "Mode detection", mode } });
      const image = await preview.exportCover({ type: "image/png" });
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await image.blob.arrayBuffer()))].join(",");
      modes.push({ resolved: result.trackOverrides.mode, stored: result.composition.card.mode, hash });
    }
    await document.querySelector(".cover-editor").coverRenderer.update();
    return modes;
  });
  assert.deepEqual(modes.map(row => row.resolved), ["Standard", "DX", "DX", "Standard", "Standard"]);
  assert.deepEqual(modes.map(row => row.stored), ["auto", "auto", "DX", "Standard", "auto"]);
  assert.equal(modes[0].hash, modes[3].hash); assert.equal(modes[0].hash, modes[4].hash);
  assert.equal(modes[1].hash, modes[2].hash); assert.notEqual(modes[0].hash, modes[1].hash);
  results.push({ cardModes: modes.map(({ resolved, stored }) => ({ resolved, stored })) });
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
    await waitForAsync(page, async ([width, height]) => {
      const state = await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition();
      return state.outputWidth === width && state.outputHeight === height;
    }, [width, height]);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    results.push(await checkCanvas(width, height));
  }
  await page.getByRole("option", { name: "文字", exact: true }).click();
  await page.getByRole("textbox", { name: "文字", exact: true }).fill("MiaCode Local");
  await page.getByRole("textbox", { name: "文字", exact: true }).press("Tab");
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.find(layer => layer.key === "text").text === "MiaCode Local");
  const coverState = () => page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition());
  const coverCommand = (id, args = {}) => page.evaluate(([id, args]) => document.querySelector(".cover-editor").coverRenderer.preview.coverCommand(id, args), [id, args]);
  await page.locator('.cover-menu summary[aria-label="添加 ▾"]').click();
  await page.getByRole("button", { name: "添加文字", exact: true }).click();
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.length === 4);
  let state = await coverState();
  const textKey = state.activeLayerKey;
  assert.notEqual(textKey, "text");
  assert.equal(state.layout.layers.find(layer => layer.key === textKey).text, "文字");
  const newRow = () => page.locator(`.cover-layer-row[data-key="${textKey}"]`);
  await newRow().waitFor();
  await page.getByRole("textbox", { name: "文字", exact: true }).fill("Native layer transaction");
  await page.getByRole("textbox", { name: "文字", exact: true }).press("Tab");
  // A property edit and a visibility command share the same native transaction queue.
  await newRow().getByRole("button", { name: "隐藏", exact: true }).click();
  await waitForAsync(page, async key => {
    const state = await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition();
    const layer = state.layout.layers.find(layer => layer.key === key);
    return layer.text === "Native layer transaction" && !layer.visible;
  }, textKey);
  await newRow().getByRole("button", { name: "显示", exact: true }).click();
  await newRow().getByRole("button", { name: "锁定", exact: true }).click();
  await waitForAsync(page, async key => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.find(layer => layer.key === key).locked, textKey);
  await page.getByRole("button", { name: "复制图层", exact: true }).click();
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.length === 5);
  state = await coverState();
  const copyKey = state.activeLayerKey;
  const copy = state.layout.layers.find(layer => layer.key === copyKey);
  assert.equal(copy.text, "Native layer transaction");
  assert.equal(copy.locked, true);
  assert.equal(copy.visible, true);
  assert.notEqual(copyKey, textKey);
  const order = value => [...value.layout.layers].sort((a, b) => b.z - a.z).map(layer => layer.key);
  assert.equal(order(state)[0], copyKey);
  await page.getByRole("button", { name: "下移", exact: true }).click();
  await waitForAsync(page, async key => {
    const state = await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition();
    return [...state.layout.layers].sort((a,b) => b.z-a.z)[1].key === key;
  }, copyKey);
  await page.getByRole("button", { name: "上移", exact: true }).click();
  await waitForAsync(page, async key => {
    const state = await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition();
    return [...state.layout.layers].sort((a,b) => b.z-a.z)[0].key === key;
  }, copyKey);
  await page.locator(`.cover-layer-row[data-key="${copyKey}"]`).focus();
  await page.keyboard.press("Delete");
  await waitForAsync(page, async key => !(await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.some(layer => layer.key === key), copyKey);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), textKey, "deletion keeps keyboard focus on the native selected neighbour");
  await page.keyboard.press("Delete");
  await waitForAsync(page, async key => !(await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.some(layer => layer.key === key), textKey);
  await page.locator('.cover-layer-row[data-key="card"]').dragTo(page.locator('.cover-layer-row[data-key="image"]'));
  await waitForAsync(page, async () => {
    const state = await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition();
    return [...state.layout.layers].sort((a,b) => b.z-a.z)[0].key === "card";
  });
  await page.locator('.cover-layer-row[data-key="image"]').click();
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).activeLayerKey === "image");
  // Native API reordering follows the upstream view-row insertion contract.
  state = await coverCommand("cover.moveLayer", { key: "card", viewRow: 3 });
  assert.equal(order(state).at(-1), "card");
  state = await coverCommand("cover.moveLayer", { key: "card", viewRow: 0 });
  assert.equal(order(state)[0], "card");
  assert.equal(state.activeLayerKey, "image");
  await coverCommand("cover.selectLayerKey", { key: "card" });
  for (const [id, args, message] of [["cover.removeActiveLayer", {}, "难度卡片是固定图层"], ["cover.duplicateActiveLayer", {}, "难度卡片保留单个图层"],
    ["cover.moveLayer", { viewRow: .5 }, "封面图层排序位置无效"], ["cover.selectLayerKey", { key: "missing" }, "封面图层不存在"],
    ["cover.layer", { opacity: .25, kind: "image" }, "封面图层字段无效：kind"], ["cover.layer", { opacity: .25, locked: "yes" }, "封面图层字段类型无效：locked"]]) {
    const before = await coverState();
    const rejected = await page.evaluate(async ([id, args]) => {
      try { await document.querySelector(".cover-editor").coverRenderer.preview.coverCommand(id, args); return null; }
      catch (error) { return error.message; }
    }, [id, args]);
    assert.equal(rejected, message, "the embedding page receives the native validation error");
    assert.deepEqual(await coverState(), before, "rejected native command preserves all layer properties");
  }
  await page.evaluate(() => {
    const canvas = document.querySelector(".cover-editor").coverRenderer;
    return canvas.preview.setCoverChart({ maidata: canvas.document.sourceText, difficulty: 5 }, { duration: canvas.document.duration });
  });
  state = await coverCommand("cover.addChartFrameLayer", { frameSeconds: 3.25 });
  const frameKey = state.activeLayerKey;
  assert.equal(state.layout.layers.find(layer => layer.key === frameKey).frameSeconds, 3.25);
  await coverCommand("cover.layer", { frameBgBrightness: .35, nx: .25, ny: .75 });
  state = await coverCommand("cover.addChartFrameLayer");
  const inherited = state.layout.layers.find(layer => layer.key === state.activeLayerKey);
  assert.equal(inherited.frameBgBrightness, .35);
  assert.equal(inherited.frameSeconds, 3.25);
  await coverCommand("cover.layer", { opacity: -2, sizeFraction: 999 });
  state = await coverState();
  assert.equal(state.layout.layers.find(layer => layer.key === state.activeLayerKey).opacity, 0, "native model clamps opacity");
  state = await coverCommand("cover.resetLayout");
  assert.ok(state.layout.layers.every(layer => layer.opacity === 1));
  state = await coverCommand("cover.addImageLayer");
  assert.equal(state.layout.layers.find(layer => layer.key === state.activeLayerKey).kind, "image");
  results.push({ nativeCommands: { layers: state.layout.layers.length, activeLayerKey: state.activeLayerKey, inheritedFrameSeconds: inherited.frameSeconds } });
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

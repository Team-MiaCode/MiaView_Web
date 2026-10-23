import { observeFilePicker } from "./helpers/file-picker.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const browserName = process.env.MIACODE_BROWSER || "chromium";
const output = resolve("artifacts/cover-files", browserName); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await listenForBrowser(server);
const browser = await launchPreviewBrowser(browsers, browserName);
const errors = [], results = {};
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const command = (id, args = {}) => page.evaluate(([id, args]) => document.getElementById("workbench").editor.command(id, args), [id, args]);
  const state = () => page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition());
  const ready = () => page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.ready);
  const upload = async (action, file) => {
    const chosen = page.waitForEvent("filechooser"); await action(); await (await chosen).setFiles(file);
  };
  const menu = async label => {
    await page.locator(".cover-topbar .cover-menu > summary").click();
    await page.getByRole("button", { name: label, exact: true }).click();
  };
  async function imageStats(type = "image/png") {
    return page.evaluate(async type => {
      const result = await document.querySelector(".cover-editor").coverRenderer.exportImage({ type });
      const bitmap = await createImageBitmap(result.blob), canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0); bitmap.close();
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await result.blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, "0")).join("");
      return { width: result.width, height: result.height, type: result.mimeType, bytes: result.blob.size,
        corner: pixel(0, 0), center: pixel(Math.floor(canvas.width / 2) + 3, Math.floor(canvas.height / 2)), hash };
    }, type);
  }
  const base = `http://127.0.0.1:${server.address().port}`;
  await observeFilePicker(page);
  await page.goto(`${base}/tests/ui-page.html?page=about`);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("miacode.web.assets", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("assets", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction("assets", "readwrite");
      transaction.objectStore("assets").put({ id: "schema-fixture", kind: "background", file: new File([Uint8Array.of(1, 2, 3)], "preserved.bin") });
      transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.goto(`${base}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  assert.deepEqual(await page.evaluate(async () => {
    const { PreferenceAssets } = await import("./services/preference-assets.mjs"), assets = new PreferenceAssets();
    try { return [...new Uint8Array(await (await assets.get("schema-fixture")).file.arrayBuffer())]; }
    finally { await assets.delete("schema-fixture"); await assets.close(); }
  }), [1, 2, 3], "adding the kind index retains existing asset bytes");
  await command("file.new"); await command("page.cover"); await ready();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 60;
    const context = canvas.getContext("2d"); context.fillStyle = "#ff3f2f"; context.fillRect(0, 0, 60, 60);
    context.fillStyle = "#12b45a"; context.fillRect(60, 0, 60, 60); return canvas.toDataURL().split(",")[1];
  });
  const picture = join(output, "picture.png"); writeFileSync(picture, Buffer.from(encoded, "base64"));
  for (const type of ["image/jpeg", "image/webp", "image/bmp"]) {
    const imported = await page.evaluate(async type => {
      const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 60;
      let blob;
      if (type === "image/bmp") {
        const bytes = new Uint8Array(62), view = new DataView(bytes.buffer);
        bytes.set([66, 77]); view.setUint32(2, 62, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
        view.setInt32(18, 2, true); view.setInt32(22, 1, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
        view.setUint32(34, 8, true); bytes.set([0, 0, 255, 0, 255, 0], 54); blob = new Blob([bytes], { type });
      } else blob = await new Promise(resolve => canvas.toBlob(resolve, type));
      if (blob.type !== type) throw new Error(`Image fixture encoder returned ${blob.type}`);
      try { return await document.querySelector(".cover-editor").coverRenderer.preview.importCoverImage(blob); }
      catch (error) { return { error: error.message }; }
    }, type);
    assert.equal(imported.error, undefined, `${type}: ${imported.error}`);
    assert.equal(imported.width, type === "image/bmp" ? 2 : 120); assert.equal(imported.height, type === "image/bmp" ? 1 : 60);
  }
  await page.locator('.settings-tabs [data-page="canvas"]').click();
  await page.getByRole("combobox", { name: "大小", exact: true }).selectOption("0");
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).outputWidth === 720);
  await page.locator('.cover-layer-row[data-key="card"]').getByRole("button", { name: "隐藏", exact: true }).click();
  await page.locator(".cover-layers-pane .cover-menu > summary").click();
  await upload(() => page.getByRole("button", { name: "添加图片", exact: true }).click(), picture);
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.some(layer => layer.kind === "image"));
  let current = await state();
  const imageLayer = current.layout.layers.find(layer => layer.kind === "image");
  assert.match(imageLayer.imagePath, /^\/web-cover\/[a-f\d]{64}$/);
  assert.equal(imageLayer.contentAspect, 2);
  assert.match(await page.locator(`.cover-layer-row[data-key="${imageLayer.key}"] .cover-layer-detail`).textContent(), /picture\.png/);
  await page.waitForFunction(key => {
    const image = document.querySelector(`.cover-layer-row[data-key="${key}"] img`);
    return image?.complete && image.naturalWidth === 120;
  }, imageLayer.key);
  await page.locator('.settings-tabs [data-page="canvas"]').click();
  await upload(() => page.getByRole("button", { name: "选择背景图片", exact: true }).click(), picture);
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).composition.background.mode === "custom");
  await page.getByRole("combobox", { name: "背景", exact: true }).selectOption("2");
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).composition.background.mode === "transparent");
  const png = await imageStats();
  assert.equal(png.corner[3], 0); assert.deepEqual(png.center, [18, 180, 90, 255]);
  assert.equal(png.width, 720); assert.equal(png.height, 720); assert.equal(png.type, "image/png");
  await page.locator('.cover-layer-row[data-key="card"]').click();
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).activeLayerKey === "card");
  assert.equal((await imageStats()).hash, png.hash, "exported pixels exclude selection handles for every selected layer");
  const jpeg = await imageStats("image/jpeg"); assert.equal(jpeg.type, "image/jpeg"); assert.deepEqual(jpeg.corner, [0, 0, 0, 255]);
  const fontPath = resolve("vendor/MiaCode/src/intro/assets/fonts/ResourceHanRoundedCN-Bold.ttf");
  const titleFont = page.locator(".cover-inspector .form-row").filter({ has: page.getByRole("combobox", { name: "标题", exact: true }) });
  await upload(() => titleFont.getByRole("button").click(), fontPath);
  await waitForAsync(page, async () => Boolean((await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).composition.card.fontDisplay));
  current = await state(); assert.match(current.composition.card.fontDisplay, /^\/web-fonts\/[a-f\d]{64}\.ttf$/);
  const layoutDownload = page.waitForEvent("download"); await menu("保存布局到文件…");
  const layoutPath = join(output, "layout.json"); await (await layoutDownload).saveAs(layoutPath);
  const layout = JSON.parse(readFileSync(layoutPath, "utf8"));
  assert.equal(layout.kind, "miacode-cover-composition"); assert.equal(layout.version, 3);
  assert.equal(layout.outputFile, undefined, "shared layouts preserve each project's output destination");
  assert.equal(Object.keys(layout.assets).length, 2); assert.equal(layout.layout.layers.length, 2);
  layout.size = { w: 432, h: 288 }; writeFileSync(layoutPath, JSON.stringify(layout));
  await upload(() => menu("导入布局文件…"), layoutPath);
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).outputWidth === 432);
  await page.locator('.settings-tabs [data-page="canvas"]').click();
  assert.equal(await page.getByRole("combobox", { name: "大小", exact: true }).inputValue(), "-1");
  const custom = await imageStats(); assert.equal(custom.width, 432); assert.equal(custom.height, 288); assert.equal(custom.corner[3], 0);
  await page.getByRole("textbox", { name: "输出", exact: true }).fill("test-cover.png");
  await page.getByRole("textbox", { name: "输出", exact: true }).press("Tab");
  const exported = page.waitForEvent("download"); await page.locator(".cover-topbar .primary").click();
  const download = await exported; assert.equal(download.suggestedFilename(), "test-cover.png"); await download.saveAs(join(output, "export.png"));
  assert.equal(readFileSync(join(output, "export.png")).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await menu("管理预设...");
  await page.getByRole("textbox", { name: "预设名称", exact: true }).fill("Cover Test");
  await page.getByRole("button", { name: "保存当前布局", exact: true }).click();
  await page.getByRole("option", { name: "Cover Test", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "预设名称", exact: true }).fill("Cover Renamed");
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await page.getByRole("option", { name: "Cover Renamed", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("combobox", { name: "背景", exact: true }).selectOption("0");
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).composition.background.mode === "jacket");
  await menu("管理预设..."); await page.getByRole("button", { name: "应用预设", exact: true }).click();
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).composition.background.mode === "transparent");
  assert.equal((await imageStats()).hash, custom.hash);
  await command("file.flushRecovery");
  const id = await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.recentDocuments[0].id);
  await page.reload(); await page.waitForFunction(() => document.getElementById("workbench")?.editor); await page.evaluate(() => document.getElementById("workbench").editor.ready);
  await command("file.openRecent", { id }); await page.locator(".cover-editor").waitFor(); await ready();
  const recovered = await imageStats(); assert.equal(recovered.hash, custom.hash, "project recovery restores image and font bytes in a fresh renderer");
  await menu("管理预设..."); await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="封面布局预设"]').options.length === 0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const invalid = await page.evaluate(async () => {
    const preview = document.querySelector(".cover-editor").coverRenderer.preview;
    try { await preview.importCoverImage(new Blob(["invalid"])); return null; } catch (error) { return error.message; }
  });
  assert.equal(invalid, "封面图片解码失败");
  assert.equal((await imageStats()).hash, recovered.hash);
  await page.screenshot({ path: join(output, "cover.png") });
  Object.assign(results, { png, jpeg, custom, recovered, assets: Object.keys(layout.assets), errors });
  assert.deepEqual(errors, []);
  console.log("Cover images, fonts, alpha/JPEG export, portable layouts, presets and recovery passed");
} catch (error) {
  results.failure = error.message;
  results.status = await page?.evaluate(() => document.getElementById("workbench")?.editor?.workbench.statusLabel.textContent).catch(() => null);
  results.cover = await page?.evaluate(() => document.querySelector(".cover-editor")?.coverRenderer?.preview.getCoverComposition()).catch(() => null);
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify({ ...results, errors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

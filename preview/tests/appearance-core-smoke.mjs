import { observeFilePicker } from "./helpers/file-picker.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", output = resolve("artifacts/appearance", name), folder = join(output, "Green"); mkdirSync(folder, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(browsers, name);
const errors = [], result = {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); page.setDefaultTimeout(90000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { window.showDirectoryPicker = undefined; window.showSaveFilePicker = undefined; });
  await observeFilePicker(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.locator(".welcome-title").waitFor();
  const ready = () => page.evaluate(() => document.getElementById("workbench").editor.ready);
  const command = (id, args = {}) => page.evaluate(([id, args]) => document.getElementById("workbench").editor.command(id, args), [id, args]);
  const settings = () => page.evaluate(async () => (await document.getElementById("workbench").editor.preview.getState()).settings);
  await ready(); await command("file.demo");
  const png = async color => page.evaluate(async color => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 96;
    const context = canvas.getContext("2d"); context.fillStyle = color; context.fillRect(0, 0, 96, 96);
    const blob = await new Promise(resolve => canvas.toBlob(resolve)); return [...new Uint8Array(await blob.arrayBuffer())];
  }, color);
  writeFileSync(join(folder, "tap.png"), Buffer.from(await png("#00ff00")));
  const outline = join(output, "Purple.png"); writeFileSync(outline, Buffer.from(await png("#8800ee")));
  const upload = async (id, files) => {
    const picker = page.waitForEvent("filechooser");
    await page.evaluate(id => { window.importing = document.getElementById("workbench").editor.command(id); }, id);
    const chooser = await picker;
    assert.equal(await chooser.element().evaluate(input => input.isConnected), true, "Picker input remains attached during directory and file imports");
    await chooser.setFiles(files); return page.evaluate(() => importing);
  };
  result.skin = await upload("skin.import", folder);
  assert.match(result.skin.skinDirectoryName, /^skin-[a-f0-9]{64}$/);
  assert.equal((await settings()).skinDirectoryName, result.skin.skinDirectoryName);
  result.outline = await upload("preview.importJudgeLine", outline);
  assert.equal((await settings()).customOutlineFileName, result.outline.customOutlineFileName);
  const otherFolder = join(output, "Blue"); mkdirSync(otherFolder, { recursive: true });
  writeFileSync(join(otherFolder, "tap.png"), Buffer.from(await png("#0000ff")));
  const otherOutline = join(output, "Orange.png"); writeFileSync(otherOutline, Buffer.from(await png("#ff8800")));
  result.otherSkin = await upload("skin.import", otherFolder); result.otherOutline = await upload("preview.importJudgeLine", otherOutline);
  await command("preview.values", { skinDirectoryName: result.skin.skinDirectoryName, customOutlineFileName: result.outline.customOutlineFileName });
  await command("page.preview-settings"); await page.locator('.settings-tabs [data-page="skin"]').click();
  const choices = await page.locator('.settings-tab-content select').evaluateAll(nodes => nodes.slice(0, 3).map(node => ({ selected: node.selectedOptions[0]?.textContent, count: node.options.length })));
  assert.equal(choices[0].selected, "Green"); assert.equal(choices[0].count, 4); assert.equal(choices[2].selected, "Purple.png"); assert.equal(choices[2].count, 6);
  const invalid = await page.evaluate(async path => {
    const editor = document.getElementById("workbench").editor, good = await (await fetch(path)).blob();
    try { await editor.preview.importSkin([{ path: "tap.png", image: good }, { path: "hold.png", image: new Blob(["invalid PNG"]) }]); }
    catch (error) { return error.message; }
  }, `/artifacts/appearance/${name}/Green/tap.png`);
  assert.match(invalid, /PNG/); assert.equal((await settings()).skinDirectoryName, result.skin.skinDirectoryName);
  await page.reload(); await page.waitForFunction(() => document.getElementById("workbench")?.editor); await ready();
  const restored = await settings(); assert.equal(restored.skinDirectoryName, result.skin.skinDirectoryName); assert.equal(restored.customOutlineFileName, result.outline.customOutlineFileName);
  await command("page.preview-settings"); await page.locator('.settings-tabs [data-page="skin"]').click();
  await page.locator('.settings-tab-content select').nth(0).selectOption({ label: "Blue" });
  await page.locator('.settings-tab-content select').nth(2).selectOption({ label: "Orange.png" });
  await waitForAsync(page, async names => {
    const settings = (await document.getElementById("workbench").editor.preview.getState()).settings;
    return settings.skinDirectoryName === names[0] && settings.customOutlineFileName === names[1];
  }, [result.otherSkin.skinDirectoryName, result.otherOutline.customOutlineFileName]);
  await command("preview.values", { skinDirectoryName: result.skin.skinDirectoryName, customOutlineFileName: result.outline.customOutlineFileName });
  await command("file.demo"); await command("page.cover"); await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.ready);
  await page.locator(".cover-menu summary").last().click(); await page.getByRole("button", { name: "添加谱面帧", exact: true }).click();
  await waitForAsync(page, async () => (await document.querySelector(".cover-editor").coverRenderer.preview.getCoverComposition()).layout.layers.some(layer => layer.kind === "chartFrame"));
  await page.evaluate(() => { window.appearancePixels = async () => {
    const api = document.querySelector(".cover-editor").coverRenderer.preview, state = await api.getCoverComposition();
    await api.coverCommand("cover.layer", { key: "card", visible: false }); await api.coverCommand("cover.layer", { key: state.activeLayerKey, sizeFraction: 1, frameSeconds: .2 });
    const { blob } = await api.exportCover();
    const image = await createImageBitmap(blob), canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); image.close();
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data; let green = 0, purple = 0;
    for (let i = 0; i < data.length; i += 4) { if (data[i] < 30 && data[i + 1] > 220 && data[i + 2] < 30) green++; if (data[i] > 100 && data[i] < 160 && data[i + 1] < 30 && data[i + 2] > 200) purple++; }
    return { green, purple, bytes: [...new Uint8Array(await blob.arrayBuffer())], settings: (await api.getState()).settings };
  }; });
  const pixels = await page.evaluate(() => appearancePixels());
  assert.ok(pixels.green > 50, `Custom tap renders in cover: ${pixels.green}`); assert.ok(pixels.purple > 1000, `Custom outline renders in cover: ${pixels.purple}`);
  assert.equal(pixels.settings.skinDirectoryName, result.skin.skinDirectoryName); assert.equal(pixels.settings.customOutlineFileName, result.outline.customOutlineFileName);
  writeFileSync(join(output, "cover.png"), Buffer.from(pixels.bytes)); result.cover = { green: pixels.green, purple: pixels.purple };
  await command("page.metadata");
  await command("preview.values", { forceLabeledJudgeLineWhenPaused: true });
  await command("page.cover"); await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.ready);
  const pausedHints = await page.evaluate(() => appearancePixels());
  assert.deepEqual(pausedHints.bytes, pixels.bytes, "Cover frames follow the selected export outline when interactive pause hints are enabled");
  result.coverPauseHints = { green: pausedHints.green, purple: pausedHints.purple };
  await command("page.export");
  await command("export.settings", { resolutionIndex: 0, fps: 30, exportStartSeconds: .2, exportEndSeconds: .4, outputPath: "custom-skin.mp4" });
  const downloaded = page.waitForEvent("download"); const video = await command("export.video"); const file = await downloaded;
  assert.equal(video.filename, file.suggestedFilename()); await file.saveAs(join(output, video.filename)); result.video = video;
  const decoded = await page.evaluate(async path => {
    const video = document.createElement("video"); video.muted = true; video.src = path;
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    const sought = new Promise(resolve => video.onseeked = resolve); video.currentTime = 1.6; await sought;
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d"); context.drawImage(video, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let purple = 0, green = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 90 && data[i] < 170 && data[i + 1] < 40 && data[i + 2] > 180) purple++;
      if (data[i] < 60 && data[i + 1] > 180 && data[i + 2] < 60) green++;
    }
    video.removeAttribute("src"); video.load(); return { purple, green };
  }, `/artifacts/appearance/${name}/${video.filename}`);
  assert.ok(decoded.purple > 1000, "Video export imports the selected outline into its snapshot renderer"); result.decoded = decoded;
  assert.ok(decoded.green > 20, "Video export draws the selected skin's note image");
  await command("preview.values", { skinIndex: 1, skinDirectoryName: "skinDX", outlineIndex: 1, customOutlineFileName: "" });
  const builtin = await settings(); assert.equal(builtin.skinDirectoryName, "skinDX"); assert.equal(builtin.customOutlineFileName, "");
  assert.deepEqual(errors, []);
  console.log("Custom skin/outline import, library selection, reload, failed import isolation, cover pixels and encoded video passed");
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify({ ...result, errors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

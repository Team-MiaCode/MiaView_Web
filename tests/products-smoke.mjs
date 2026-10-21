import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../dev/server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const sourceText = "&title=Product parity\n&lv_5=12\n&inote_5=(120){4}1,2,3,4,5,6,7,8,E";
const fixtureRoot = resolve("artifacts/products/folders");
const wave = Buffer.alloc(44 + 24000 * 12 * 2);
wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28); wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
for (const [name, field] of [["Standard", ""], ["Explicit", "assets/clip.webm"], ["Image", "assets/frame.png"]]) {
  const folder = resolve(fixtureRoot, name); mkdirSync(resolve(folder, "assets"), { recursive: true });
  writeFileSync(resolve(folder, "maidata.txt"), `&title=${name}\n${field ? `&video=${field}\n` : ""}&lv_5=12\n&inote_5=(120){4}1,2,3,4,E`);
  writeFileSync(resolve(folder, "track.wav"), wave);
  copyFileSync("ui/components/icons/app.png", resolve(folder, "bg.png"));
  if (field) {
    writeFileSync(resolve(folder, "pv.webm"), "default PV decoy");
    copyFileSync(field.endsWith("webm") ? "tests/fixtures/bg-pattern.webm" : "ui/components/icons/app.png", resolve(folder, field));
  } else copyFileSync("tests/fixtures/bg-pattern.webm", resolve(folder, "pv.webm"));
}
const productRoot = resolve(process.env.MIACODE_PRODUCTS_ROOT || ".");
const servers = [], results = [];
const renderReferences = new Map();
async function frameDiagnostics(page) {
  return Promise.all(page.frames().map(async frame => ({ url: frame.url(),
    detail: await frame.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus(),
      status: [...document.querySelectorAll("#status,.status-label")].map(node => node.textContent),
      bounds: [...document.querySelectorAll("iframe,.preview-host,#stage,#qt-screen,canvas")].map(node => {
        const rect = node.getBoundingClientRect();
        return { tag: node.tagName, id: node.id, display: getComputedStyle(node).display,
          x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }) })).catch(error => ({ error: String(error) })) })));
}
const renderSettings = { noteSkin: "DX", previewMode: "native", showTimestamp: false, showDebugInfo: false,
  showChartInfoHud: false, showObjectStatsHud: false, centerDisplay: 0 };
async function compareRender(page, reference, captured) {
  return page.evaluate(async images => {
    const bitmaps = await Promise.all(images.map(value => createImageBitmap(new Blob([Uint8Array.from(atob(value), char => char.charCodeAt(0))], { type: "image/png" }))));
    const canvas = document.createElement("canvas"); canvas.width = bitmaps[0].width; canvas.height = bitmaps[0].height;
    const context = canvas.getContext("2d"), samples = [];
    for (const image of bitmaps) { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); samples.push(context.getImageData(0, 0, canvas.width, canvas.height).data); image.close(); }
    let difference = 0;
    for (let index = 0; index < samples[0].length; ++index) difference += Math.abs(samples[0][index] - samples[1][index]);
    return difference / samples[0].length;
  }, [reference.toString("base64"), captured.toString("base64")]);
}
async function serve(root) {
  const server = staticServer(root, { performanceTerminal: false }); servers.push(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
const host = await serve(process.cwd());
const editorSite = await serve(resolve(productRoot, "editor"));
const previewSite = await serve(resolve(productRoot, "preview"));
const engines = (process.env.MIACODE_PRODUCT_ENGINES || "chromium,firefox").split(",");
try {
  for (const name of engines) {
    const browser = await launchPreviewBrowser(playwright, name);
    try {
      for (const [product, origin] of [["main", host], ["editor", editorSite]]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.setDefaultTimeout(120000);
        const errors = [], missing = [];
        page.on("pageerror", error => errors.push(error.message));
        const messages = [];
        page.on("console", message => { if (message.type() === "error") messages.push(message.text()); });
        page.on("response", response => { if (response.status() >= 400) missing.push(response.url()); });
        await page.goto(`${host}/tests/host.html`);
        let releaseRenderer;
        const rendererGate = new Promise(resolve => { releaseRenderer = resolve; });
        await page.route("**/miacode-preview.js*", async route => { await rendererGate; await route.continue(); });
        const startupDiagnostics = setTimeout(() => {
          void frameDiagnostics(page).then(frames => console.error(JSON.stringify({ browser: name, product,
            slowInitialization: frames, errors, messages, missing }))).catch(error => console.error(String(error)));
        }, 15000);
        const initializing = page.evaluate(async ({ origin, sourceText }) => {
          const { createEditor } = await import(`${origin}/sdk/editor.mjs`);
          Object.assign(document.getElementById("one").style, { width: "1366px", height: "768px" });
          Object.assign(document.getElementById("two").style, { width: "360px", height: "240px" });
          window.editors = [createEditor(document.getElementById("one"), { resolution: { width: 600, height: 600 }, diagnostics: false }), createEditor(document.getElementById("two"), { diagnostics: false, theme: "light" })];
          window.documentEvents = [];
          editors[0].on("documentChanged", document => documentEvents.push(document.revision));
          await Promise.all(editors.map(editor => editor.ready));
          const documents = await Promise.all(editors.map((editor, index) => editor.load({ maidata: new Blob([sourceText], { type: "text/plain" }),
            ...(index === 1 ? { video: `${origin}/tests/fixtures/bg-pattern.webm` } : {}) })));
          await editors[0].command("document.metadataTitle", { value: "Edited title" });
          return { documents, saved: await editors[0].getDocumentSaveText(), second: await editors[1].getDocument(), events: documentEvents.length };
        }, { origin, sourceText }).catch(async error => {
          console.error(JSON.stringify({ browser: name, product, initialization: await frameDiagnostics(page), errors, messages, missing }));
          throw error;
        }).finally(() => clearTimeout(startupDiagnostics));
        void initializing.catch(() => {});
        try {
          const small = page.locator("#two > div > iframe").contentFrame().locator(".preview-container iframe");
          await small.waitFor({ state: "attached" });
          const height = await small.evaluate(async node => {
            await node.ownerDocument.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return node.getBoundingClientRect().height;
          });
          assert.ok(height >= 64, `${name}/${product}: initial 360x240 preview height ${height}`);
          console.log(`${name}/${product}: initial 360x240 preview height ${height}`);
        } finally { releaseRenderer(); }
        const initial = await initializing;
        assert.equal(initial.documents[0].title, "Product parity");
        assert.equal(initial.second.title, "Product parity");
        assert.ok(initial.saved.sourceText.includes("&title=Edited title"));
        assert.ok(initial.events > 0);
        await page.evaluate(() => Promise.race([
          editors[1].command("preview.seek", { second: .5 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Hidden compact preview seek stalled")), 5000)),
        ]));
        assert.equal((await page.evaluate(() => editors[1].getState())).currentTime, .5);
        const workbenchFrame = page.locator("#one > div > iframe").contentFrame();
        for (const [width, height] of [[1366, 768], [800, 500], [360, 640], [1200, 240]]) {
          await page.locator("#one").evaluate((node, size) => Object.assign(node.style, { width: `${size[0]}px`, height: `${size[1]}px` }), [width, height]);
          await workbenchFrame.locator(".workbench").evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const layout = await workbenchFrame.locator(".workbench").evaluate(node => ({ width: node.clientWidth, height: node.clientHeight, scrollWidth: document.documentElement.scrollWidth }));
          assert.equal(layout.width, width); assert.equal(layout.height, height); assert.ok(layout.scrollWidth <= width + 1);
          results.push({ browser: name, product, width, height, layout: "pass" });
        }
        await page.locator("#one").evaluate(node => Object.assign(node.style, { width: "1366px", height: "768px" }));
        await page.evaluate(async settings => { await editors[0].command("preview.settings", settings); await editors[0].command("preview.seek", { second: .5 }); }, renderSettings);
        const canvas = workbenchFrame.locator(".preview-container iframe").contentFrame().locator("#qt-screen canvas");
        await canvas.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
        const rendered = await canvas.screenshot();
        mkdirSync("artifacts/products", { recursive: true }); writeFileSync(`artifacts/products/${name}-${product}.png`, rendered);
        if (product === "main") renderReferences.set(name, { image: rendered, bounds: await canvas.boundingBox() });
        else {
          const meanDifference = await compareRender(page, renderReferences.get(name).image, rendered);
          assert.ok(meanDifference < 3, `${name}/${product} preview color difference ${meanDifference}`);
          results.push({ browser: name, product, meanDifference });
        }
        const input = workbenchFrame.locator(".source-input");
        await input.fill("(120){4}1,2,3,4,E");
        await workbenchFrame.locator(".workbench").evaluate(node => {
          const source = node.editor.workbench.sourceEditor, policy = source.nativePolicy;
          source.nativePolicy = async (...args) => { await new Promise(resolve => setTimeout(resolve, 50)); return policy(...args); };
        });
        await input.press("Home"); await input.press(",");
        assert.equal((await page.evaluate(() => editors[0].getDocument())).chartText, ",(120){4}1,2,3,4,E");
        assert.ok((await page.evaluate(() => editors[0].getDocumentSaveText())).sourceText.includes(",(120){4}1,2,3,4,E"));
        if (product === "editor") {
          const downloading = page.waitForEvent("download");
          await page.evaluate(() => editors[0].command("file.saveAll"));
          assert.equal((await downloading).suggestedFilename(), "maidata.txt");
        }
        await page.evaluate(async () => { await editors[0].command("preview.seek", { second: .3 }); await editors[0].command("preview.toggle"); });
        await page.waitForFunction(async () => (await editors[0].getState()).currentTime > .4);
        await page.evaluate(async () => { await editors[0].command("preview.toggle"); await editors[0].command("page.metadata"); });
        assert.equal(await workbenchFrame.locator("#workbench").evaluate(node => node.editor.viewState.activeEditorKey), "metadata");
        await page.evaluate(() => editors.forEach(editor => editor.destroy()));
        assert.equal(await page.locator("iframe").count(), 0);
        assert.deepEqual(missing, []); assert.deepEqual(errors, []);
        console.log(`${name}/${product}: editor SDK, isolated instances, commands, save, playback and four container sizes passed`);
        await page.close();
      }
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      page.setDefaultTimeout(120000);
      const errors = [], missing = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => { if (response.status() >= 400) missing.push(response.url()); });
      await page.goto(`${host}/tests/host.html`);
      const previewResult = await page.evaluate(async ({ previewSite, sourceText, bounds, renderSettings }) => {
        const { createPreview } = await import(`${previewSite}/sdk/index.mjs`);
        document.getElementById("one").style.width = `${bounds.width}px`;
        window.preview = createPreview(document.getElementById("one"), { diagnostics: false, controls: false, resolution: { width: 600, height: 600 } });
        await preview.ready;
        await preview.setSettings(renderSettings);
        const info = await preview.load({ maidata: sourceText });
        await preview.seek(.5); const state = await preview.getState();
        const snapshot = await preview.getDocument();
        return { info, state, document: snapshot };
      }, { previewSite, sourceText, bounds: renderReferences.get(name).bounds, renderSettings });
      assert.equal(previewResult.info.noteCount, 8); assert.equal(previewResult.document.chartText, "(120){4}1,2,3,4,5,6,7,8,E");
      assert.ok(Math.abs(previewResult.state.currentTime - .5) < .001);
      const canvas = page.locator("iframe").contentFrame().locator("#qt-screen canvas");
      await canvas.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      const captured = await canvas.screenshot(); writeFileSync(`artifacts/products/${name}-preview.png`, captured);
      const meanDifference = await compareRender(page, renderReferences.get(name).image, captured);
      assert.ok(meanDifference < 3, `${name}/preview color difference ${meanDifference}`);
      results.push({ browser: name, product: "preview", meanDifference });
      await page.evaluate(() => preview.destroy());
      await page.goto(`${previewSite}/index.html`);
      await page.waitForFunction(() => !document.getElementById("files").disabled, undefined, { timeout: 90000 });
      for (const name of ["Standard", "Explicit", "Image"]) {
        await page.locator("#files").setInputFiles(resolve(fixtureRoot, name));
        await page.waitForFunction(name => document.getElementById("difficulty").disabled === false && document.getElementById("status").textContent === name, name);
        const frame = page.locator("iframe").contentFrame();
        if (name === "Image") assert.equal(await frame.locator("#stage-video").getAttribute("src"), null);
        else assert.ok(await frame.locator("#stage-video").evaluate(video => video.readyState >= 2 && video.videoWidth > 0));
      }
      assert.deepEqual(missing, []); assert.deepEqual(errors, []);
      results.push({ browser: name, product: "preview", media: "folder audio/background/PV and explicit video/image paths", sdk: "pass", entry: "pass" });
      console.log(`${name}/preview: cross-origin SDK and independent folder/media entry passed`);
      await page.close();
    } finally { await browser.close(); }
  }
} finally {
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  mkdirSync("artifacts/products", { recursive: true });
  writeFileSync("artifacts/products/results.json", JSON.stringify({ productRoot, results }, null, 2) + "\n");
}

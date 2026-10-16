import { waitForAsync } from "./helpers/wait-async.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  let lastPoint;
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.ready; await editor.command("file.demo");
    await editor.command("preview.values", { touchPadAuthoringShortcut: true });
    editor.preview.on("touchPadAuthoring", event => { (window.authoringEvents ||= []).push(event); });
  });
  const command = (id, args) => page.evaluate(({ id, args }) => document.getElementById("workbench").editor.command(id, args), { id, args });
  async function seed(text, position) {
    await page.evaluate(() => {
      const editor = document.getElementById("workbench").editor;
      editor.viewState.openEditor(`difficulty:${editor.workbench.documentSession.activeDifficultyId}`);
      editor.viewState.compactView = "editor"; editor.viewState.changed();
    });
    await page.locator('.source-input').fill(text); await command("file.flushRecovery");
    await page.locator('.source-input').evaluate((node, position) => node.setSelectionRange(position, position), position);
    await page.evaluate(() => {
      const state = document.getElementById("workbench").editor.viewState;
      state.compactView = "preview"; state.changed();
    });
    await waitForAsync(page, async () => (await document.getElementById("workbench").editor.preview.getState()).settings.touchPadAuthoringContext);
  }
  const text = () => page.evaluate(() => document.getElementById("workbench").editor.preview.getDocument().then(doc => doc.chartText));
  await page.frameLocator('.preview-container iframe').locator('#qt-screen').evaluate(screen => {
    window.pointerTrace = [];
    for (const name of ["pointerdown", "pointerup", "pointerleave", "contextmenu", "keyup", "blur"])
      window.addEventListener(name, event => window.pointerTrace.push({ name, x: event.clientX, y: event.clientY,
        ctrl: event.ctrlKey, button: event.button, target: event.target.id || event.target.tagName }), { capture: true });
  });
  async function expectText(expected) {
    try { await page.waitForFunction(expected => document.getElementById("workbench").editor.workbench.documentSession.chartText === expected, expected, { timeout: 5000 }); }
    catch (error) {
      console.log(JSON.stringify({ expected, lastPoint, point: await padPoint(), text: await text(),
        events: await page.evaluate(() => window.authoringEvents),
        pointers: await page.frameLocator('.preview-container iframe').locator('#qt-screen').evaluate(() => window.pointerTrace), errors }));
      throw error;
    }
  }
  async function padPoint(pad = "C") {
    await page.frameLocator('.preview-container iframe').locator('#qt-screen').evaluate(() =>
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    try { await waitForAsync(page, async () => {
      const editor = document.getElementById("workbench").editor;
      const canvas = document.querySelector('.preview-container iframe').contentDocument.querySelector('#qt-shadow-container').shadowRoot.querySelector('canvas');
      const size = (await editor.preview.getState()).resolution;
      const box = canvas?.getBoundingClientRect();
      return box?.width > 0 && box.height > 0 && canvas.width === size.width && canvas.height === size.height;
    }); } catch(error) {
      const details=await page.evaluate(async()=>{
        const iframe=document.querySelector('.preview-container iframe'),canvas=iframe.contentDocument.querySelector('#qt-shadow-container').shadowRoot.querySelector('canvas');
        return {state:await document.getElementById("workbench").editor.preview.getState(),canvas:{width:canvas.width,height:canvas.height,box:canvas.getBoundingClientRect().toJSON()},dpr:iframe.contentWindow.devicePixelRatio};
      });
      console.log(JSON.stringify({records,details}));throw error;
    }
    const box = await page.frameLocator('.preview-container iframe').locator('#qt-screen canvas').boundingBox();
    const side = Math.min(box.width, box.height);
    const offset = pad === "C" ? [0, 0] : [Math.cos(-67.5 * Math.PI / 180) * .95 * 400 / 1080, Math.sin(-67.5 * Math.PI / 180) * .95 * 400 / 1080];
    return { x: box.x + box.width / 2 + side * offset[0], y: box.y + box.height / 2 + side * offset[1], box };
  }
  async function clickPad(pad = "C", button = "left", shift = false) {
    const { x, y, box } = await padPoint(pad);
    lastPoint = { x, y, box, hit: await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.outerHTML.slice(0,200), {x,y}) };
    await page.mouse.move(x, y);
    await page.keyboard.down("Control"); if (shift) await page.keyboard.down("Shift");
    await page.mouse.click(x, y, { button });
    if (shift) await page.keyboard.up("Shift"); await page.keyboard.up("Control");
  }
  for (const viewport of [{ width: 1366, height: 900 }, { width: 480, height: 900 }, { width: 1024, height: 360 }]) {
    await page.setViewportSize(viewport);
    await seed("(120){4},E", 8); await clickPad();
    await expectText("(120){4}C,E");
    await clickPad();
    await expectText("(120){4},E");
    await seed("(120){4}C,E", 9); await clickPad("A1", "left", true);
    await expectText("(120){4}C`A1,E");
    const simultaneous = await text();
    await seed("(120){4}C,E", 9); await clickPad("C", "right");
    await expectText("(120){4}C,C,E");
    records.push({ viewport, simultaneous, rightButton: await text() });
  }
  await command("preview.toggleFreeAspect");
  for (const viewport of [{ width: 1366, height: 900 }, { width: 480, height: 900 }, { width: 1024, height: 360 }]) {
    await page.setViewportSize(viewport);
    await seed("(120){4},E", 8); await clickPad("A1");
    await expectText("(120){4}A1,E");
    const resolution = await page.evaluate(() => document.getElementById("workbench").editor.preview.getState().then(state => state.resolution));
    records.push({ viewport, freeAspect: true, resolution, chartText: await text() });
  }
  await command("preview.toggleFreeAspect");
  await page.setViewportSize({ width: 1366, height: 900 });
  await seed("(120){4},E", 8);
  const point = await padPoint();
  await page.keyboard.down("Control"); await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.box.x + 5, point.box.y + 5); await page.mouse.up(); await page.keyboard.up("Control");
  assert.equal(await text(), "(120){4},E");
  await page.keyboard.down("Control"); await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.evaluate(() => document.getElementById("workbench").editor.load({ maidata: "&title=新触区文档\n&inote_5=(120){4}1,E\n" }));
  await page.mouse.up(); await page.keyboard.up("Control");
  assert.equal((await text()).trim(), "(120){4}1,E");
  await seed("(120){4},E", 8);
  await page.evaluate(() => document.getElementById("workbench").editor.viewState.openEditor("metadata"));
  await waitForAsync(page, async () => !(await document.getElementById("workbench").editor.preview.getState()).settings.touchPadAuthoringContext);
  await clickPad(); assert.equal(await text(), "(120){4},E");
  await seed("(120){4},E", 8); await command("preview.values", { touchPadAuthoringShortcut: false });
  await clickPad(); assert.equal(await text(), "(120){4},E");
  assert.deepEqual(errors, []);
  const output = resolve("artifacts/touch-authoring"); mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ records, errors }, null, 2) + "\n");
  console.log("Touch input passed at three viewport ratios with square/free canvas, simultaneity, beat insertion, cancelled gestures and document ownership");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

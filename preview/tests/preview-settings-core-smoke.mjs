import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.ready; await editor.command("file.demo");
  });
  const canvas = page.frameLocator('.preview-container iframe').locator('#qt-screen canvas');
  const before = await canvas.screenshot();
  await page.evaluate(() => document.getElementById("workbench").editor.command("preview.values", { layoutSquareScale: 50 }));
  const resized = await canvas.screenshot();
  assert.notDeepEqual(resized, before, "Layout scale changes the native rendered playfield");
  const values = { brightnessOuter: 35, brightnessInner: 60, layoutSquareScale: 75, scaleMode: 2,
    smoothBrightness: true, showTimestamp: false, showDebugInfo: true, forceLabeledJudgeLineWhenPaused: true,
    touchPadAuthoringShortcut: true, tapFlowSpeed: 9.25, touchFlowSpeed: 6.5, slideEarlierOnTop: false,
    centerDisplay: 5, tapJudgeTextDistance: 2, judgeEffectSlide: false, judgeEffectTap: true,
    judgeEffectBreak: true, judgeEffectTouch: true, skinIndex: 0, skinJudgeEffectIndex: 0, outlineIndex: 0 };
  const actual = await page.evaluate(values => document.getElementById("workbench").editor.command("preview.values", values), values);
  const { touchPadAuthoringContext, ...persisted } = actual;
  assert.equal(touchPadAuthoringContext, true);
  assert.equal(actual.outerBrightness, .35); assert.equal(actual.innerBrightness, .6);
  assert.equal(actual.layoutSquareScale, .75); assert.equal(actual.earlierSlideOnTop, false); assert.equal(actual.noteSkin, "SD");
  for (const [key, value] of Object.entries(values)) {
    if (!["brightnessOuter", "brightnessInner", "layoutSquareScale", "slideEarlierOnTop", "skinIndex"].includes(key)) assert.equal(actual[key], value, key);
  }
  await page.evaluate(() => document.getElementById("workbench").editor.command("page.preview-settings"));
  await page.locator('.settings-tabs [data-page="gameplay"]').click();
  const slider = page.getByRole("slider", { name: "Tap流速", exact: true });
  assert.equal(await slider.inputValue(), "9.25"); assert.equal(await slider.getAttribute("min"), "1"); assert.equal(await slider.getAttribute("max"), "10");
  const rejected = await page.evaluate(async () => {
    const preview = document.getElementById("workbench").editor.preview;
    try { await preview.setSettings({ centerDisplay: 8 }); } catch (error) { return error.message; }
  });
  assert.match(rejected, /centerDisplay/);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { touchPadAuthoringContext: settingsContext, ...settings } = (await page.evaluate(() => document.getElementById("workbench").editor.preview.getState())).settings;
  assert.equal(settingsContext, false); assert.deepEqual(settings, persisted);
  await page.reload(); await page.waitForFunction(() => document.getElementById("workbench")?.editor);
  const restored = await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor; await editor.ready;
    return (await editor.preview.getState()).settings;
  });
  const { touchPadAuthoringContext: restoredContext, ...restoredSettings } = restored;
  assert.equal(restoredContext, false); assert.deepEqual(restoredSettings, persisted);
  assert.deepEqual(errors, []);
  const output = resolve("artifacts/preview-settings-core"); mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ values, actual, restored, errors }, null, 2) + "\n");
  console.log("Native preview appearance, rendered geometry, skin, flow bounds, invalid input and preference restoration passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

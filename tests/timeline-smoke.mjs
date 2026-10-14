import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../dev/server.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/timeline"); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  await page.evaluate(() => document.getElementById("workbench").editor.command("file.demo"));
  await page.locator(".timeline-view image[data-sprite]").first().waitFor();
  const first = await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState);
  assert.equal(first.laneCount, 9);
  assert.ok(first.noteSprites.length + first.holdSpans.length >= 17);
  assert.ok(first.holdSpans.length > 0);
  assert.ok(first.trackSprites.length > 0);
  assert.ok(first.headerLabels.length > 0);
  assert.ok(Object.values(first.images).every(image => image.width > 0 && image.height > 0 && image.url.startsWith("data:image/png;base64,")));
  await page.locator(".timeline-view").screenshot({ path: resolve(output, "timeline-dark.png") });
  records.push({ theme: "dark", notes: first.noteSprites.length, tracks: first.trackSprites.length, holds: first.holdSpans.length, images: Object.keys(first.images).length });
  const sprite = first.noteSprites.find(note => note.spriteType === "tap" && note.center.x > first.timelineLeft && note.center.x < first.viewportSize.width);
  assert.ok(sprite);
  const bounds = await page.locator(".timeline-view").boundingBox();
  await page.mouse.click(bounds.x + sprite.center.x, bounds.y + sprite.center.y);
  await page.waitForFunction(() => {
    const input = document.getElementById("workbench").editor.workbench.sourceEditor.input;
    return document.activeElement === input && /[1-8]/.test(input.value.slice(input.selectionStart, input.selectionStart + 1));
  });
  const selection = await page.evaluate(() => {
    const input = document.getElementById("workbench").editor.workbench.sourceEditor.input;
    return { text: input.value.slice(input.selectionStart, input.selectionStart + 1), position: input.selectionStart };
  });
  assert.ok(/[1-8]/.test(selection.text), `Timeline source position: ${JSON.stringify(selection)}`);
  await page.evaluate(() => document.getElementById("workbench").editor.command("timeline.zoom", { delta: -600 }));
  const zoomed = await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState);
  assert.ok(zoomed.pixelsPerSecond > first.pixelsPerSecond);
  await page.evaluate(() => document.getElementById("workbench").editor.command("timeline.scroll", { delta: 120 }));
  const scrolled = await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState);
  assert.ok(scrolled.horizontalScrollValue > 0);
  for (const theme of ["light", "legacy", "legacy_light"]) {
    await page.evaluate(theme => document.getElementById("workbench").editor.viewState.setPreference("darkThemeToken", theme), theme);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.locator(".timeline-view").screenshot({ path: resolve(output, `timeline-${theme}.png`) });
    records.push({ theme });
  }
  assert.deepEqual(errors, []);
  console.log("Native timeline notes, tracks, holds, source navigation, zoom and scrolling passed");
} finally {
  writeFileSync(resolve(output, "results.json"), JSON.stringify(records, null, 2) + "\n");
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

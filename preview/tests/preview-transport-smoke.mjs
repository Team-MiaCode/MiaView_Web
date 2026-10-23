import { waitForAsync } from "./helpers/wait-async.mjs";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../dev/server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/preview-controls");
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await launchPreviewBrowser(playwright, "chromium");
const references = JSON.parse(readFileSync(".assets/ui-reference/reference.json", "utf8"));
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 420 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const [theme, reference] of Object.entries(references.themes)) {
    for (const capture of reference.previewControls.captures) {
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=preview-controls&width=${capture.width}&theme=${theme}${capture.loaded ? "&loaded=1" : ""}`);
      await page.locator(".preview-control-row").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const dimensions = await page.evaluate(() => {
        const host = document.getElementById("page"), row = document.querySelector(".preview-control-row");
        const parent = host.getBoundingClientRect();
        return { height: parent.height, transportHeight: document.querySelector(".preview-transport").getBoundingClientRect().height,
          statisticsHeight: document.querySelector(".note-statistics").getBoundingClientRect().height,
          buttons: [...row.querySelectorAll("button")].map(node => { const box = node.getBoundingClientRect(); return { key: node.querySelector("[data-icon]")?.dataset.icon, label: node.getAttribute("aria-label"), x: box.x - parent.x, y: box.y - parent.y, width: box.width, height: box.height }; }) };
      });
      for (const key of ["height", "transportHeight", "statisticsHeight"]) assert.ok(Math.abs(dimensions[key] - capture[key]) <= 1, `${theme}/${capture.width}/${key}: ${dimensions[key]} vs ${capture[key]}`);
      for (const expected of capture.controls) {
        const name = expected.iconSource.split("/").at(-1).replace(".svg", "");
        const actual = dimensions.buttons.find(button => button.key === name);
        assert.ok(actual, name);
        for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(actual[key] - expected[key]) <= 2, `${theme}/${capture.width}/${name}/${key}: ${actual[key]} vs ${expected[key]}`);
      }
      await page.locator("#page").screenshot({ path: resolve(output, capture.image) });
      results.push({ theme, loaded: capture.loaded, width: capture.width, ...dimensions });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  await page.evaluate(() => document.getElementById("workbench").editor.command("file.demo"));
  await page.evaluate(() => document.getElementById("workbench").editor.command("preview.toggleFreeAspect"));
  async function checkFreeAspect() {
    return page.evaluate(async () => {
      const api = document.getElementById("workbench").editor;
      const size = (await api.preview.getState()).resolution;
      const bounds = api.workbench.previewContainer.getBoundingClientRect();
      return Math.abs(size.width / size.height - bounds.width / bounds.height) < .005;
    });
  }
  assert.equal(await checkFreeAspect(), true);
  await page.setViewportSize({ width: 1600, height: 900 });
  await waitForAsync(page, async () => {
    const api = document.getElementById("workbench").editor;
    const size = (await api.preview.getState()).resolution;
    const bounds = api.workbench.previewContainer.getBoundingClientRect();
    return Math.abs(size.width / size.height - bounds.width / bounds.height) < .005;
  });
  assert.equal(await checkFreeAspect(), true);
  await page.evaluate(() => document.getElementById("workbench").editor.command("preview.toggleFreeAspect"));
  assert.equal((await page.evaluate(() => document.getElementById("workbench").editor.preview.getState())).resolution.width, 1080);
  const controls = page.locator(".preview-transport");
  assert.equal(await page.frameLocator(".preview-container iframe").locator("#transport").isVisible(), false);
  await controls.getByRole("button", { name: "播放速度", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "0.5x", exact: true }).click();
  await waitForAsync(page, async () => (await document.getElementById("workbench").editor.preview.getState()).playback.rate === .5);
  await controls.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".preview-time").textContent.startsWith("00:01"));
  await controls.getByRole("button", { name: "暂停", exact: true }).click();
  const state = await page.evaluate(() => document.getElementById("workbench").editor.preview.getState());
  assert.equal(state.playing, false);
  assert.equal(state.playback.rate, .5);
  await page.evaluate(() => document.getElementById("workbench").editor.preview.setPlayback({ rangePlaybackEnabled: true, exportStartSeconds: 2, exportEndSeconds: 2.3, rate: 2 }));
  await controls.getByRole("button", { name: "播放", exact: true }).click();
  await waitForAsync(page, async () => {
    const state = await document.getElementById("workbench").editor.preview.getState();
    return !state.playing && state.currentTime === 2.3;
  });
  await controls.getByRole("button", { name: "停止", exact: true }).click();
  await waitForAsync(page,async()=>(await document.getElementById("workbench").editor.preview.getState()).currentTime===0);
  assert.equal((await page.evaluate(() => document.getElementById("workbench").editor.preview.getState())).currentTime, 0);
  assert.deepEqual(errors, []);
  console.log("Original preview control geometry, free canvas fit, external transport, rate and bounded playback passed");
} finally {
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

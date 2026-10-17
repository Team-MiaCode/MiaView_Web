import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../dev/server.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/timeline-controls"); mkdirSync(output, { recursive: true });
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
  const originalScale = await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState.pixelsPerSecond);
  await page.getByRole("button", { name: "时间轴缩放", exact: true }).click();
  assert.equal(await page.getByRole("menuitemradio").count(), 7);
  assert.equal(await page.getByRole("menuitemradio", { name: "50%", exact: true }).getAttribute("aria-checked"), "true");
  await page.getByRole("menuitemradio", { name: "300%", exact: true }).click();
  await page.waitForFunction(original => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState.pixelsPerSecond > original * 5, originalScale);
  assert.equal(await page.locator(".timeline-zoom span").first().textContent(), "300%");
  await page.getByRole("button", { name: "时间轴缩放", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "50%", exact: true }).click();
  const beforeColor = await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState.gridLines[0].color);
  await page.getByRole("button", { name: "时间轴亮度", exact: true }).click();
  const brightness = page.getByRole("dialog", { name: "时间轴亮度", exact: true });
  for (const [label, value] of [["波形图亮度", "200"], ["网格线亮度", "20"]]) {
    await brightness.getByRole("slider", { name: label, exact: true }).fill(value);
    await brightness.getByRole("slider", { name: label, exact: true }).dispatchEvent("input");
  }
  await page.waitForFunction(color => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState.gridLines[0].color !== color, beforeColor);
  assert.equal(await brightness.locator("output").first().textContent(), "200%");
  assert.equal(await brightness.locator("output").last().textContent(), "20%");
  assert.equal(await brightness.isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await brightness.count(), 0);
  assert.equal(await page.getByRole("button", { name: "时间轴亮度", exact: true }).evaluate(node => document.activeElement === node), true);
  await page.getByRole("checkbox", { name: "代码跟随", exact: true }).check();
  const selectedPosition = await page.evaluate(() => {
    const editor = document.getElementById("workbench").editor;
    editor.workbench.sourceEditor.input.setSelectionRange(7, 7);
    return editor.workbench.sourceEditor.input.selectionStart;
  });
  await page.evaluate(() => document.getElementById("workbench").editor.preview.seek(1.2));
  await page.waitForFunction(() => {
    const source = document.getElementById("workbench").editor.workbench.sourceEditor;
    return source.followState?.active && CSS.highlights.has(source.followHighlight);
  });
  const follow = await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    const source = editor.workbench.sourceEditor;
    const state = await editor.preview.getTimelineFollow(1.2);
    return { state, selection: source.input.selectionStart,
      expected: source.input.value.slice(state.start, state.end).replaceAll("\n", ""),
      painted: [...CSS.highlights.get(source.followHighlight)][0].toString().replaceAll("\u200b", "") };
  });
  assert.equal(follow.state.active, true);
  assert.equal(follow.selection, selectedPosition);
  assert.equal(follow.painted, follow.expected);
  assert.match(follow.painted, /[1-8]/);
  await page.getByRole("checkbox", { name: "代码跟随", exact: true }).uncheck();
  assert.equal(await page.evaluate(() => {
    const source = document.getElementById("workbench").editor.workbench.sourceEditor;
    return CSS.highlights.has(source.followHighlight);
  }), false);
  for (const theme of ["dark", "light", "legacy", "legacy_light"]) {
    await page.evaluate(theme => document.getElementById("workbench").editor.viewState.setPreference("darkThemeToken", theme), theme);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.locator(".bottom-tabs").screenshot({ path: resolve(output, `tabs-${theme}.png`) });
    await page.getByRole("button", { name: "时间轴缩放", exact: true }).click();
    const zoomBounds = await page.getByRole("menu").boundingBox();
    assert.ok(Math.abs(zoomBounds.height - 210) <= 1);
    await page.getByRole("menu").screenshot({ path: resolve(output, `zoom-${theme}.png`) });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "时间轴亮度", exact: true }).click();
    const popup = page.getByRole("dialog", { name: "时间轴亮度", exact: true });
    await popup.screenshot({ path: resolve(output, `brightness-${theme}.png`) });
    const brightnessBounds = await popup.boundingBox();
    assert.equal(brightnessBounds.width, 214);
    assert.ok(Math.abs(brightnessBounds.height - 118) <= 1);
    for (const font of ["Arial", "serif"]) {
      await popup.evaluate((node, font) => { node.style.fontFamily = font; }, font);
      assert.equal((await popup.boundingBox()).height, brightnessBounds.height, `${theme}/${font} brightness popup height`);
    }
    await popup.evaluate(node => { node.style.fontFamily = ""; });
    records.push({ theme, brightness: brightnessBounds, zoomPopup: zoomBounds, zoom: await page.locator(".timeline-zoom").boundingBox() });
    await page.keyboard.press("Escape");
  }
  // Canonical document fields retain source positions with indentation and CRLF.
  const source = "&title=位置校验\r\n&first=0\r\n&lv_05=12\r\n  &inote_05 =\r\n(120){4}1,2,3,4,E\r\n";
  await page.evaluate(source => document.getElementById("workbench").editor.load({ maidata: source }), source);
  const location = await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    const state = await editor.preview.getTimelineFollow(.1);
    return { state, text: editor.workbench.sourceEditor.input.value.slice(state.start, state.end) };
  });
  assert.equal(location.state.active, true);
  assert.match(location.text, /1/);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ browser: browser.version(), follow, location, records, errors }, null, 2) + "\n");
  console.log("Timeline zoom, sticky brightness controls, source follow, field offsets, focus and four themes passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

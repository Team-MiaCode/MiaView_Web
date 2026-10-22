import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../dev/server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium";
const output = resolve("artifacts/timeline-interaction", name + (process.env.MIACODE_SOFTWARE_VIDEO === "1" ? "-software" : ""));
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await launchPreviewBrowser(playwright, name), results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(120000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.MIACODE_WORKBENCH_URL || `http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(async ({ video, software }) => {
    window.editor = document.getElementById("workbench").editor;
    await editor.ready;
    if (software) await editor.command("preferences.performance", { videoDecodePrefersSoftware: true });
    await editor.load({ maidata: "&title=Timeline interactions\n&inote_5=(120){4}\n" + "1,2,3,4,\n".repeat(64) + "E", difficulty: 5,
      video: new Blob([Uint8Array.from(atob(video), char => char.charCodeAt(0))], { type: "video/webm" }) });
  }, { video: readFileSync(resolve("tests/fixtures/bg-pattern.webm")).toString("base64"), software: process.env.MIACODE_SOFTWARE_VIDEO === "1" });
  const command = (id, args) => page.evaluate(([id, args]) => editor.command(id, args), [id, args]);
  const settled = async () => {
    try { await waitForAsync(page, () => !editor.workbench.timelineView.interactionPending && !editor.workbench.timelineView.drag, undefined, { timeout: 10000 }); }
    catch (error) {
      console.log(await page.evaluate(() => ({ drag: editor.workbench.timelineView.drag, target: editor.workbench.timelineView.interactionTarget,
        pending: Boolean(editor.workbench.timelineView.interactionPending), status: editor.workbench.statusLabel.textContent })));
      throw error;
    }
  };
  const snapshot = () => page.evaluate(async () => {
    const view = editor.workbench.timelineView, state = view.state, playback = await editor.preview.getState();
    const { timelineSecondAtX } = await import("./ui/workbench/timeline-playback.mjs");
    return { second: playback.currentTime, playing: playback.playing, scroll: view.scrollValue,
      center: timelineSecondAtX(state, state.viewportSize.width / 2, view.scrollValue),
      cursor: (state.cursorLine.start.x - state.timelineLeft - state.leadingCenteringPadding) / state.pixelsPerSecond + state.displayStartSeconds,
      entry: state.hasEntryMarker ? (state.entryMarker.a.x - state.timelineLeft - state.leadingCenteringPadding) / state.pixelsPerSecond + state.displayStartSeconds : null,
      position: editor.workbench.sourceEditor.input.selectionStart, state };
  });
  const point = (second, header = true) => page.evaluate(({ second, header }) => {
    const view = editor.workbench.timelineView, state = view.state, bounds = view.root.getBoundingClientRect();
    const x = state.timelineLeft + state.leadingCenteringPadding + (second - state.displayStartSeconds) * state.pixelsPerSecond - view.scrollValue;
    return { x: bounds.x + x, y: bounds.y + (header ? state.timelineTop / 2 : state.timelineTop + 12) };
  }, { second, header });
  const browse = async second => {
    const scroll = await page.evaluate(async second => {
      const { timelineCenteredScroll } = await import("./ui/workbench/timeline-playback.mjs");
      return timelineCenteredScroll(editor.workbench.timelineView.state, second);
    }, second);
    await command("timeline.playbackViewport", { horizontalScrollValue: scroll });
  };
  await browse(10);
  for (const modifier of [null, "Control", "Meta"]) {
    await browse(10);
    const target = await point(10.35, !modifier);
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.click(target.x, target.y);
    if (modifier) await page.keyboard.up(modifier);
    await settled();
    const result = await snapshot();
    assert.ok(Math.abs(result.second - 10.35) < 1e-9, `${modifier}: continuous preview time ${result.second}`);
    assert.ok(Math.abs(result.cursor - 10) < 1e-9, `${modifier}: preceding code anchor ${result.cursor}`);
    assert.ok(Math.abs(result.center - 10.35) < 1e-9);
    assert.equal(await page.locator(".source-input").evaluate(node => node === document.activeElement), true);
    results.push({ navigation: modifier || "header", second: result.second, cursor: result.cursor });
  }
  await command("preview.seek", { second: 12.25 });
  await browse(20.5);
  const sourcePosition = (await snapshot()).position;
  let target = await point(22, false);
  await page.mouse.move(target.x, target.y); await page.mouse.down();
  await waitForAsync(page, () => editor.workbench.timelineView.drag?.ready);
  let result = await snapshot();
  assert.ok(Math.abs(result.second - 20.5) < 1e-9, "Body press uses the browsed viewport center");
  assert.equal(result.position, sourcePosition);
  assert.equal(await page.locator('[data-overlay="dragCenterLine"]').evaluate(node => getComputedStyle(node).display !== "none"), true);
  assert.equal(await page.locator('[data-overlay="playheadLine"]').evaluate(node => getComputedStyle(node).display), "none");
  await page.mouse.up(); await settled();
  result = await snapshot(); assert.ok(Math.abs(result.second - 20.5) < 1e-9); assert.equal(result.playing, false);
  results.push({ bodyTap: result.second });

  // Pointer movement and release can arrive before the asynchronous pause completes.
  await page.evaluate(async () => {
    const owner = editor.preview.windowRouter.active, pause = owner.pause.bind(owner);
    window.restorePause = () => { owner.pause = pause; };
    owner.pause = async () => {
      await new Promise(resolve => setTimeout(resolve, 120));
      const state = await pause(); window.dragPauseSecond = state.currentTime; return state;
    };
    await editor.preview.seek(30); await editor.preview.play();
  });
  target = await point(30, false);
  await page.mouse.move(target.x, target.y); await page.mouse.down();
  await page.mouse.move(target.x - 120, target.y); await page.mouse.up();
  await settled(); await page.evaluate(() => restorePause());
  result = await snapshot();
  assert.equal(result.playing, false);
  const expectedRelease = await page.evaluate(() => dragPauseSecond + 2);
  assert.ok(Math.abs(result.second - expectedRelease) < 1e-9, `Paused playback anchor plus 120px drag: ${result.second} / ${expectedRelease}`);
  assert.ok(Math.abs(result.second - result.center) < 1e-9);
  assert.equal(result.position, sourcePosition);
  assert.ok(Math.abs(result.cursor - 10) < 1e-9);
  assert.equal(result.entry, 30, "Playback entry remains at its start");
  results.push({ earlyRelease: result.second });

  for (const zoomScale of [.5, 1]) {
    await command("timeline.settings", { zoomScale }); await browse(40.125);
    target = await point(41, false);
    await page.mouse.move(target.x, target.y); await page.mouse.down();
    await waitForAsync(page, () => editor.workbench.timelineView.drag?.ready);
    await page.mouse.move(target.x - 120, target.y, { steps: 8 }); await page.mouse.up(); await settled();
    result = await snapshot();
    assert.ok(Math.abs(result.second - (40.125 + 120 / (120 * zoomScale))) < 1e-9);
    assert.ok(Math.abs(result.center - result.second) < 1e-9);
    assert.equal(await page.locator('[data-overlay="dragCenterLine"]').evaluate(node => getComputedStyle(node).display), "none");
    results.push({ zoomScale, dragged: result.second });
  }
  const beforeOutside = await snapshot(), timelineBounds = await page.locator(".timeline-view").boundingBox();
  target = await point(beforeOutside.second, false);
  await page.mouse.move(target.x, target.y); await page.mouse.down();
  await waitForAsync(page, () => editor.workbench.timelineView.drag?.ready);
  const startPixel = Math.round(target.x - timelineBounds.x);
  await page.mouse.move(timelineBounds.x - .5, target.y); await page.mouse.up(); await settled();
  result = await snapshot();
  assert.ok(Math.abs(result.second - (beforeOutside.second + (startPixel + 1) / 120)) < 1e-9);
  results.push({ outsideRelease: result.second });
  const beforeCancel = await snapshot(); target = await point(beforeCancel.second, false);
  await page.mouse.move(target.x, target.y); await page.mouse.down();
  await waitForAsync(page, () => editor.workbench.timelineView.drag?.ready);
  await page.mouse.move(target.x + 60, target.y);
  const pointerId = await page.evaluate(() => editor.workbench.timelineView.drag.pointerId);
  await page.locator(".timeline-view").dispatchEvent("pointercancel", { pointerId, button: 0 });
  await page.mouse.up(); await settled(); result = await snapshot();
  assert.ok(Math.abs(result.second - (beforeCancel.second - .5)) < 1e-9);
  assert.equal(result.playing, false); results.push({ cancelFinal: result.second });
  const beforeZoom = await snapshot();
  await page.locator(".timeline-view").hover(); await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120); await page.keyboard.up("Control");
  await waitForAsync(page, () => editor.workbench.timelineView.state.pixelsPerSecond === 180);
  result = await snapshot();
  assert.ok(Math.abs(result.center - beforeZoom.center) < 1e-9, `Zoom keeps the center: ${beforeZoom.center} -> ${result.center}`);
  assert.equal(result.second, beforeZoom.second);
  results.push({ zoomCenter: result.center });
  await page.evaluate(() => editor.preview.play());
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -120); await page.keyboard.up("Control");
  await waitForAsync(page, () => editor.workbench.timelineView.state.pixelsPerSecond === 240);
  assert.equal((await snapshot()).playing, true);
  await page.evaluate(() => editor.preview.pause());
  const rapidCenter = (await snapshot()).center;
  await page.evaluate(() => Promise.all([.25, 3, 1, .5].map(zoomScale => editor.command("timeline.settings", { zoomScale }))));
  result = await snapshot();
  assert.ok(Math.abs(result.center - rapidCenter) < 1e-9); assert.equal(result.state.pixelsPerSecond, 60);
  await page.evaluate(async () => {
    await editor.load({ maidata: "&first=3\n&inote_5=(120){4}\n1,2,3,4,E", difficulty: 5 });
  });
  await browse(.35);
  target = await point(.35);
  await page.mouse.click(target.x, target.y); await settled(); result = await snapshot();
  assert.ok(Math.abs(result.second - .35) < 1e-9);
  assert.equal(result.position, 0); assert.equal(result.cursor, 0);
  results.push({ beforeFirstAnchor: { second: result.second, position: result.position, cursor: result.cursor } });
  assert.deepEqual(errors, []);
  console.log(`${name}: continuous header/Ctrl/Meta navigation, center tap, pause-anchored drag, final commit and zoom anchor passed`);
} finally {
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

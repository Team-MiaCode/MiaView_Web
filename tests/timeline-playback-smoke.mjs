import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", output = resolve("artifacts/timeline-playback", name);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(playwright, name), results = [];
const deadline = setTimeout(() => { console.error("Timeline playback acceptance exceeded 180 seconds"); void browser.close(); }, 180000);
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(120000); const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    for (const type of ["pointerdown", "wheel", "keydown"]) document.addEventListener(type, event => {
      const workbench = document.getElementById("workbench")?.editor?.workbench;
      if (workbench && event.target.closest?.(".source-input,.timeline-view")) {
        const audio = workbench.previewContainer.querySelector("iframe").contentWindow.playbackAudio;
        if (audio) window.lastPlaybackInteraction = { second: audio.currentSecond(), timelineSecond: workbench.timelineView.playbackSecond() };
      }
    }, { capture: true });
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      return resume.call(this).then(() => {
        if (window.top.delayPlayResume) return new Promise(resolve => { window.top.releasePlayResume = resolve; });
      });
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  console.log("Timeline playback: load");
  await page.evaluate(async () => {
    window.editor = document.getElementById("workbench").editor; await editor.ready;
    const chart = "(120){4}\n" + "1,2,3,4,\n".repeat(128) + "E";
    await editor.load({ maidata: `&title=Timeline follow\n&inote_5=${chart}\n&inote_6=${chart}`, difficulty: 5 });
  });
  await page.frameLocator(".preview-container iframe").locator("body").evaluate(async () => {
    const { PreviewAudio } = await import("./runtime.mjs");
    const currentSecond = PreviewAudio.prototype.currentSecond;
    const pause = PreviewAudio.prototype.pause;
    PreviewAudio.prototype.currentSecond = function (...args) {
      window.playbackAudio = this;
      return currentSecond.apply(this, args);
    };
    PreviewAudio.prototype.pause = function (...args) {
      const result = pause.apply(this, args);
      window.lastAudioPause = this.offset;
      return result;
    };
  });
  await page.evaluate(() => editor.preview.play());
  await waitForAsync(page, async () => (await editor.preview.getState()).currentTime > .3);
  const initialFollow = await page.evaluate(async () => {
    const view = editor.workbench.timelineView, first = view.scrollValue;
    await new Promise(resolve => setTimeout(resolve, 400));
    return { first, last: view.scrollValue, playing: view.clock.playing };
  });
  assert.equal(initialFollow.playing, true);
  assert.ok(initialFollow.last > initialFollow.first, `Playback from zero follows the timeline: ${JSON.stringify(initialFollow)}`);
  results.push({ initialFollow });
  await page.evaluate(() => editor.preview.pause());
  const source = page.locator(".source-input");
  for (const action of ["click", "wheel", "shortcut"]) {
    await page.evaluate(async () => { await editor.preview.seek(12); await editor.preview.play(); });
    if (action === "click") await source.click();
    if (action === "wheel") { await source.hover(); await page.mouse.wheel(0, 100); }
    if (action === "shortcut") { await source.focus(); await page.keyboard.press("Control+Shift+x"); }
    await waitForAsync(page, async () => !(await editor.preview.getState()).playing, undefined, { timeout: 5000 });
    const { state, interaction, pauseSecond } = await page.evaluate(async () => ({ state: await editor.preview.getState(), interaction: window.lastPlaybackInteraction,
      pauseSecond: editor.workbench.previewContainer.querySelector("iframe").contentWindow.lastAudioPause }));
    const interactionSecond = interaction.second;
    assert.ok(state.currentTime >= interactionSecond, `${action} preserves progress made before the input event`);
    assert.equal(state.currentTime, pauseSecond, `${action} retains the audio owner's pause position`);
    await page.waitForTimeout(100);
    assert.equal((await page.evaluate(() => editor.preview.getState())).currentTime, state.currentTime, `${action} remains paused`);
    results.push({ textInteraction: action, interactionSecond, timelineSecond: interaction.timelineSecond, time: state.currentTime,
      pauseLatencyMs: (state.currentTime - interactionSecond) * 1000, playing: state.playing });
  }
  await page.evaluate(() => Promise.all([editor.command("preview.toggle"), editor.command("preview.toggle")]));
  assert.equal((await page.evaluate(() => editor.preview.getState())).playing, false, "Two rapid toggles end paused");
  await page.evaluate(() => { window.delayPlayResume = true; window.pendingPlay = editor.command("preview.toggle"); });
  await page.waitForFunction(() => typeof window.releasePlayResume === "function");
  await page.evaluate(async () => {
    await editor.command("preview.toggle"); await window.pendingPlay;
    window.delayPlayResume = false; window.releasePlayResume();
    delete window.releasePlayResume; delete window.pendingPlay;
  });
  assert.equal((await page.evaluate(() => editor.preview.getState())).playing, false, "Pause cancels an asynchronous play request");
  for (const key of ["metadata", "difficulty:5", "preferences", "difficulty:5", "difficulty:6", "difficulty:5", "latency", "difficulty:5"]) {
    const before = await page.evaluate(async () => {
      await editor.preview.seek(12); await editor.preview.play();
      return (await editor.preview.getState()).currentTime;
    });
    await page.evaluate(key => key.startsWith("difficulty:")
      ? editor.command("document.selectDifficulty", { difficulty: Number(key.slice(11)) })
      : editor.command(`page.${key}`), key);
    await waitForAsync(page, async () => !(await editor.preview.getState()).playing, `${key} pauses playback`, { timeout: 5000 });
    const after = await page.evaluate(() => editor.preview.getState());
    assert.ok(Math.abs(after.currentTime - before) < .5, `${key} retains playback position: ${before} -> ${after.currentTime}`);
    results.push({ navigation: key, before, after: after.currentTime, playing: after.playing });
  }
  await page.evaluate(async () => {
    await editor.command("document.selectDifficulty", { difficulty: 6 });
    await editor.preview.seek(12); await editor.preview.play();
    await editor.command("editor.close", { key: "difficulty:6" });
  });
  const closed = await page.evaluate(() => editor.preview.getState());
  assert.equal(closed.playing, false); assert.equal(closed.difficultyId, 5);
  assert.ok(Math.abs(closed.currentTime - 12) < .5);
  const timeline = page.locator(".timeline-view");
  const bodyPoint = async () => {
    const box = await timeline.boundingBox();
    const top = await page.evaluate(() => editor.workbench.timelineView.state.timelineTop);
    return { x: box.x + box.width / 2, y: box.y + top + 15 };
  };
  const start = async () => {
    await page.evaluate(async () => { await editor.preview.seek(12); await editor.preview.play(); });
    await waitForAsync(page, () => editor.workbench.timelineView.clock.playing);
  };
  await start();
  let point = await bodyPoint();
  await page.mouse.click(point.x + 80, point.y);
  await waitForAsync(page, () => !editor.workbench.timelineView.interactionPending);
  let afterInteraction = await page.evaluate(() => editor.preview.getState());
  assert.equal(afterInteraction.playing, false);
  const clickSecond = await page.evaluate(() => lastPlaybackInteraction.second);
  assert.ok(afterInteraction.currentTime >= clickSecond, "Body click preserves progress made before pointer press");
  assert.ok(Math.abs(afterInteraction.currentTime - clickSecond) < .3, `Body click retains time: ${clickSecond} / ${afterInteraction.currentTime}`);
  assert.equal(afterInteraction.currentTime, await page.evaluate(() => editor.workbench.previewContainer.querySelector("iframe").contentWindow.lastAudioPause));
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => editor.preview.getState())).currentTime, afterInteraction.currentTime, "Body click remains paused");
  results.push({ bodyClick: { pressed: clickSecond, paused: afterInteraction.currentTime } });
  await start(); point = await bodyPoint();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await waitForAsync(page, async () => !(await editor.preview.getState()).playing);
  const dragStart = await page.evaluate(() => ({ second: editor.workbench.timelineView.playbackSecond(), scroll: editor.workbench.timelineView.drag.scroll,
    state: editor.workbench.timelineView.state }));
  await page.mouse.move(point.x - 180, point.y, { steps: 8 }); await page.mouse.up();
  await waitForAsync(page, () => !editor.workbench.timelineView.interactionPending);
  afterInteraction = await page.evaluate(() => editor.preview.getState());
  const expectedDrag = dragStart.state.displayStartSeconds + (dragStart.state.viewportSize.width / 2 + dragStart.scroll + 180
    - dragStart.state.timelineLeft - dragStart.state.leadingCenteringPadding) / dragStart.state.pixelsPerSecond;
  assert.equal(afterInteraction.playing, false);
  assert.ok(Math.abs(afterInteraction.currentTime - expectedDrag) < .05, `Drag center: ${afterInteraction.currentTime} / ${expectedDrag}`);
  results.push({ drag: { before: dragStart.second, after: afterInteraction.currentTime, expected: expectedDrag } });
  await start(); point = await bodyPoint(); await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 120);
  await waitForAsync(page, async () => !(await editor.preview.getState()).playing);
  await waitForAsync(page, () => !editor.workbench.timelineView.interactionPending);
  afterInteraction = await page.evaluate(() => editor.preview.getState());
  assert.ok(afterInteraction.currentTime > 13.5, `Wheel moves the paused viewport: ${afterInteraction.currentTime}`);
  await start();
  const header = await page.evaluate(() => {
    const view = editor.workbench.timelineView, bounds = view.root.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2 + 100, y: bounds.y + view.state.timelineTop / 2 };
  });
  await page.mouse.click(header.x, header.y);
  await waitForAsync(page, () => !editor.workbench.timelineView.interactionPending);
  afterInteraction = await page.evaluate(() => editor.preview.getState());
  assert.equal(afterInteraction.playing, false);
  assert.ok(afterInteraction.currentTime > 13, `Number strip navigates: ${afterInteraction.currentTime}`);
  results.push({ headerClick: afterInteraction.currentTime, paused: !afterInteraction.playing });
  for (const [zoomScale, rate, mode] of [[.25, .5, 0], [.5, 1, 1], [1.5, 2, 2], [3, 1, 3]]) {
    console.log(JSON.stringify({ zoomScale, rate, mode }));
    await page.evaluate(async ({ zoomScale, rate, mode }) => {
      await editor.preview.pause(); await editor.preview.setPlayback({ rate });
      await editor.command("timeline.settings", { zoomScale });
      await editor.command("preferences.performance", { timelineFrameRateMode: mode });
      await editor.preview.seek(60); await editor.preview.play();
    }, { zoomScale, rate, mode });
    await waitForAsync(page, () => editor.workbench.timelineView.clock.playing && editor.workbench.timelineView.scrollValue > 0);
    const sample = await page.evaluate(async () => {
      const view = editor.workbench.timelineView, samples = [];
      for (let frame = 0; frame < 45; ++frame) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const line = view.playhead, matrix = line.getScreenCTM(), rect = view.root.getBoundingClientRect();
        const point = new DOMPoint(Number(line.getAttribute("x1")), 0).matrixTransform(matrix);
        samples.push({ error: Math.abs(point.x - rect.x - rect.width / 2), scroll: view.scrollValue });
      }
      return { samples, nativeState: view.state, mode: view.frameLimiter.maxFps };
    });
    assert.ok(sample.samples.every(item => item.error <= 1), JSON.stringify(sample.samples));
    assert.ok(sample.samples.at(-1).scroll > sample.samples[0].scroll);
    await page.evaluate(() => editor.preview.pause());
    await waitForAsync(page, () => !editor.workbench.timelineView.clock.playing);
    const stopped = await page.evaluate(async () => {
      const view = editor.workbench.timelineView, scroll = view.scrollValue;
      await new Promise(resolve => setTimeout(resolve, 150)); return { scroll, after: view.scrollValue, animation: view.animation };
    });
    assert.equal(stopped.scroll, stopped.after); assert.equal(stopped.animation, null);
    results.push({ zoomScale, rate, mode, maximumCenterError: Math.max(...sample.samples.map(item => item.error)),
      firstScroll: sample.samples[0].scroll, lastScroll: sample.samples.at(-1).scroll, stopped });
  }
  await page.evaluate(async () => {
    await editor.command("timeline.settings", { followProgressEnabled: false }); await editor.preview.play();
  });
  const fixed = await page.evaluate(async () => {
    const view = editor.workbench.timelineView, scroll = view.scrollValue;
    await new Promise(resolve => setTimeout(resolve, 250)); return { scroll, after: view.scrollValue };
  });
  assert.equal(fixed.scroll, fixed.after); assert.deepEqual(errors, []);
  console.log("Timeline follows v2's fractional centered playback at four zoom/frame-rate settings, three playback rates, pause and follow-off");
} finally {
  clearTimeout(deadline);
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

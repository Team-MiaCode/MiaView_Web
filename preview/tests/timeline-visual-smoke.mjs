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
  for (const state of ["empty", "chart", "waveform"]) {
    if (state === "chart") await page.evaluate(() => document.getElementById("workbench").editor.command("file.demo"));
    if (state === "waveform") await page.evaluate(async () => {
      const editor = document.getElementById("workbench").editor;
      const samples = 24000 * 12;
      const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
      const text = (offset, value) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
      text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVEfmt ");
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true);
      view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples * 2, true);
      for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.round(Math.sin(index / 24000 * 2 * Math.PI * 440) * 800), true);
      await editor.load({ maidata: editor.workbench.documentSession.sourceText, audio: new Blob([buffer], { type: "audio/wav" }) });
    });
    for (const theme of ["dark", "light", "legacy", "legacy_light"]) {
      await page.evaluate(theme => document.getElementById("workbench").editor.viewState.setPreference("darkThemeToken", theme), theme);
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      for (const [width, height] of [[800, 240], [400, 220]]) {
        // Isolate the actual component so workbench clipping cannot alter its reference image.
        await page.evaluate(({ width, height }) => {
          const workbench = document.getElementById("workbench").editor.workbench;
          workbench.timelineControls.root.style.display = "none";
          const root = workbench.timelineView.root;
          document.body.append(root);
          Object.assign(root.style, { position: "fixed", left: "0", top: "0", width: `${width}px`, height: `${height}px`, zIndex: "9999" });
        }, { width, height });
        await page.evaluate(() => document.getElementById("workbench").editor.command("timeline.viewport"));
        await page.waitForFunction(({ width, height }) => {
          const scene = document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState;
          return scene.viewportSize.width === width && scene.viewportSize.height === height;
        }, { width, height });
        await page.evaluate(() => document.fonts.ready);
        const scene = await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState);
        assert.equal(scene.laneCount, 9);
        assert.equal(scene.waveformBars.length > 0, state === "waveform");
        const filename = `timeline-${width}x${height}-${state}-${theme}.png`;
        await page.locator(".timeline-view").screenshot({ path: resolve(output, filename) });
        records.push({ state, theme, width, height, filename, timelineLeft: scene.timelineLeft, timelineTop: scene.timelineTop,
          laneHeight: scene.laneHeight, headerFontSize: scene.headerLabels[0]?.font.pixelSize, notes: scene.noteSprites.length,
          holds: scene.holdSpans.length, tracks: scene.trackSprites.length, waveformBars: scene.waveformBars.length });
      }
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "visual-results.json"), JSON.stringify({ browser: browser.version(), records, errors }, null, 2) + "\n");
  console.log("Timeline visual matrix passed: 4 themes × 2 sizes × empty/chart/waveform");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

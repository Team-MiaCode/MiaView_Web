import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const runtime = process.env.MIACODE_PLAYWRIGHT_MODULE;
const playwright = await import(runtime ? pathToFileURL(runtime).href : "playwright");
const engines = (process.env.MIACODE_DENSITY_ENGINES || "chrome,msedge,firefox,webkit").split(",");
const densities = [1, 1.25, 1.5, 2, 3];
const scales = [.5, .75, 1, 1.25, 1.5, 2];
const results = [];
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  for (const name of engines) {
    const type = name === "chrome" || name === "msedge" ? playwright.chromium : playwright[name];
    const browser = await type.launch({ headless: true, ...(["chrome", "msedge"].includes(name) ? { channel: name } : {}) });
    try {
      for (const density of densities) {
        const context = await browser.newContext({ deviceScaleFactor: density, viewport: { width: 1366, height: 768 } });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
        await page.locator(".welcome-title").waitFor();
        await page.evaluate(() => document.getElementById("workbench").editor.ready);
        const webAudio = await page.evaluate(() => typeof (globalThis.AudioContext ?? globalThis.webkitAudioContext) === "function");
        if (webAudio) await page.evaluate(() => document.getElementById("workbench").editor.command("file.demo"));
        else await page.evaluate(() => {
          const editor = document.getElementById("workbench").editor;
          editor.workbench.setDocument({ hasDocument: true, chartText: '(120){4}E', charts: [{id: 5}] });
          editor.viewState.openEditor('difficulty:5');
        });
        const devicePixelRatio = await page.evaluate(() => devicePixelRatio);
        assert.ok(Math.abs(devicePixelRatio - density) < .001, `${name} density ${devicePixelRatio}/${density}`);
        for (const scale of scales) {
          const width = Math.floor(1366 / scale), height = Math.floor(768 / scale);
          await page.setViewportSize({ width, height });
          await page.evaluate(() => document.getElementById("workbench").editor.viewState.setPreference("editorAutoWrap", true));
          await page.locator('.source-input').fill(`${'1h[4:1],2-8[4:1],'.repeat(35)}\n${'|| 中文书签'.repeat(30)}\nE`);
          await page.evaluate(() => document.fonts.ready);
          const geometry = await page.evaluate(() => {
            const editor = document.getElementById("workbench").editor.workbench.sourceEditor;
            editor.draw(); editor.input.scrollTop = editor.input.scrollHeight; editor.scroll();
            const input = editor.input.getBoundingClientRect(), paint = editor.paint.getBoundingClientRect();
            return { inputHeight: editor.input.clientHeight, inputWidth: editor.input.clientWidth, paintWidth: editor.paint.clientWidth,
              inputScrollHeight: editor.input.scrollHeight, paintScrollHeight: editor.paint.scrollHeight,
              inputScroll: editor.input.scrollTop, paintScroll: editor.paint.scrollTop, deltaX: input.x - paint.x, deltaY: input.y - paint.y,
              gutter: [...editor.gutter.children].map(node => node.getBoundingClientRect().height), paint: [...editor.paint.children].map(node => node.getBoundingClientRect().height) };
          });
          assert.ok(geometry.inputHeight >= 30, `${name}/${density}/${scale} editor height`);
          assert.equal(geometry.inputWidth, geometry.paintWidth, `${name}/${density}/${scale} input width`);
          assert.ok(Math.abs(geometry.deltaX) <= 1 && Math.abs(geometry.deltaY) <= 1);
          assert.ok(Math.abs(geometry.inputScrollHeight - geometry.paintScrollHeight) <= 1, `${name}/${density}/${scale} wrapped height ${JSON.stringify(geometry)}`);
          assert.equal(geometry.inputScroll, geometry.paintScroll);
          assert.deepEqual(geometry.gutter, geometry.paint);
          results.push({ browser: name, version: browser.version(), density, scale, cssViewport: [width, height], webAudio, inputAlignment: "pass" });
        }
        assert.deepEqual(errors, [], `${name}/${density} JavaScript errors`);
        await context.close();
      }
      console.log(`${name}: five pixel densities and six effective CSS zoom sizes passed`);
    } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  mkdirSync(resolve("artifacts/workbench-ui"), { recursive: true });
  writeFileSync(resolve("artifacts/workbench-ui/density-results.json"), JSON.stringify(results, null, 2) + "\n");
}

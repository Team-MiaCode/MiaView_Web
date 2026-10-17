import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", output = resolve("artifacts/preview-lifecycle", name);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(playwright, name), report = { browser: name, cases: [] };
let page;
try {
  page = await browser.newPage(); page.setDefaultTimeout(120000);
  await page.addInitScript(() => {
    if (window.parent === window) { window.lifecycleReports = []; return; }
    const state = { ticks: 0, pending: new Set(), hidden: false };
    window.lifecycleProbe = state;
    const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      if (callback.name !== "frame") return request(callback);
      const id = request(now => { state.pending.delete(id); ++state.ticks; callback(now); });
      state.pending.add(id); return id;
    };
    window.cancelAnimationFrame = id => { state.pending.delete(id); cancel(id); };
    window.addEventListener("pagehide", () => {
      state.hidden = true;
      window.parent.lifecycleReports.push({ ticks: state.ticks, pending: state.pending.size });
    });
  });
  await page.route("**/renderer/player.mjs*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + "\nwindow.lifecycleEngine = engine;\n" });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);
  const mount = () => page.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs");
    window.preview = createPreview(document.getElementById("one"), { resolution: { width: 320, height: 320 } });
    await preview.ready;
  });
  await mount();
  const frame = page.frames().find(frame => frame.url().includes("/renderer/index.html"));
  const disposed = await frame.evaluate(async () => {
    lifecycleEngine.clear();
    const before = lifecycleProbe.ticks;
    await new Promise(resolve => setTimeout(resolve, 150));
    return { ticksAfterClear: lifecycleProbe.ticks - before, pending: lifecycleProbe.pending.size,
      diagnosticsEnabled: lifecycleEngine.diagnostics().enabled };
  });
  report.cases.push({ key: "terminal-clear", ...disposed });
  assert.equal(disposed.ticksAfterClear, 0, "disposed host stops scheduling frames");
  assert.equal(disposed.pending, 0); assert.equal(disposed.diagnosticsEnabled, false);
  await page.evaluate(() => preview.destroy());
  assert.equal(await page.locator("iframe").count(), 0);
  report.pagehide = await page.evaluate(() => lifecycleReports);
  console.log("Terminal preview disposal releases the host frame loop and diagnostics");
} finally {
  writeFileSync(resolve(output, "results.json"), JSON.stringify(report, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

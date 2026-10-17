import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", output = resolve("artifacts/analysis-worker", name);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(playwright, name), result = {};
try {
  const page = await browser.newPage(); page.setDefaultTimeout(120000);
  await page.addInitScript(() => {
    if (window.parent === window) { window.analysisWorkers = []; return; }
    const Constructor = window.Worker;
    window.Worker = class extends Constructor {
      constructor(url, options) {
        super(url, options);
        if (options?.name === "MiaCode analysis") {
          const record = { active: true }; parent.analysisWorkers.push(record);
          const terminate = this.terminate.bind(this);
          this.terminate = () => { record.active = false; terminate(); };
        }
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);
  await page.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs");
    window.preview = createPreview(document.getElementById("one"), { resolution: { width: 320, height: 320 } });
    await preview.ready;
    const notes = Array.from({ length: 8192 }, (_, index) => `${index % 8 + 1},`).join("\n");
    await preview.load({ maidata: `&title=Analysis worker\n&lv_5=13\n&inote_5=(180){16}${notes}E`, difficulty: 5 });
    await new Promise(resolve => setTimeout(resolve, 500));
  });
  Object.assign(result, await page.evaluate(async () => {
    const original = await preview.getDocument();
    const analysis = preview.getAnalysis();
    const started = performance.now(), state = await preview.getState();
    const commandMs = performance.now() - started;
    await preview.documentCommand("document.metadataTitle", { value: "Changed during analysis" });
    const analyzed = await analysis, current = await preview.getDocument();
    return { commandMs, stateLoaded: state.loaded, originalRevision: original.revision,
      analyzedRevision: analyzed.revision, currentRevision: current.revision, analyzed,
      workerCount: analysisWorkers.length };
  }));
  assert.equal(result.stateLoaded, true); assert.ok(result.commandMs < 100, JSON.stringify({ commandMs: result.commandMs }));
  assert.equal(result.originalRevision, result.analyzedRevision);
  assert.ok(result.currentRevision > result.analyzedRevision); assert.equal(result.workerCount, 1);
  await page.evaluate(async () => {
    window.closedAnalysis = preview.getAnalysis().catch(error => error.message);
    await new Promise(resolve => setTimeout(resolve, 50)); preview.destroy();
  });
  result.destroyedRequest = await page.evaluate(() => closedAnalysis);
  assert.match(result.destroyedRequest, /destroyed/);
  await page.waitForFunction(() => analysisWorkers.every(worker => !worker.active));
  result.workersAfterDestroy = await page.evaluate(() => analysisWorkers);
  console.log("Background native analysis preserves revision snapshots, command response and worker disposal");
} finally {
  writeFileSync(resolve(output, "results.json"), JSON.stringify(result, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const runtime = process.env.MIACODE_PLAYWRIGHT_MODULE;
const { chromium } = await import(runtime ? pathToFileURL(runtime).href : "playwright");
const isolated = mkdtempSync(join(tmpdir(), "miacode-editor-isolated-"));
cpSync(resolve("editor"), isolated, { recursive: true });
const { sourcePin } = await import(pathToFileURL(join(isolated, "scripts/source-pin.mjs")));
assert.deepEqual(sourcePin(isolated), JSON.parse(readFileSync(join(isolated, "source-config.json"), "utf8")));
const { staticServer } = await import(pathToFileURL(join(isolated, "dev/server.mjs")));
const server = staticServer(isolated, { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const missing = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) missing.push(response.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  const info = await page.evaluate(() => document.getElementById("workbench").editor.command("file.demo"));
  assert.equal(info.title, "MiaCode Example");
  assert.equal(info.noteCount, 17);
  await page.locator(".source-input").waitFor();
  const viewportHeight = await page.locator(".source-viewport").evaluate(node => node.clientHeight);
  assert.ok(viewportHeight >= 30, `Isolated editor viewport height: ${viewportHeight}`);
  mkdirSync(resolve("artifacts/workbench-ui"), { recursive: true });
  await page.screenshot({ path: resolve("artifacts/workbench-ui/editor-isolated.png") });
  assert.deepEqual(missing, []);
  assert.deepEqual(errors, []);
  console.log("Copied editor entry and native preview run from an external folder with their own source configuration");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.ok(isolated.startsWith(join(tmpdir(), "miacode-editor-isolated-")));
  rmSync(isolated, { recursive: true, force: true });
}

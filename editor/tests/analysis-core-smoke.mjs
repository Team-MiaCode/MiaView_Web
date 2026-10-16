import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => document.getElementById("workbench").editor);
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.ready;
    await editor.load({ maidata: "&title=语法检查\n&lv_5=12\n&inote_5=(120){4}\n1,3h[0:1],E\n", difficulty: 5 });
  });
  await page.locator('[data-panel="validation"]').click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.syntaxErrorCount > 0);
  const syntax = await page.evaluate(() => document.getElementById("workbench").editor.preview.getAnalysis("zh"));
  assert.equal(syntax.pending, false); assert.equal(syntax.available, true);
  assert.ok(syntax.validationRows.some(row => row.line === 2 && row.column > 1 && row.second === -1));
  assert.equal(syntax.muriRows.length, 0);
  await page.locator('.analysis-issue').first().click();
  const row = syntax.validationRows[0];
  const caret = await page.locator('.source-input').evaluate(input => input.selectionStart);
  assert.equal(caret, "(120){4}\n".length + row.column - 1);
  const localized = await page.evaluate(() => document.getElementById("workbench").editor.preview.getAnalysis("en"));
  assert.equal(localized.validationRows.length, syntax.validationRows.length);
  assert.notEqual(localized.validationRows[0].detail, row.detail);
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.load({ maidata: "&title=无理检查\n&lv_5=12\n&inote_5=(120){4}1/3/5,E\n&lv_6=12\n&inote_6=(120){4}1,2,E\n", difficulty: 5 });
  });
  await page.locator('[data-panel="muri"]').click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.muriRows.length > 0);
  const muri = await page.evaluate(() => document.getElementById("workbench").editor.preview.getAnalysis("zh"));
  assert.equal(muri.syntaxErrorCount, 0); assert.ok(muri.muriRows.some(row => row.alert === "muri" && row.second >= 0));
  await page.locator('.analysis-issue').first().click();
  const active = muri.muriRows[0];
  const second = await page.evaluate(() => document.getElementById("workbench").editor.preview.getState().then(state => state.currentTime));
  assert.ok(Math.abs(second - active.second) < .001);
  await page.evaluate(() => document.getElementById("workbench").editor.command("document.selectDifficulty", { difficulty: 6 }));
  await page.waitForFunction(() => {
    const doc = document.getElementById("workbench").editor.workbench.documentSession;
    return doc.activeDifficultyId === 6 && !doc.pending;
  });
  assert.equal(await page.locator('.analysis-issue').count(), 0);
  const selection = await page.locator('.source-input').evaluate(input => input.selectionStart);
  await page.evaluate(row => document.getElementById("workbench").editor.command("analysis.activateRow", row), active);
  assert.equal(await page.locator('.source-input').evaluate(input => input.selectionStart), selection);
  assert.deepEqual(errors, []);
  const output = resolve("artifacts/analysis-core"); mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ syntax, localized, muri, errors }, null, 2) + "\n");
  console.log("Native syntax diagnostics, localized rows, Muri results, source navigation and difficulty identity passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

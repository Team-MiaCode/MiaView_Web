import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const references = JSON.parse(readFileSync(".assets/ui-reference/reference.json", "utf8"));
const output = resolve("artifacts/source-editor"); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  for (const [theme, reference] of Object.entries(references.themes)) {
    for (const capture of reference.sourceEditor.captures) {
      const { width, height, metrics } = capture;
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=source-editor&width=${width}&height=${height}&theme=${theme}`);
      await page.locator(".source-code-line").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const measured = await page.locator(".source-editor").evaluate(node => {
        const editor = document.getElementById("page").sourceEditor;
        editor.draw();
        const input = editor.input.getBoundingClientRect();
        const padding = parseFloat(getComputedStyle(editor.input).paddingLeft);
        const host = node.getBoundingClientRect();
        return { textLeft: input.x - host.x + padding, lineHeight: parseFloat(getComputedStyle(editor.input).lineHeight), lineCount: editor.paint.children.length,
          lineHeights: [...editor.paint.children].map(line => line.getBoundingClientRect().height) };
      });
      assert.ok(Math.abs(measured.textLeft - metrics.textLeft) <= 1, `${theme}: ${JSON.stringify(measured)} vs ${JSON.stringify(metrics)}`);
      assert.equal(measured.lineHeight, metrics.lineHeight);
      assert.equal(measured.lineCount, metrics.lineCount);
      assert.deepEqual(measured.lineHeights, Array(metrics.lineCount).fill(metrics.lineHeight));
      await page.locator(".source-editor").screenshot({ path: resolve(output, capture.image) });
      results.push({ theme, width, height, measured, native: metrics });
    }
  }
  assert.deepEqual(errors, []);
  console.log("Source editor: pinned native line heights and margins, syntax colors, current line and eight captures passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
}

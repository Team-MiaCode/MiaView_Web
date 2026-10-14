import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const engines = (process.env.MIACODE_TEST_ENGINES || "chromium,firefox,webkit").split(",");
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  for (const engine of engines) {
    const browser = await playwright[engine].launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=source-editor&width=600&height=240`);
      await page.locator(".source-code-line").first().waitFor();
      await page.evaluate(async () => {
        document.getElementById("page").sourceEditor.setWrap(true);
        await document.fonts.ready;
      });
      const results = await page.evaluate(async () => {
        const source = document.getElementById("page").sourceEditor;
        source.input.value = `${"1h[4:1],2-8[4:1],".repeat(35)}\n${"|| 中文注释".repeat(35)}\nE`;
        const results = [];
        for (let width = 400; width <= 480; width += .25) {
          source.root.style.width = `${width}px`;
          source.draw();
          const style = getComputedStyle(source.input);
          results.push({ width, inputHeight: source.input.scrollHeight, paintHeight: source.paint.scrollHeight,
            inputWidth: source.input.clientWidth, paintWidth: source.paint.clientWidth,
            cssWidth: style.width, padding: style.padding, font: style.font });
        }
        return results;
      });
      const failures = results.filter(row => Math.abs(row.inputHeight - row.paintHeight) > 1);
      console.log(JSON.stringify({ engine, cases: results.length, failures: failures.length, examples: failures.slice(0, 8) }, null, 2));
      assert.equal(failures.length, 0);
    } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
try {
  for (const name of (process.env.MIACODE_TEST_ENGINES || "chromium,firefox,webkit").split(",")) {
    const browser = await playwright[name].launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=source-editor&width=600&height=240`);
      await page.locator(".source-code-line").first().waitFor();
      const result = await page.evaluate(() => {
        const source = document.getElementById("page").sourceEditor;
        source.setWrap(false);
        source.setValue(`|| first\n${Array.from({ length: 8192 }, () => "1h[4:1],").join("\n")}`);
        const retained = source.paint.children[7000], total = source.paint.children.length;
        const activeCount = () => [...source.syntaxHighlights.values()].reduce((count, entry) => count + entry.highlight.size, 0);
        const initialRanges = activeCount();
        source.input.setRangeText("x", 3, 3); source.draw();
        const retainedAfterEdit = source.paint.children[7000] === retained;
        source.input.setRangeText("\n", 0, 0); source.draw();
        const retainedAfterLineInsert = source.paint.children[7001] === retained;
        const position = source.input.value.split("\n").slice(0, 7001).join("\n").length + 1;
        source.jumpToPosition(position);
        const visibleRanges = activeCount();
        const visibleLineHighlighted = [...source.syntaxHighlights.values()].some(({ highlight }) =>
          [...highlight].some(range => range.startContainer.parentElement === retained));
        const lineNumber = source.gutter.children[7001].textContent;
        source.destroy();
        return { total, initialRanges, visibleRanges, retainedAfterEdit, retainedAfterLineInsert,
          visibleLineHighlighted, lineNumber, remainingRanges: activeCount() };
      });
      assert.equal(result.total, 8193); assert.equal(result.retainedAfterEdit, true);
      assert.equal(result.retainedAfterLineInsert, true); assert.equal(result.lineNumber, "7002");
      assert.ok(result.initialRanges > 0 && result.initialRanges < 512);
      assert.ok(result.visibleRanges > 0 && result.visibleRanges < 512);
      assert.equal(result.visibleLineHighlighted, true); assert.equal(result.remainingRanges, 0);
      console.log(`${name}: 8193 lines retain DOM rows, scroll highlights and release ranges`);
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

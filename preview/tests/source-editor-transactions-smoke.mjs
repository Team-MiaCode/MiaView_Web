import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
try {
  for (const name of ["chromium", "firefox", "webkit"]) {
    const browser = await playwright[name].launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=source-editor&width=600&height=240`);
      await page.locator(".source-code-line").first().waitFor();
      const states = await page.evaluate(() => {
        const source = document.getElementById("page").sourceEditor;
        source.setDocument(1, 5, "1,2,E");
        const states = [];
        const apply = (start, end, text, position = start + text.length) => {
          source.applyTransaction({ hasEdit: true, replacementStart: start, replacementEnd: end,
            replacementText: text, anchor: position, position });
          states.push({ text: source.input.value, caret: source.input.selectionStart });
        };
        apply(0, 0, "3/"); apply(0, 2, ""); apply(2, 3, "4h[4:1]");
        apply(2, 2, "\n"); apply(0, 1, "主歌"); source.undo();
        states.push({ text: source.input.value, caret: source.input.selectionStart });
        source.redo(); states.push({ text: source.input.value, caret: source.input.selectionStart });
        return states;
      });
      assert.deepEqual(states, [
        { text: "3/1,2,E", caret: 2 }, { text: "1,2,E", caret: 0 }, { text: "1,4h[4:1],E", caret: 9 },
        { text: "1,\n4h[4:1],E", caret: 3 }, { text: "主歌,\n4h[4:1],E", caret: 2 },
        { text: "1,\n4h[4:1],E", caret: 3 }, { text: "主歌,\n4h[4:1],E", caret: 2 },
      ]);
      console.log(`${name}: insert, delete, replace, newline, Unicode, undo and redo transactions passed`);
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

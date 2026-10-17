import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/editor-ime"); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.ready;
    await editor.load({ maidata: "&title=中文输入\n&first=0\n&lv_5=12\n&inote_5=(120){4}1,2,E\n|| 段落：" });
  });
  const input = page.getByRole("textbox", { name: "Simai 谱面正文", exact: true });
  await input.focus(); await page.keyboard.press("Control+End");
  await page.evaluate(() => {
    const input = document.querySelector(".source-input");
    globalThis.compositionEvents = [];
    for (const type of ["compositionstart", "compositionupdate", "compositionend"])
      input.addEventListener(type, event => compositionEvents.push({ type, data: event.data }));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "主", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text: "主歌", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.insertText", { text: "主歌" });
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.chartText.endsWith("|| 段落：主歌"));
  await page.setViewportSize({ width: 360, height: 360 });
  const measured = await page.evaluate(() => {
    const editor = document.getElementById("workbench").editor.workbench.sourceEditor;
    editor.draw();
    const a = editor.input.getBoundingClientRect(), b = editor.paint.getBoundingClientRect();
    return { value: editor.input.value, painted: [...editor.paint.children].map(line => line.textContent).join("\n"),
      focused: document.activeElement === editor.input, width: a.width, height: a.height, deltaX: a.x - b.x, deltaY: a.y - b.y,
      caret: editor.input.selectionStart, events: compositionEvents };
  });
  assert.match(measured.value, /\|\| 段落：主歌$/);
  assert.equal(measured.painted, measured.value);
  assert.equal(measured.focused, true);
  assert.equal(measured.caret, measured.value.length);
  assert.ok(measured.width > 0 && measured.height >= 30 && measured.deltaX === 0 && measured.deltaY === 0);
  assert.equal(measured.events[0].type, "compositionstart");
  assert.equal(measured.events.at(-1).type, "compositionend");
  assert.ok(measured.events.some(event => event.type === "compositionupdate" && event.data === "主"));
  assert.ok(measured.events.some(event => event.type === "compositionupdate" && event.data === "主歌"));
  await cdp.send("Input.imeSetComposition", { text: "，", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.insertText", { text: "，" });
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.chartText.endsWith("|| 段落：主歌,"));
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.chartText.endsWith("|| 段落：主歌")).catch(async error => {
    console.log(JSON.stringify(await page.evaluate(() => {
      const source = document.getElementById("workbench").editor.workbench.sourceEditor;
      return { value: source.input.value, state: source.history.state, undo: source.history.undoEntries, redo: source.history.redoEntries, events: compositionEvents };
    }), null, 2));
    throw error;
  });
  await page.screenshot({ path: resolve(output, "narrow-composition.png") });
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ browser: browser.version(), measured, errors }, null, 2) + "\n");
  console.log("Chinese IME composition, half-width punctuation, atomic undo, native body update and input alignment passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

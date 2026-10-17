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
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.ready;
    await editor.load({ maidata: "&title=编辑事务\n&WholeBpm=180\n&lv_5=12\n&inote_5=(120){4}1,2,E\n&lv_6=13\n&inote_6=(180){8}3,4,E\n" });
  });
  const records = [];
  const call = async (id, text, anchor = 0, position = anchor, args = {}) => {
    const result = await page.evaluate(({ id, args }) => document.getElementById("workbench").editor.preview.editorCommand(id, args), { id, args: { text, anchor, position, ...args } });
    records.push({ id, text, anchor, position, args, result });
    return result;
  };
  const apply = (text, result) => {
    const tx = result.transaction;
    return tx.hasEdit ? text.slice(0, tx.replacementStart) + tx.replacementText + text.slice(tx.replacementEnd) : text;
  };
  const key = async (text, anchor, position, input, code = 0, args = {}) => {
    await call("edit.dismissCompletion", text, anchor, position);
    return call("edit.processKey", text, anchor, position, { input, key: code, ...args });
  };
  for (const [input, expected] of [["、", "/"], ["，", ","], ["／＃：", "/#:"]]) {
    assert.equal(apply("", await key("", 0, 0, input)), expected);
  }
  const bracket = await key("abc", 1, 2, "[", 91);
  assert.equal(apply("abc", bracket), "a[]c");
  assert.equal(bracket.transaction.position, 2);
  assert.deepEqual(bracket.completionCandidates, ["8:1]", "4:1]", "16:3]", "384:1]"]);
  await call("edit.selectCompletionIndex", "a[]c", 2, 2, { index: 1 });
  const completed = await call("edit.acceptCompletion", "a[]c", 2, 2);
  assert.equal(apply("a[]c", completed), "a[4:1]c");
  assert.equal(completed.transaction.position, 6);
  assert.equal(completed.completionActive, false);
  assert.equal(apply("[]", await key("[]", 1, 1, "\b", 0x1000003)), "");
  const skipped = await key("[]", 1, 1, "]", 93);
  assert.equal(apply("[]", skipped), "[]"); assert.equal(skipped.transaction.position, 2);
  assert.equal(apply("x", await key("x", 1, 1, "", 0x1000004)), "x\n");
  assert.equal(apply("", await key("", 0, 0, "，", 0, { settings: { halfWidthInputEnabled: false } })), "，");
  const bpm = await key("", 0, 0, "(", 40, { settings: { halfWidthInputEnabled: true, wholeBpm: "180" } });
  assert.deepEqual(bpm.completionCandidates, ["180)"]);
  assert.equal(apply("()", await call("edit.acceptCompletion", "()", 1, 1)), "(180)");
  const bookmark = await call("edit.createBookmark", "1,\n2,E", 3, 3, { title: "主歌" });
  assert.equal(apply("1,\n2,E", bookmark), "1,\n2,E || [主歌]");
  assert.equal(apply("1,\n2,E || [主歌]", await call("edit.renameBookmark", "1,\n2,E || [主歌]", 4, 4, { title: "副歌" })), "1,\n2,E || [副歌]");
  assert.equal(apply("1,\n2,E || [副歌]", await call("edit.deleteBookmark", "1,\n2,E || [副歌]", 4, 4)), "1,\n2,E");
  for (const [text, position, expected] of [[",,", 1, ",A1,"], ["1/A1/B2", 2, "1/B2"], ["(160){16}", 0, "(160){16}A1"]]) {
    assert.equal(apply(text, await call("edit.touchPadAuthoring", text, position, position, { pad: "A1", separator: "/" })), expected);
  }
  const sample = "(120){4}1,2,E";
  assert.equal(apply(sample, await call("transform.mirror_lr", sample, 8, 12)), "(120){4}8,7,E");
  assert.equal(apply(sample, await call("transform.rotate_cw_45", sample, 8, 12)), "(120){4}2,3,E");
  assert.equal(apply(sample, await call("transform.toggle_break", sample, 8, 12)), "(120){4}1b,2b,E");
  assert.equal(apply(sample, await call("transform.clear_complete_elements", sample, 8, 12)), "(120){4}1,,E");
  assert.equal(apply(sample, await call("transform.clear_complete_elements", sample, 0, 12)), "(120){4},,E");
  const beats = await call("edit.selectionBeats", "(120){4}1,2,{8}3,4,E", 8, 19);
  assert.equal(beats.totalCommaCount, 4); assert.equal(beats.exact, true);
  assert.deepEqual(beats.parts, [{ count: 2, denominator: 4 }, { count: 2, denominator: 8 }]);
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    const input = editor.workbench.sourceEditor.input;
    input.setSelectionRange(8, 12, "backward");
    await editor.command("transform.mirror_lr");
  });
  assert.equal(await page.locator(".source-input").inputValue(), "(120){4}8,7,E");
  const document = await page.evaluate(() => document.getElementById("workbench").editor.preview.getDocument());
  assert.equal(document.chartText, "(120){4}8,7,E");
  assert.equal(document.dirty, true);
  await page.evaluate(() => document.getElementById("workbench").editor.command("edit.undo"));
  assert.equal(await page.locator(".source-input").inputValue(), sample);
  await page.evaluate(() => document.getElementById("workbench").editor.command("edit.redo"));
  assert.equal(await page.locator(".source-input").inputValue(), "(120){4}8,7,E");
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    const input = editor.workbench.sourceEditor.input;
    input.setSelectionRange(9, 9);
    await editor.command("document.selectDifficulty", { difficulty: 6 });
    input.setSelectionRange(8, 12);
    await editor.command("transform.mirror_lr");
    await editor.command("document.selectDifficulty", { difficulty: 5 });
  });
  assert.equal(await page.locator(".source-input").inputValue(), "(120){4}8,7,E");
  assert.equal(await page.locator(".source-input").evaluate(input => input.selectionStart), 9);
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.command("edit.undo");
    await editor.command("document.selectDifficulty", { difficulty: 6 });
  });
  assert.equal(await page.locator(".source-input").inputValue(), "(180){8}6,5,E");
  await page.evaluate(() => document.getElementById("workbench").editor.command("edit.undo"));
  assert.equal(await page.locator(".source-input").inputValue(), "(180){8}3,4,E");
  const input = page.locator(".source-input");
  await input.focus();
  await input.evaluate(input => input.setSelectionRange(9, 9));
  await page.keyboard.type("h");
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.sourceEditor.completionState.completionActive);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".source-input").value.includes("3h[4:1]"));
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.querySelector(".source-input").value === "(180){8}3h,4,E");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.querySelector(".source-input").value === "(180){8}3,4,E");
  await input.evaluate(input => { input.setSelectionRange(8, 12); input.dispatchEvent(new Event("select")); });
  await page.waitForFunction(() => document.querySelector(".selection-status").textContent === "选区拍数：2/8");
  await page.evaluate(() => document.getElementById("workbench").editor.command("edit.bookmark", { line: 1 }));
  const dialog = page.getByRole("dialog", { name: "添加书签", exact: true });
  await dialog.getByRole("textbox", { name: "书签名称" }).fill("副歌");
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.charts.find(chart => chart.id === 6).bookmarks?.[0]?.title === "副歌");
  await page.locator(".difficulty-bookmark").click();
  assert.equal(await input.evaluate(input => input.selectionStart), 0);
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.command("edit.deleteBookmark", { line: 1 });
  });
  await input.evaluate(input => input.setSelectionRange(8, 8));
  await page.keyboard.type("(");
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.sourceEditor.completionState.completionCandidates.includes("180)"));
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".source-input").value === "(180){8}(180)3,4,E");
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.command("edit.undo"); await editor.command("edit.undo");
  });
  assert.equal(await input.inputValue(), "(180){8}3,4,E");
  await input.evaluate(input => input.setSelectionRange(8, 8));
  await page.keyboard.type("12345678", { delay: 0 });
  await page.evaluate(() => document.getElementById("workbench").editor.workbench.sourceEditor.pending);
  assert.equal(await input.inputValue(), "(180){8}123456783,4,E");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => document.querySelector(".source-input").value === "(180){8}3,4,E");
  const findSource = "(120){4}1,2,E\n|| tap TAP tapper tap";
  const documentSwitch = await page.evaluate(async text => {
    const editor = document.getElementById("workbench").editor;
    const previous = await editor.preview.getDocument();
    await editor.preview.editorCommand("edit.processKey", { text: "abcdefghij", anchor: 10, position: 10, input: "[", key: 91 });
    await editor.load({ maidata: `&title=查找\n&lv_5=12\n&inote_5=${text}\n` });
    const freshCompletion = await editor.preview.editorCommand("edit.processKey", { text: "", anchor: 0, position: 0, input: "h", key: 72 });
    await editor.preview.play();
    const playingBefore = (await editor.preview.getState()).playing;
    let staleGeneration, wrongDifficulty;
    try { await editor.preview.documentCommand("document.replaceActiveDifficultyChart", { value: "8,E", documentOpenGeneration: previous.documentOpenGeneration }); }
    catch (error) { staleGeneration = error.message; }
    try { await editor.preview.documentCommand("document.replaceActiveDifficultyChart", { value: "8,E", difficulty: 6 }); }
    catch (error) { wrongDifficulty = error.message; }
    const playingAfter = (await editor.preview.getState()).playing;
    await editor.preview.pause();
    await editor.command("edit.undo");
    await editor.command("edit.find");
    return { freshCompletion, staleGeneration, wrongDifficulty, playingBefore, playingAfter };
  }, findSource);
  assert.deepEqual(documentSwitch.freshCompletion.completionCandidates, ["[8:1]", "[4:1]", "[16:3]", "[384:1]"]);
  assert.match(documentSwitch.staleGeneration, /document changed/);
  assert.match(documentSwitch.wrongDifficulty, /difficulty changed/);
  assert.equal(documentSwitch.playingBefore, true);
  assert.equal(documentSwitch.playingAfter, true);
  assert.equal(await input.inputValue(), findSource);
  const find = page.locator(".find-replace-bar");
  await find.locator("input").nth(0).fill("tap");
  await find.locator("input").nth(1).fill("$&");
  await find.getByRole("switch", { name: "全词", exact: true }).check();
  await find.getByRole("button", { name: "全部替换", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".source-input").value.endsWith("|| $& $& tapper $&"));
  await page.evaluate(() => document.getElementById("workbench").editor.command("edit.undo"));
  assert.equal(await input.inputValue(), findSource);
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.command("edit.findNext", { query: "tap", wholeWord: true });
  });
  assert.equal(await input.evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd)), "tap");
  const finalDocument = await page.evaluate(() => document.getElementById("workbench").editor.preview.getDocument());
  assert.equal(finalDocument.chartText, findSource);
  assert.deepEqual(errors, []);
  const output = resolve("artifacts/editor-core"); mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ records, document, documentSwitch, finalDocument, keyboardCompletion: "pass", difficultyHistory: "pass", rapidInput: "pass", findReplace: "pass", errors }, null, 2) + "\n");
  console.log(`Native editor: ${records.length} calls; completion, bookmarks, touch, transformations, beats, difficulty history and find/replace passed`);
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

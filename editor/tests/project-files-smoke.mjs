import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const initial = "&title=保存测试\n&artist=作者\n&first=0\n&clock_count=6\n&custom=保留\n&lv_5=12\n&inote_5=(120){4}1,2,E\n&lv_6=13\n&inote_6=(180){8}3,4,E\n";
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.showDirectoryPicker = async options => {
      if (options.id !== "miacode-project-save") return testDirectory;
      if (window.saveDirectory) return saveDirectory;
      throw new DOMException("cancel", "AbortError");
    };
    window.showSaveFilePicker = async () => {
      if (window.saveDestination) return saveDestination;
      throw new DOMException("cancel", "AbortError");
    };
    const createWritable = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const stream = await createWritable.apply(this, args);
      if (!window.holdWrite || this.name !== "maidata.txt") return stream;
      return { write: value => { window.writeStarted = true; return stream.write(value); },
        close: async () => { await new Promise(resolve => { window.releaseWrite = resolve; }); await stream.close(); },
        abort: () => stream.abort() };
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(async source => {
    const editor = document.getElementById("workbench").editor;
    await editor.ready;
    const root = await navigator.storage.getDirectory();
    window.testDirectory = await root.getDirectoryHandle("Song", { create: true });
    window.testFile = await testDirectory.getFileHandle("maidata.txt", { create: true });
    const stream = await testFile.createWritable(); await stream.write(source); await stream.close();
    const asset = await testDirectory.getFileHandle("assets.json", { create: true });
    const assetStream = await asset.createWritable(); await assetStream.write('{"layout":"test"}'); await assetStream.close();
    await editor.command("file.open");
  }, initial);
  const command = (id, args) => page.evaluate(({ id, args }) => document.getElementById("workbench").editor.command(id, args), { id, args });
  const getDocument = () => page.evaluate(() => document.getElementById("workbench").editor.preview.getDocument());
  const diskText = () => page.evaluate(async () => (await testFile.getFile()).text());
  const input = page.locator(".source-input");
  await input.fill("(120){4}8,7,E"); await command("file.flushRecovery");
  await command("document.selectDifficulty", { difficulty: 6 });
  await input.fill("(180){8}6,5,E"); await command("file.flushRecovery");
  await command("document.metadataTitle", { value: "字段修改" });
  await command("document.selectDifficulty", { difficulty: 5 });
  await page.evaluate(() => {
    window.holdWrite = true;
    window.saving = document.getElementById("workbench").editor.command("file.save");
  });
  await page.waitForFunction(() => window.writeStarted && window.releaseWrite);
  await input.fill("(120){4}3,4,E"); await command("file.flushRecovery");
  await page.evaluate(async () => { window.holdWrite = false; releaseWrite(); await saving; });
  const partialDisk = await diskText(), partial = await getDocument();
  assert.match(partialDisk, /&title=保存测试/);
  assert.match(partialDisk, /&inote_5=\(120\)\{4\}8,7,E/);
  assert.match(partialDisk, /&inote_6=\(180\)\{8\}3,4,E/);
  assert.equal(partial.chartText, "(120){4}3,4,E");
  assert.deepEqual(partial.dirtyDifficultyIds, [5, 6]); assert.equal(partial.metadataDirty, true);
  await command("file.saveAll");
  const saved = await getDocument(), savedText = await diskText();
  assert.equal(saved.dirty, false); assert.deepEqual(saved.dirtyDifficultyIds, []);
  assert.match(savedText, /&title=字段修改/); assert.match(savedText, /&custom=保留/); assert.match(savedText, /&clock_count=6/);
  await input.fill("(120){4}4,5,E"); await command("file.flushRecovery");
  await command("file.saveAs");
  assert.equal((await getDocument()).dirty, true); assert.equal(await diskText(), savedText);
  await page.reload();
  await page.locator(".recent-open").first().waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  await page.locator(".recent-open").first().click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.chartText === "(120){4}4,5,E");
  const recovered = await getDocument();
  assert.equal(recovered.dirty, true); assert.deepEqual(recovered.dirtyDifficultyIds, [5]);
  assert.equal(recovered.metadataTitle, "字段修改");
  const inventory = await page.evaluate(() => [...document.getElementById("workbench").editor.workbench.documentSession.folderFiles.keys()]);
  assert.ok(inventory.includes("Song/assets.json"));
  await command("document.revertDifficulty", { difficulty: 5 });
  assert.equal((await getDocument()).chartText, "(120){4}3,4,E");
  assert.equal((await getDocument()).dirty, false);
  await input.fill("(120){4}7,8,E"); await command("file.flushRecovery");
  await page.evaluate(() => {
    const editor = document.getElementById("workbench").editor;
    window.reopening = editor.command("file.openRecent", { id: editor.workbench.documentSession.recentDocuments[0].id });
  });
  await page.getByRole("dialog", { name: "保存谱面修改" }).getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => reopening);
  assert.equal((await getDocument()).chartText, "(120){4}7,8,E");
  await page.evaluate(() => { window.closing = document.getElementById("workbench").editor.command("file.close"); });
  await page.getByRole("dialog", { name: "保存谱面修改" }).getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => closing);
  assert.equal((await getDocument()).hasDocument, true); assert.equal((await getDocument()).dirty, true);
  await page.evaluate(() => { window.closing = document.getElementById("workbench").editor.command("file.close"); });
  await page.getByRole("dialog", { name: "保存谱面修改" }).getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.evaluate(() => closing);
  assert.equal((await getDocument()).hasDocument, false);
  await page.locator(".recent-open").first().click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.hasDocument);
  assert.equal((await getDocument()).chartText, "(120){4}3,4,E");
  assert.equal((await getDocument()).dirty, false);
  await command("file.close");
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    window.testFile = await (await root.getDirectoryHandle("Song")).getFileHandle("maidata.txt");
    const text = await (await testFile.getFile()).text();
    const stream = await testFile.createWritable();
    await stream.write(text.replace("(120){4}3,4,E", "(120){4}2,1,E"));
    await stream.close();
  });
  await page.locator(".recent-open").first().click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.chartText === "(120){4}2,1,E");
  assert.equal((await getDocument()).dirty, false);
  await input.fill("(120){4}5,6,E"); await command("file.flushRecovery");
  const originalDisk = await diskText();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    window.saveDirectory = await root.getDirectoryHandle("Exported", { create: true });
    window.saveDestination = await saveDirectory.getFileHandle("maidata.txt", { create: true });
    window.writeStarted = false; window.releaseWrite = null; window.holdWrite = true;
    window.saving = document.getElementById("workbench").editor.command("file.saveAs");
  });
  await page.waitForFunction(() => writeStarted && releaseWrite);
  await input.fill("(120){4}7,8,E"); await command("file.flushRecovery");
  await page.evaluate(() => { window.queuedSave = document.getElementById("workbench").editor.command("file.saveAll"); });
  await page.evaluate(async () => { holdWrite = false; releaseWrite(); await saving; await queuedSave; });
  assert.match(await page.evaluate(async () => (await saveDestination.getFile()).text()), /&inote_5=\(120\)\{4\}7,8,E/);
  assert.equal(await diskText(), originalDisk);
  assert.equal((await getDocument()).filePath, "Exported/maidata.txt");
  assert.equal(await page.evaluate(async () => (await (await saveDirectory.getFileHandle("assets.json")).getFile()).text()), '{"layout":"test"}');
  assert.equal((await getDocument()).dirty, false);
  await input.fill("(120){4}5,6,E"); await command("file.flushRecovery");
  await page.evaluate(() => {
    window.writeStarted = false; window.releaseWrite = null; window.holdWrite = true;
    window.saving = document.getElementById("workbench").editor.command("file.saveAll");
  });
  await page.waitForFunction(() => writeStarted && releaseWrite);
  await page.evaluate(() => document.getElementById("workbench").editor.load({ maidata: "&title=另一项目\n&lv_5=10\n&inote_5=(120){4}1,E\n" }));
  await page.evaluate(async () => { holdWrite = false; releaseWrite(); await saving; });
  assert.equal((await getDocument()).metadataTitle, "另一项目");
  assert.equal((await getDocument()).dirty, false);
  const previousId = await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.recentDocuments.find(record => record.path === "Exported/maidata.txt").id);
  await command("file.openRecent", { id: previousId });
  await input.fill("(120){4}8,1,E"); await command("file.flushRecovery");
  await page.evaluate(async () => {
    await document.getElementById("workbench").editor.load({ maidata: "&title=文件冲突测试\n&lv_5=10\n&inote_5=(120){4}1,E\n" });
    const text = await (await saveDestination.getFile()).text();
    const stream = await saveDestination.createWritable();
    await stream.write(text.replace("(120){4}5,6,E", "(120){4}2,3,E")); await stream.close();
  });
  await page.evaluate(id => { window.reopening = document.getElementById("workbench").editor.command("file.openRecent", { id }); }, previousId);
  await page.getByRole("dialog", { name: "谱面文件内容变动" }).getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => reopening);
  assert.equal((await getDocument()).metadataTitle, "文件冲突测试");
  await page.evaluate(id => { window.reopening = document.getElementById("workbench").editor.command("file.openRecent", { id }); }, previousId);
  await page.getByRole("dialog", { name: "谱面文件内容变动" }).getByRole("button", { name: "恢复编辑内容", exact: true }).click();
  await page.evaluate(() => reopening);
  assert.equal((await getDocument()).chartText, "(120){4}8,1,E");
  assert.equal((await getDocument()).dirty, true);
  await command("document.revertDifficulty", { difficulty: 5 });
  assert.equal((await getDocument()).chartText, "(120){4}2,3,E");
  assert.equal((await getDocument()).dirty, false);
  assert.deepEqual(errors, []);
  const output = resolve("artifacts/project-files"); mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ partial, partialDisk, saved, savedText, recovered, inventory, errors }, null, 2) + "\n");
  console.log("OPFS file writes, save snapshots, concurrent editing, save all, cancellation and IndexedDB reload recovery passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

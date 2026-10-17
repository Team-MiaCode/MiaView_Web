import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/project-media"), folder = join(output, "Project");
mkdirSync(join(folder, "assets"), { recursive: true });
const source = "&title=素材工程\n&artist=作者\n&video=assets/clip.webm\n&inote_5=(120){4}1,2,E\n";
writeFileSync(join(folder, "maidata.txt"), source);
copyFileSync("ui/components/icons/app.png", join(folder, "bg.jpg"));
copyFileSync("tests/fixtures/bg-pattern.webm", join(folder, "assets/clip.webm"));
writeFileSync(join(folder, "bg.webm"), "unselected decoy");
writeFileSync(join(folder, "assets/layout.json"), '{"name":"resource-layout"}');
const wave = Buffer.alloc(44 + 24000 * 12 * 2);
wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28); wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
for (let index = 0; index < 24000 * 12; index++) wave.writeInt16LE(Math.round(Math.sin(index / 24000 * 2 * Math.PI * 440) * 800), 44 + index * 2);
writeFileSync(join(folder, "track.wav"), wave);
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const records = [];
try {
  async function setup(fallback) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(fallback => {
      if (fallback) { delete window.showDirectoryPicker; delete window.showSaveFilePicker; return; }
      window.showDirectoryPicker = async options => options.id === "miacode-project-save" ? copyDirectory : testDirectory;
    }, fallback);
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.locator(".welcome-title").waitFor(); await page.evaluate(() => document.getElementById("workbench").editor.ready);
    return { page, errors };
  }
  const command = (page, id, args) => page.evaluate(({ id, args }) => document.getElementById("workbench").editor.command(id, args), { id, args });
  const doc = page => page.evaluate(() => {
    const d = document.getElementById("workbench").editor.workbench.documentSession;
    return { filePath: d.filePath, video: d.metadataResolvedVideoPath, cover: d.coverPath, audio: d.trackPath, dirty: d.dirty, mediaDirty: d.mediaDirty, previewError: d.previewError, files: [...(d.folderFiles?.keys() || [])] };
  });
  async function importFile(page, kind, path) {
    const picker = page.waitForEvent("filechooser");
    if (kind === "audio") {
      await page.getByRole("button", { name: "工具", exact: true }).click();
      await page.getByRole("menuitem", { name: "导入音乐", exact: true }).click();
    } else await page.locator(kind === "cover" ? ".metadata-cover" : ".metadata-video").getByRole("button", { name: "导入", exact: true }).click();
    await (await picker).setFiles(path); await command(page, "file.flushRecovery");
  }
  const { page, errors } = await setup(false);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    window.testDirectory = await root.getDirectoryHandle("Project", { create: true });
    window.copyDirectory = await root.getDirectoryHandle("Copy", { create: true });
    for (const name of ["maidata.txt", "bg.jpg", "bg.webm", "track.wav", "assets/clip.webm", "assets/layout.json"]) {
      const response = await fetch(`./artifacts/project-media/Project/${name}`), file = await response.blob();
      const directory = name.startsWith("assets/") ? await testDirectory.getDirectoryHandle("assets", { create: true }) : testDirectory;
      const handle = await directory.getFileHandle(name.split("/").at(-1), { create: true });
      const stream = await handle.createWritable(); await stream.write(file); await stream.close();
    }
    await document.getElementById("workbench").editor.command("file.open");
  });
  assert.equal((await doc(page)).video, "Project/assets/clip.webm"); assert.equal((await doc(page)).previewError, undefined);
  await command(page, "page.metadata");
  await importFile(page, "cover", resolve("ui/components/icons/app.png"));
  const staged = await doc(page); assert.equal(staged.cover, "Project/bg.png"); assert.equal(staged.mediaDirty, true);
  assert.ok(staged.files.includes("Project/bg_bak.jpg")); assert.equal(staged.files.includes("Project/bg.jpg"), false);
  await page.reload(); await page.locator(".recent-open").first().waitFor();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    window.testDirectory = await root.getDirectoryHandle("Project"); window.copyDirectory = await root.getDirectoryHandle("Copy");
    await document.getElementById("workbench").editor.ready;
  });
  await page.locator(".recent-open").first().click();
  try { await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.coverPath === "Project/bg.png", null, { timeout: 5000 }); }
  catch (error) {
    console.log(JSON.stringify({ state: await doc(page), status: await page.evaluate(() => document.getElementById("workbench").editor.workbench.statusLabel.textContent), errors,
      recovery: await page.evaluate(async () => {
        const editor = document.getElementById("workbench").editor;
        const { ProjectStore } = await import("./services/project-store.mjs"); const store = new ProjectStore();
        const records = await store.list(); await store.close();
        const disk = await (await (await testDirectory.getFileHandle("maidata.txt")).getFile()).text();
        const native = await editor.preview.getDocument();
        return records.map(record => ({ filePath: record.filePath, dirty: record.dirty, mediaDirty: record.mediaDirty, inputPaths: record.inputPaths,
          disk, savedSourceText: record.savedSourceText, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => node.textContent),
          savedInputPaths: record.savedInputPaths, input: Object.fromEntries(Object.entries(record.input).map(([key,file]) => [key,file?.name])),
          native: { hasDocument: native.hasDocument, filePath: native.filePath } }));
      }) })); throw error;
  }
  assert.equal((await doc(page)).mediaDirty, true);
  await command(page, "page.metadata");
  await command(page, "file.saveAll");
  const persisted = await page.evaluate(async () => {
    const names = []; for await (const handle of testDirectory.values()) names.push(handle.name);
    return names;
  });
  assert.ok(persisted.includes("bg.png") && persisted.includes("bg_bak.jpg")); assert.equal(persisted.includes("bg.jpg"), false);
  assert.equal((await doc(page)).dirty, false);
  await importFile(page, "video", resolve("tests/fixtures/bg-pattern.webm"));
  assert.equal((await doc(page)).video, "Project/pv.webm");
  assert.equal(await page.evaluate(() => document.getElementById("workbench").editor.preview.getDocument().then(doc => doc.metadataVideoPath)), "pv.webm");
  await command(page, "file.saveAll");
  const savedText = await page.evaluate(async () => (await (await testDirectory.getFileHandle("maidata.txt")).getFile()).text());
  assert.match(savedText, /&video=pv\.webm/);
  await page.locator(".metadata-video").getByRole("button", { name: "移除", exact: true }).click();
  await page.getByRole("dialog", { name: "移除 PV" }).getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await doc(page)).video, "Project/pv.webm");
  await page.locator(".metadata-video").getByRole("button", { name: "移除", exact: true }).click();
  await page.getByRole("dialog", { name: "移除 PV" }).getByRole("button", { name: "移除", exact: true }).click();
  await command(page, "file.flushRecovery"); assert.equal((await doc(page)).video, "");
  await command(page, "file.saveAll"); assert.equal((await doc(page)).dirty, false);
  await importFile(page, "audio", join(folder, "track.wav"));
  await command(page, "file.saveAs");
  const copied = await doc(page); assert.equal(copied.filePath, "Copy/maidata.txt"); assert.equal(copied.audio, "Copy/track.wav");
  assert.ok(copied.files.includes("Copy/assets/layout.json")); assert.ok(copied.files.includes("Copy/pv_bak.webm"));
  assert.equal(await page.evaluate(async () => (await (await (await copyDirectory.getDirectoryHandle("assets")).getFileHandle("layout.json")).getFile()).text()), '{"name":"resource-layout"}');
  await command(page, "file.close");
  const closed = await page.evaluate(() => document.getElementById("workbench").editor.preview.getState());
  assert.equal(closed.loaded, false); assert.equal(closed.media.audioAvailable, false); assert.equal(closed.media.videoAvailable, false);
  await page.reload(); await page.locator(".recent-open").first().waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready); await page.locator(".recent-open").first().click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.filePath === "Copy/maidata.txt");
  assert.equal((await doc(page)).audio, "Copy/track.wav"); assert.equal((await doc(page)).video, "");
  assert.deepEqual(errors, []); records.push({ staged, persisted, copied, restored: await doc(page) });
  await page.close();

  const fallback = await setup(true), other = fallback.page;
  const picker = other.waitForEvent("filechooser"); await other.getByRole("button", { name: "打开谱面文件夹", exact: true }).first().click();
  await (await picker).setFiles(folder);
  await other.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.filePath === "Project/maidata.txt");
  await command(other, "page.metadata"); await importFile(other, "cover", resolve("ui/components/icons/app.png"));
  const download = other.waitForEvent("download");
  await other.evaluate(() => { window.savingProject = document.getElementById("workbench").editor.command("file.saveAll"); });
  const archive = await download; await archive.saveAs(join(output, "project.zip")); await other.evaluate(() => savingProject);
  assert.equal(archive.suggestedFilename(), "Project.zip"); assert.equal((await doc(other)).dirty, false);
  assert.deepEqual(fallback.errors, []); records.push({ archive: archive.suggestedFilename(), fallback: await doc(other) });
  writeFileSync(join(output, "results.json"), JSON.stringify({ records, errors }, null, 2) + "\n");
  console.log("Workbenches imported media, backed up replacements, wrote directories, copied complete projects, restored assets and downloaded a complete ZIP");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

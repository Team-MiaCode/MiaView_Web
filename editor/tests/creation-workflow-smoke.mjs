import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/creation-workflow"); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await chromium.launch({ headless: true });
const original5 = "(120){4}1,2,3,4,E", original6 = "(180){8}5,6,7,8,E";
const format = process.env.MIACODE_EXPORT_FORMAT || "auto";
const edited5 = "(120){4}1,2h[4:1],3-5[4:1],4w8[4:1],A1,Ch[4:1],1b,2x,A1f,E";
const edited6 = "(180){8}8,7,6,5,E", errors = [], results = {};
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); page.setDefaultTimeout(120000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => window.songDirectory;
    window.showSaveFilePicker = undefined;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor(); await page.evaluate(() => document.getElementById("workbench").editor.ready);
  const command = (id, args = {}) => page.evaluate(([id, args]) => document.getElementById("workbench").editor.command(id, args), [id, args]);
  const documentState = () => page.evaluate(() => document.getElementById("workbench").editor.preview.getDocument());
  const diskText = () => page.evaluate(async () => (await songFile.getFile()).text());
  await page.evaluate(async ({ original5, original6 }) => {
    const root = await navigator.storage.getDirectory(); window.songDirectory = await root.getDirectoryHandle("Creation", { create: true });
    const put = async (directory, name, data) => { const file = await directory.getFileHandle(name, { create: true }); const stream = await file.createWritable(); await stream.write(data); await stream.close(); return file; };
    window.songFile = await put(songDirectory, "maidata.txt", `&title=创作流程\n&artist=作者\n&first=-0.2\n&clock_count=6\n&custom=保留\n&video=media/clip.webm\n&lv_5=12\n&inote_5=${original5}\n&lv_6=13\n&inote_6=${original6}\n`);
    const wave = new Uint8Array(44 + 24000 * 8 * 2), data = new DataView(wave.buffer), text = (offset, value) => [...value].forEach((c, i) => wave[offset + i] = c.charCodeAt(0));
    text(0, "RIFF"); data.setUint32(4, wave.length - 8, true); text(8, "WAVEfmt "); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
    data.setUint32(24, 24000, true); data.setUint32(28, 48000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true); text(36, "data"); data.setUint32(40, wave.length - 44, true);
    for (let index = 0; index < 24000 * 8; ++index) data.setInt16(44 + index * 2, Math.round(4000 * Math.sin(index * Math.PI * 880 / 24000)), true);
    await put(songDirectory, "track.wav", wave);
    await put(songDirectory, "bg.png", await fetch("/ui/components/icons/app.png").then(response => response.blob()));
    await put(await songDirectory.getDirectoryHandle("media", { create: true }), "clip.webm", await fetch("/tests/fixtures/bg-pattern.webm").then(response => response.blob()));
    await document.getElementById("workbench").editor.command("file.open");
  }, { original5, original6 });
  const opened = await documentState(); results.opened = { title: opened.title, first: opened.first, generation: opened.documentOpenGeneration };
  const media = await page.evaluate(async () => (await document.getElementById("workbench").editor.preview.getState()).media);
  assert.deepEqual(media, { hidePv: false, audioAvailable: true, coverAvailable: true, videoAvailable: true });
  const input = page.locator(".source-input");
  await input.fill(edited5); await command("file.flushRecovery");
  await command("document.selectDifficulty", { difficulty: 6 }); await input.fill(edited6); await command("file.flushRecovery");
  await command("document.selectDifficulty", { difficulty: 5 }); await command("edit.undo");
  assert.equal((await documentState()).chartText, original5);
  await input.fill(edited5); await command("file.flushRecovery"); await command("document.metadataTitle", { value: "保存恢复流程" });
  await command("file.save"); const partial = await diskText();
  assert.match(partial, /&title=创作流程/); assert.ok(partial.includes(edited5)); assert.ok(partial.includes(original6));
  assert.equal((await documentState()).dirty, true);
  await command("file.saveAll"); await command("file.flushRecovery"); const saved = await diskText();
  assert.match(saved, /&title=保存恢复流程/); assert.ok(saved.includes(edited5)); assert.ok(saved.includes(edited6));
  assert.match(saved, /&custom=保留/); assert.match(saved, /&video=media\/clip.webm/); assert.match(saved, /&clock_count=6/);
  assert.equal((await documentState()).dirty, false); results.saved = { partialSection: true, allSections: true, fieldsPreserved: true };
  results.phase = "restore";
  await page.reload(); await page.locator(".welcome-title").waitFor(); await page.evaluate(() => document.getElementById("workbench").editor.ready);
  const recent = await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.recentDocuments[0]);
  await command("file.restore", { id: recent.id });
  const restored = await documentState(); assert.equal(restored.title, "保存恢复流程"); assert.equal(restored.chartText, edited5); assert.equal(restored.dirty, false);
  assert.deepEqual(await page.evaluate(async () => (await document.getElementById("workbench").editor.preview.getState()).media), media);
  const analysis = await page.evaluate(() => document.getElementById("workbench").editor.preview.getAnalysis("zh"));
  assert.equal(analysis.syntaxErrorCount, 0); assert.equal(analysis.revision, restored.revision);
  results.analysis = { syntaxErrors: analysis.syntaxErrorCount, revision: analysis.revision, generation: analysis.documentOpenGeneration };
  results.phase = "range-playback";
  await command("export.settings", { exportStartSeconds: .5, exportEndSeconds: 1 }); await command("preview.rangeMode", { enabled: true });
  await command("preview.seek", { second: .5 }); await page.getByRole("button", { name: "播放", exact: true }).click();
  await waitForAsync(page, async () => { const state = await document.getElementById("workbench").editor.preview.getState(); return !state.playing && Math.abs(state.currentTime - 1) < .02; });
  results.phase = "video";
  await command("page.export"); await command("export.settings", { outputPath: "workflow.mp4", resolutionIndex: 0, fps: 30, format });
  const downloading = page.waitForEvent("download"); const exported = await command("export.video"); const download = await downloading;
  assert.equal(exported.frameCount, 60); assert.equal(exported.difficulty, 5); assert.equal(exported.filename, download.suggestedFilename());
  const file = join(output, download.suggestedFilename()); await download.saveAs(file); assert.ok(readFileSync(file).length > 1000);
  const video = await page.evaluate(async filename => {
    const { Input, BlobSource, ALL_FORMATS, VideoSampleSink } = await import("/renderer/vendor/mediabunny/index.mjs");
    const file = await fetch(`/artifacts/creation-workflow/${encodeURIComponent(filename)}`).then(response => response.blob());
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try { let frames = 0; for await (const sample of new VideoSampleSink(await input.getPrimaryVideoTrack()).samples()) { ++frames; sample.close(); }
      return { frames, duration: await input.computeDuration(), audio: Boolean(await input.getPrimaryAudioTrack()) }; }
    finally { input.dispose(); }
  }, exported.filename);
  assert.equal(video.frames, 60); assert.ok(Math.abs(video.duration - 2) < .06); assert.equal(video.audio, true);
  assert.equal((await documentState()).dirty, false); assert.deepEqual(errors, []); results.video = video;
  console.log("Folder import, per-difficulty history, partial/all save, media recovery, revision-bound analysis, range playback and decoded video workflow passed");
} catch (error) {
  results.failure = String(error); if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {}); throw error;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify({ ...results, errors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

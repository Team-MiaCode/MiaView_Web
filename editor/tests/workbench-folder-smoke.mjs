import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../dev/server.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/folder-import");
const song = join(output, "Song");
mkdirSync(join(song, "assets"), { recursive: true });
copyFileSync("tests/fixtures/maidata.txt", join(song, "maidata.txt"));
copyFileSync("ui/components/icons/app.png", join(song, "BG.PNG"));
copyFileSync("tests/fixtures/bg-pattern.webm", join(song, "PV.WEBM"));
writeFileSync(join(song, "assets/layout.json"), '{"name":"Folder fixture"}');
// Decoys make selecting the first extension match fail the actual media load.
writeFileSync(join(song, "other.wav"), "other audio");
writeFileSync(join(song, "icon.png"), "other image");
writeFileSync(join(song, "other.webm"), "other video");
const wave = Buffer.alloc(44 + 24000 * 12 * 2);
wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28); wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
for (let index = 0; index < 24000 * 12; index++) wave.writeInt16LE(Math.round(Math.sin(index / 24000 * 2 * Math.PI * 440) * 800), 44 + index * 2);
writeFileSync(join(song, "TRACK.WAV"), wave);

const collection = join(output, "Collection");
for (const name of ["A", "B"]) {
  mkdirSync(join(collection, name), { recursive: true });
  copyFileSync("tests/fixtures/maidata.txt", join(collection, name, "maidata.txt"));
}
copyFileSync(join(song, "TRACK.WAV"), join(collection, "A", "track.wav"));
copyFileSync(join(song, "BG.PNG"), join(collection, "B", "bg.png"));

const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  async function choose(folder) {
    const selected = page.waitForEvent("filechooser");
    await page.locator(".toolbar").getByRole("button", { name: "打开谱面文件夹", exact: true }).click();
    const picker = await selected;
    assert.equal(await picker.element().evaluate(node => node.webkitdirectory), true);
    await picker.setFiles(folder);
  }
  await choose(song);
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.filePath === "Song/maidata.txt");
  const imported = await page.evaluate(() => {
    const doc = document.getElementById("workbench").editor.workbench.documentSession;
    return { source: doc.filePath, audio: doc.trackPath, cover: doc.coverPath, video: doc.metadataResolvedVideoPath, inventory: [...doc.folderFiles.keys()], trackAvailable: doc.trackAvailable, videoAvailable: doc.videoAvailable };
  });
  assert.equal(imported.audio, "Song/TRACK.WAV");
  assert.equal(imported.cover, "Song/BG.PNG");
  assert.equal(imported.video, "Song/PV.WEBM");
  assert.ok(imported.inventory.includes("Song/assets/layout.json"));
  assert.equal(imported.inventory.length, 8);
  assert.equal(imported.trackAvailable, true);
  assert.equal(imported.videoAvailable, true);
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState?.waveformBars.length > 0);
  const waveform = await page.evaluate(() => {
    const state = document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState;
    return { bars: state.waveformBars.length, visible: Boolean(document.querySelector('.timeline-view [data-waveform="true"]')) };
  });
  assert.ok(waveform.bars > 0);
  assert.equal(waveform.visible, true);
  const frame = page.frameLocator("iframe");
  assert.ok(await frame.locator("#stage-video").evaluate(video => video.readyState >= 2 && video.videoWidth > 0 && video.muted));
  await page.evaluate(() => document.getElementById("workbench").editor.command("preview.toggleHidePv"));
  assert.equal(await frame.locator("#stage-video").isVisible(), false);
  assert.equal((await page.evaluate(() => document.getElementById("workbench").editor.preview.getState())).media.hidePv, true);
  await page.evaluate(() => document.getElementById("workbench").editor.command("preview.toggleHidePv"));
  assert.equal(await frame.locator("#stage-video").isVisible(), true);
  await page.locator(".preview-transport").getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(async () => (await document.getElementById("workbench").editor.preview.getState()).currentTime > .1);
  await page.evaluate(() => document.getElementById("workbench").editor.preview.pause());
  await page.evaluate(() => document.getElementById("workbench").editor.viewState.openEditor("metadata"));
  await page.locator(".metadata-cover-view img").waitFor();
  assert.ok(await page.locator(".metadata-cover-view img").evaluate(image => image.complete && image.naturalWidth > 0));
  assert.ok((await page.locator(".metadata-video-path").textContent()).includes("PV.WEBM"));
  await page.screenshot({ path: join(output, "folder-metadata.png") });

  await choose(collection);
  const dialog = page.getByRole("dialog");
  await dialog.locator("select").selectOption({ label: "Collection/B" });
  await dialog.getByRole("button", { name: "打开", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.filePath === "Collection/B/maidata.txt");
  const isolated = await page.evaluate(() => {
    const doc = document.getElementById("workbench").editor.workbench.documentSession;
    return { audio: doc.trackPath, cover: doc.coverPath, trackAvailable: doc.trackAvailable, videoAvailable: doc.videoAvailable };
  });
  assert.equal(isolated.audio, "");
  assert.equal(isolated.cover, "Collection/B/bg.png");
  assert.equal(isolated.trackAvailable, false);
  assert.equal(isolated.videoAvailable, false);
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.timelineSceneState?.waveformBars.length === 0);
  assert.equal(await page.locator('.timeline-view [data-waveform="true"]').count(), 0);
  assert.deepEqual(errors, []);
  writeFileSync(join(output, "results.json"), JSON.stringify({ browser: browser.version(), imported, waveform, isolated, errors }, null, 2) + "\n");
  console.log("Whole-folder selection, canonical bg/PV/track/source, native playback, waveform, metadata and sibling isolation passed");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

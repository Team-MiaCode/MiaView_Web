import { observeFilePicker } from "./helpers/file-picker.mjs";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../dev/server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";
import { observeAudioDecoding } from "./helpers/audio-decoder-probe.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium";
const output = resolve("artifacts/persistence", name); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await launchPreviewBrowser(browsers, name), errors = [], results = {};
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); page.setDefaultTimeout(120000);
  page.on("pageerror", error => errors.push(error.message));
  await observeAudioDecoding(page);
  const url = process.env.MIACODE_WORKBENCH_URL || `http://127.0.0.1:${server.address().port}/`;
  const ready = async () => { await page.waitForFunction(() => document.getElementById("workbench")?.editor); await page.evaluate(() => document.getElementById("workbench").editor.ready); };
  const command = (id, args) => page.evaluate(([id, args]) => document.getElementById("workbench").editor.command(id, args), [id, args]);
  const state = () => page.evaluate(() => document.getElementById("workbench").editor.preview.getState());
  await observeFilePicker(page);
  await page.goto(url); await ready();
  await page.evaluate(() => document.getElementById("workbench").editor.load({ maidata: "&title=Persistence\n&inote_5=(120){4}1,2,3,4,E\n&inote_6=(180){8}3,4,E" }));
  await command("document.selectDifficulty", { difficulty: 6 });
  await command("document.applyDesignerSlots", { unified: true, canonicalName: "Persistence Designer", slots: [] });
  await command("preview.rate", { rate: 1.25 });
  const timeline = { zoomScale: 1.5, waveformBrightness: .65, measureLineBrightness: .8, followPreviewEnabled: true, followProgressEnabled: false };
  await command("timeline.settings", timeline);
  const values = { previewMode: "maimuri_dx_style", showSlideTracks: false, showJudgeMarkers: true, showTouchTrail: true,
    handRadiusPx: 42, wifiNeedC: true, staticTapOnSlideThresholdMs: 230, fireworkBrightness: 65 };
  await command("preview.values", values);
  await page.evaluate(() => document.getElementById("workbench").editor.viewState.setPreferences({ chart_normalize_syntax: "compact_single_line", chart_normalize_section_measure_count: 0,
    chart_normalize_start_at_new_measure: true, chart_normalize_reduce_to_384_grid: true }));
  await command("edit.normalizeChart");
  const normalized = await page.locator(".source-input").inputValue(); assert.ok(normalized.includes("3"));
  assert.notEqual(normalized, "(180){8}3,4,E");
  await command("export.settings", { outputMode: "mp4_and_wav", introPvBrightness: .4 });
  await command("page.export");
  await command("export.settings", { introEnabled: true });
  await page.locator('.settings-tabs [data-page="intro"]').click();
  const wave=Buffer.alloc(44+4800*4);Buffer.from((await import("../renderer/export-wav.mjs")).wavHeader(4800)).copy(wave);
  const chooser=page.waitForEvent("filechooser");await page.getByRole("button",{name:"选择音效",exact:true}).click();
  await (await chooser).setFiles({name:"opening.wav",mimeType:"audio/wav",buffer:wave});
  await page.waitForFunction(()=>document.getElementById("workbench").editor.workbench.documentSession.introSoundFileName==="opening.wav");
  assert.equal(await page.evaluate(()=>filePickerOptions.at(-1).id),"intro_sound-global");
  const renderer=page.frames().find(frame=>frame.url().includes("/renderer/index.html"));
  await waitForAsync(renderer,()=>audioDecodes.some(item=>Math.abs(item.duration-.1)<.0001));
  await command("page.preview-settings");
  await command("file.flushRecovery"); await page.reload(); await ready();
  const restored = await state();
  assert.equal(restored.playback.rate, 1.25); assert.equal(restored.playing, false);
  for (const [key, value] of Object.entries(values)) assert.equal(restored.settings[key], key === "fireworkBrightness" ? .65 : value, key);
  const session = await page.evaluate(() => {
    const e = document.getElementById("workbench").editor;
    return { difficulty: e.workbench.documentSession.activeDifficultyId, timeline: e.workbench.timelineControls.state, preferences: e.viewState.preferences };
  });
  assert.equal(session.difficulty, 6); for (const key of Object.keys(timeline)) assert.equal(session.timeline[key], timeline[key]);
  assert.equal(await page.evaluate(async () => (await document.getElementById("workbench").editor.getDocument()).unifiedDesignerEnabled), true);
  assert.equal(session.preferences.exportValues.outputMode, "mp4_and_wav"); assert.equal(session.preferences.exportValues.introPvBrightness, .4);
  assert.equal(session.preferences.chart_normalize_section_measure_count, 0);
  assert.equal(await page.evaluate(() => document.getElementById("workbench").editor.workbench.documentSession.introSoundFileName), "opening.wav");
  assert.equal(await page.evaluate(async () => (await document.getElementById("workbench").editor.getDocument()).chartText), normalized);
  results.restored = session;
  await command("page.preview-settings");
  for (const width of [1920, 1366, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await page.locator('.settings-page .form-row > .select-control').evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).map(node => ({ width: node.getBoundingClientRect().width, parent: node.parentElement.getBoundingClientRect().width })));
    assert.ok(sizes.length > 0);
    assert.ok(sizes.every(size => size.width <= 240.1 && size.width <= size.parent), JSON.stringify(sizes));
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await command("preview.values", { previewMode: "native", showSlideTracks: true, showJudgeMarkers: false, showTouchTrail: false });
  await page.evaluate(chart => document.getElementById("workbench").editor.load({ maidata: chart }), readFileSync("tests/fixtures/firework/maidata.txt", "utf8"));
  const surface = page.frameLocator('.preview-container iframe').locator('#qt-screen canvas');
  await command("preview.seek", { second: 2.233 }); await command("preview.values", { fireworkBrightness: 50 });
  const dim = await surface.screenshot(); await command("preview.values", { fireworkBrightness: 120 });
  const bright = await surface.screenshot(); assert.notDeepEqual(dim, bright, "Firework brightness changes native rendered rays");
  writeFileSync(join(output, "firework-50.png"), dim); writeFileSync(join(output, "firework-120.png"), bright);
  await command("page.cover");
  await page.waitForFunction(() => document.querySelector('.cover-page .cover-editor')?.coverRenderer);
  await page.evaluate(async () => {
    const e = document.getElementById("workbench").editor, canvas = document.querySelector('.cover-page .cover-editor').coverRenderer;
    await canvas.ready; Object.assign(e.workbench.documentSession.coverValues, { cardShadow: true, backgroundBrightness: .23, outputFile: "project.jpg" });
    await canvas.update(); await e.command("cover.canvasChanged"); await e.command("file.flushRecovery");
    await e.load({ maidata: "&title=Shared cover\n&inote_5=(120){4}1,E" });
    if (e.workbench.documentSession.coverValues.cardShadow !== true || e.workbench.documentSession.coverValues.outputFile !== undefined) throw new Error("Cover default scope");
  });
  results.coverDefaults = true;
  await page.evaluate(() => document.getElementById("workbench").editor.viewState.setPreference("autoRestoreLastSessionFile", false));
  await command("file.flushRecovery"); await page.reload(); await ready(); assert.equal((await state()).loaded, false);
  assert.deepEqual(errors, []); results.errors = errors;
  console.log(`${name}: session, rate, timeline, Muri, normalization, cover defaults, output presets, option widths and firework brightness passed`);
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

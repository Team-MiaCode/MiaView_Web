import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium";
const output = resolve("artifacts/preview-parity", name); mkdirSync(output, { recursive: true });
const qt = resolve(process.env.MIACODE_QT_HOST_PATH || ".deps/qt/6.11.1/msvc2022_64");
const executable = resolve(process.env.MIACODE_PREVIEW_REFERENCE || "build-devtools/native-reference/miacode-ui-reference.exe");
const mixed = "&title=Preview parity\n&first=0\n&lv_5=13\n&inote_5=(120){4}1,2b,3h[4:1],4-8[4:1],A1,B2,C,Ch[4:1],1/3/5/7,8x,7bx,6h[8:3],5^8[4:1],4pp8[4:1],3qq7[4:1],2w6[4:1],E";
const fireworks = readFileSync("tests/fixtures/firework/maidata.txt", "utf8");
const cases = [];
for (const noteSkin of ["DX", "SD"]) for (const previewMode of ["native", "maimuri_dx_style", "erase_by_area"])
  for (const currentTime of [.3, 1.75, 3.8]) cases.push({ key: `${noteSkin}-${previewMode}-${currentTime}`, noteSkin, previewMode, currentTime, sourceText: mixed, width: 600, height: 600 });
for (const currentTime of [2.233, 4.233, 6.733]) cases.push({ key: `firework-${currentTime}`, noteSkin: "DX", previewMode: "native", currentTime, sourceText: fireworks, width: 600, height: 600 });
for (const [key, width, height] of [["wide", 800, 450], ["free", 750, 600]]) cases.push({ key, noteSkin: "DX", previewMode: "native", currentTime: 1.75, sourceText: mixed, width, height });
for (const [key, width, height] of [["SD-wide", 800, 450], ["SD-free", 750, 600]]) cases.push({ key, noteSkin: "SD", previewMode: "native", currentTime: 1.75, sourceText: mixed, width, height });
for (const noteSkin of ["DX", "SD"]) for (const [key, width, height] of [["square", 600, 600], ["wide", 800, 450], ["free", 750, 600]])
  cases.push({ key: `hud-${noteSkin}-${key}`, noteSkin, previewMode: "native", currentTime: 1.75, sourceText: mixed, width, height, hud: true,
    sceneReference: key === "square" ? `${noteSkin}-native-1.75` : `${noteSkin === "SD" ? "SD-" : ""}${key}` });
let selected = process.env.MIACODE_PARITY_CASE ? cases.filter(item => item.key === process.env.MIACODE_PARITY_CASE) : cases;
if (selected[0]?.sceneReference) selected = cases.filter(item => item.key === selected[0].key || item.key === selected[0].sceneReference);
assert.ok(selected.length);
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(playwright, name), results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 800 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(120000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);
  await page.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs");
    window.preview = createPreview(document.getElementById("one"), { resolution: { width: 600, height: 600 }, controls: false, diagnostics: false });
    await preview.ready;
  });
  for (const item of selected) {
    const fixture = resolve(output, `${item.key}.json`), nativeImage = resolve(output, `${item.key}-native.png`), webImage = resolve(output, `${item.key}-web.png`);
    writeFileSync(fixture, JSON.stringify({ ...item, difficultyId: 5, assetRoot: resolve("vendor/MiaCode/assets") }));
    const captured = spawnSync(executable, ["--preview", fixture, "--viewport", `${item.width}x${item.height}`, "--capture", nativeImage], {
      encoding: "utf8", env: { ...process.env, PATH: `${qt}/bin;${process.env.PATH}`, QT_PLUGIN_PATH: `${qt}/plugins`,
        QT_QPA_PLATFORM: "offscreen", QT_QUICK_BACKEND: "rhi", QSG_RHI_BACKEND: "d3d11", QT_FONT_DPI: "96", QT_FORCE_STDERR_LOGGING: "1" }, timeout: 120000,
    });
    writeFileSync(resolve(output, `${item.key}-native.log`), captured.stderr || "");
    assert.equal(captured.status, 0, captured.error?.message || captured.stderr);
    const info = await page.evaluate(async item => {
      document.getElementById("one").style.width = `${item.width}px`;
      await preview.setCanvasSize({ width: item.width, height: item.height });
      await preview.setSettings({ noteSkin: item.noteSkin, previewMode: item.previewMode, layoutSquareScale: .95,
        tapFlowSpeed: 7.5, touchFlowSpeed: 8, centerDisplay: item.hud ? 1 : 0, outlineIndex: 0, forceLabeledJudgeLineWhenPaused: false,
        skinJudgeEffectIndex: 1, smoothBrightness: false, showTimestamp: Boolean(item.hud), showDebugInfo: false,
        showChartInfoHud: Boolean(item.hud), showObjectStatsHud: Boolean(item.hud) });
      const info = await preview.load({ maidata: item.sourceText, difficulty: 5 }); await preview.seek(item.currentTime);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      const state = await preview.getState();
      return { noteCount: info.noteCount, statistics: state.statistics.map(({ kind, played, total }) => ({ kind, played, total })) };
    }, item);
    const native = JSON.parse(readFileSync(`${nativeImage}.json`, "utf8")); assert.deepEqual(info, native, item.key);
    const canvas = page.frames().find(frame => frame.url().includes("/renderer/index.html")).locator("#qt-screen canvas");
    assert.deepEqual(await canvas.evaluate(node => [node.width, node.height]), [item.width, item.height]);
    await canvas.screenshot({ path: webImage }); results.push({ key: item.key, hud: Boolean(item.hud), sceneReference: item.sceneReference, ...info, nativeImage, webImage });
    console.log(`${item.key}: native note count and six statistics match`);
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

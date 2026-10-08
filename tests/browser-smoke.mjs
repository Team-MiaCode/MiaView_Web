import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(
  process.env.MIACODE_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href
    : "playwright"
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = mkdtempSync(join(tmpdir(), "miacode-sdk-smoke-"));
const chart = readFileSync(join(root, "tests/fixtures/maidata.txt"), "utf8");
const video = readFileSync(join(root, "tests/fixtures/bg-pattern.webm"));
const wave = Buffer.alloc(44 + 24000 * 12 * 2);
wave.write("RIFF");
wave.writeUInt32LE(wave.length - 8, 4);
wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(24000, 24);
wave.writeUInt32LE(48000, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write("data", 36);
wave.writeUInt32LE(wave.length - 44, 40);
for (let i = 0; i < 24000 * 12; i++)
  wave.writeInt16LE(
    Math.round(Math.sin((i / 24000) * 2 * Math.PI * 440) * 800),
    44 + i * 2,
  );
const staticHost = staticServer(root);
const host = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const assets = {
    "/__track": [wave, "audio/wav"],
    "/__chart": [Buffer.from(chart), "text/plain"],
    "/__video": [video, "video/webm"],
  };
  if (assets[path]) {
    res.writeHead(200, {
      "Content-Type": assets[path][1],
      "Access-Control-Allow-Origin": "*",
    });
    res.end(assets[path][0]);
  } else staticHost.emit("request", req, res);
});
const renderer = staticServer(root);
await Promise.all([
  new Promise((resolve) => host.listen(0, "127.0.0.1", resolve)),
  new Promise((resolve) => renderer.listen(0, "127.0.0.1", resolve)),
]);
const base = `http://127.0.0.1:${host.address().port}`;
const rendererUrl = `http://127.0.0.1:${renderer.address().port}/renderer/index.html`;
const browser = await chromium.launch({
  executablePath: process.env.MIACODE_CHROMIUM,
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-webgl",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1100 },
    deviceScaleFactor: Number(process.env.MIACODE_TEST_DPR ?? 1),
  });
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(base + "/tests/host.html");
  await page.evaluate(
    async ({ rendererUrl, chart, base, byteSize, sha256 }) => {
      const { createPreview } = await import("/sdk/index.mjs");
      window.events = [];
      window.first = createPreview(document.getElementById("one"), {
        rendererUrl,
        resolution: { width: 1280, height: 720 },
      });
      for (const name of [
        "ready",
        "progress",
        "playing",
        "paused",
        "ended",
        "error",
        "seeked",
        "settingsChanged",
      ])
        first.on(name, (payload) => events.push({ name, payload }));
      await first.ready;
      window.info = await first.load({
        maidata: chart,
        audio: "/__track",
        video: {
          url: base + "/__video",
          byteSize,
          sha256,
          contentType: "video/webm",
        },
        difficulty: 5,
      });
      document.getElementById("host-play").onclick = () => {
        window.playResult = first.play().catch((error) => {
          window.playError = error.message;
        });
      };
    },
    {
      rendererUrl,
      chart,
      base,
      byteSize: video.length,
      sha256: createHash("sha256").update(video).digest("hex"),
    },
  );
  const firstFrame = page.frameLocator("#one iframe");
  assert.deepEqual(
    await firstFrame
      .locator("#viewport canvas")
      .evaluate((canvas) => ({ width: canvas.width, height: canvas.height })),
    { width: 1280, height: 720 },
  );
  let state = await page.evaluate(() => first.getState());
  assert.equal(state.playing, false);
  assert.equal(state.currentTime, 0);
  assert.ok(state.loaded);
  assert.equal(state.resolution.showChartInfoHud, true);
  assert.equal(state.resolution.showObjectStatsHud, true);
  assert.equal(state.resolution.showTimestamp, true);
  assert.equal(await firstFrame.locator("#play").textContent(), "播放");
  assert.ok((await page.evaluate(() => window.info.noteCount)) > 0);
  assert.notEqual(
    new URL(await page.locator("#one iframe").getAttribute("src")).origin,
    new URL(base).origin,
    "Test must really embed across origins",
  );
  await page.locator("#host-play").click();
  await page.waitForFunction(
    () => window.events.some((event) => event.name === "playing"),
    null,
    { timeout: 30000 },
  );
  await page.waitForFunction(
    () =>
      Number(document.querySelector("#one iframe").getAttribute("src").length) >
      0,
  );
  await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await first.pause();
  });
  state = await page.evaluate(() => first.getState());
  assert.equal(state.playing, false);
  assert.ok(state.currentTime > 0);
  await page.evaluate(() => first.seek(1.5));
  const pausedPosition = (await page.evaluate(() => first.getState()))
    .currentTime;
  assert.equal(pausedPosition, 1.5);
  await page.evaluate(() =>
    first.setSettings({
      tapFlowSpeed: 8.25,
      touchFlowSpeed: 9.25,
      outerBrightness: 0.6,
      noteSkin: "SD",
      earlierSlideOnTop: false,
      previewMode: "maimuri_dx_style",
    }),
  );
  state = await page.evaluate(() => first.getState());
  assert.equal(state.currentTime, pausedPosition);
  assert.equal(state.playing, false);
  assert.equal(state.settings.tapFlowSpeed, 8.25);
  assert.equal(state.settings.touchFlowSpeed, 9.25);
  assert.equal(state.settings.noteSkin, "SD");
  assert.equal(state.settings.showJudgeEffects, true);
  assert.equal(state.settings.previewMode, "maimuri_dx_style");
  for (const previewMode of ["erase_by_area", "native", "maimuri_dx_style"]) {
    await page.evaluate(
      (previewMode) => first.setSettings({ previewMode }),
      previewMode,
    );
    const state = await page.evaluate(() => first.getState());
    assert.equal(state.settings.previewMode, previewMode);
    assert.equal(state.currentTime, pausedPosition);
    assert.equal(state.playing, false);
  }
  assert.deepEqual(
    await page.evaluate(async () => {
      const before = await first.getState();
      const rejected = [];
      for (const call of [
        () => first.seek(-1),
        () => first.setSettings({ showJudgeEffects: false }),
        () => first.setSettings({ tapFlowSpeed: 99 }),
        () => first.setSettings({ previewMode: "unknown" }),
        () => first.selectDifficulty(7),
      ]) {
        try {
          await call();
          rejected.push(false);
        } catch {
          rejected.push(true);
        }
      }
      return {
        rejected,
        unchanged:
          JSON.stringify(before) === JSON.stringify(await first.getState()),
      };
    }),
    { rejected: [true, true, true, true, true], unchanged: true },
  );
  await firstFrame
    .locator("#viewport canvas")
    .screenshot({ path: join(output, "wide-pv.png") });
  await page.evaluate(() => first.selectDifficulty(3));
  state = await page.evaluate(() => first.getState());
  assert.equal(state.difficultyId, 3);
  assert.equal(state.currentTime, 0);
  assert.equal(state.playing, false);
  assert.equal(state.settings.noteSkin, "SD");
  assert.equal(state.settings.previewMode, "maimuri_dx_style");
  await page.evaluate(
    async ({ rendererUrl, chart, wave }) => {
      const { createPreview } = await import("/sdk/index.mjs");
      window.second = createPreview(document.getElementById("two"), {
        rendererUrl,
        resolution: { width: 720, height: 720 },
      });
      await second.ready;
      await second.load({
        maidata: new Blob([chart], { type: "text/plain" }),
        audio: new Blob([new Uint8Array(wave)], { type: "audio/wav" }),
        difficulty: 5,
      });
    },
    { rendererUrl, chart, wave: [...wave] },
  );
  const secondFrame = page.frameLocator("#two iframe");
  assert.deepEqual(
    await secondFrame
      .locator("#viewport canvas")
      .evaluate((canvas) => ({ width: canvas.width, height: canvas.height })),
    { width: 720, height: 720 },
  );
  state = await page.evaluate(() => second.getState());
  assert.equal(state.playing, false);
  assert.equal(state.resolution.showTimestamp, true);
  assert.equal(state.resolution.showChartInfoHud, false);
  assert.equal(state.resolution.showObjectStatsHud, false);
  assert.equal(state.settings.noteSkin, "DX");
  assert.equal(state.settings.tapFlowSpeed, 7.5);
  assert.equal(state.settings.previewMode, "native");
  await page.evaluate(() =>
    second.setSettings({ previewMode: "erase_by_area" }),
  );
  assert.equal(
    (await page.evaluate(() => second.getState())).settings.previewMode,
    "erase_by_area",
  );
  assert.equal(
    (await page.evaluate(() => first.getState())).settings.previewMode,
    "maimuri_dx_style",
    "Instances must not share preview mode",
  );
  await secondFrame
    .locator("#viewport canvas")
    .screenshot({ path: join(output, "square.png") });
  await page.evaluate(() => {
    document.getElementById("two").style.width = "356px";
  });
  const bounds = await secondFrame.locator("body").evaluate(() => {
    const stage = document.getElementById("stage").getBoundingClientRect(),
      transport = document.getElementById("transport").getBoundingClientRect();
    return {
      width: stage.width,
      height: stage.height,
      below: transport.top >= stage.bottom,
    };
  });
  assert.ok(Math.abs(bounds.width - bounds.height) < 1);
  assert.equal(bounds.below, true);
  await page.evaluate(() => second.seek(2));
  assert.equal(
    (await page.evaluate(() => first.getState())).currentTime,
    0,
    "Instances must not share playhead",
  );
  assert.equal(
    (await page.evaluate(() => first.getState())).settings.noteSkin,
    "SD",
    "Instances must not share settings",
  );
  const unchanged = await page.evaluate(async () => {
    const before = await second.getState();
    second.iframe.contentWindow.postMessage(
      {
        source: "MiaCodePreviewHost",
        protocolVersion: 1,
        sessionId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        type: "seek",
        payload: { second: 9 },
      },
      new URL(second.iframe.src).origin,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    return JSON.stringify(await second.getState()) === JSON.stringify(before);
  });
  assert.ok(unchanged, "Cross-session controls must be ignored");
  await page.evaluate(async () => {
    await first.load({
      maidata: { url: "/__chart" },
      audio: "/__track",
      difficulty: 5,
    });
  });
  assert.ok(
    (await page.evaluate(() => first.getState())).loaded,
    "Maidata URL loading must work without a website manifest",
  );
  const failed = await page.evaluate(async () => {
    try {
      await first.load({
        maidata: { url: "/__chart", byteSize: 1, sha256: "0".repeat(64) },
      });
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(failed);
  assert.equal((await page.evaluate(() => first.getState())).loaded, false);
  await page.evaluate(() => {
    first.destroy();
    first.destroy();
  });
  assert.equal(await page.locator("#one iframe").count(), 0);
  assert.equal(await page.locator("#two iframe").count(), 1);
  assert.equal((await page.evaluate(() => second.getState())).currentTime, 2);
  await page.evaluate(() => second.destroy());
  assert.equal(await page.locator("iframe").count(), 0);
  assert.ok(
    !requests.some((url) => url.includes("/api/v1")),
    "Standalone integration must not call website APIs",
  );
  assert.deepEqual(errors, []);
  // Exercise the shipped example too; it uses the very same public SDK.
  const folder = mkdtempSync(join(tmpdir(), "miacode-sdk-chart-"));
  writeFileSync(join(folder, "maidata.txt"), chart);
  writeFileSync(join(folder, "track.wav"), wave);
  writeFileSync(join(folder, "pv.webm"), video);
  await page.goto(base + "/examples/index.html");
  await page.locator("#files").setInputFiles(folder);
  await page.locator("#play:not([disabled])").waitFor({ timeout: 90000 });
  await page.locator("#resolution").selectOption("1080x1080");
  await page.locator("#play:not([disabled])").waitFor({ timeout: 90000 });
  assert.deepEqual(
    await page
      .frameLocator("#preview iframe")
      .locator("#viewport canvas")
      .evaluate((canvas) => ({ width: canvas.width, height: canvas.height })),
    { width: 1080, height: 1080 },
  );
  await page.locator("#destroy").click();
  assert.equal(await page.locator("#preview iframe").count(), 0);
  assert.deepEqual(errors, []);
  console.log(`Standalone SDK browser smoke passed; screenshots: ${output}`);
} finally {
  await browser.close();
  await Promise.all([
    new Promise((resolve) => host.close(resolve)),
    new Promise((resolve) => renderer.close(resolve)),
  ]);
}

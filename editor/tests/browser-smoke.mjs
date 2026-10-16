import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, writeFileSync, readdirSync } from "node:fs";
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
const logDirectory = join(output, "logs");
const terminalLogs = [];
const staticHost = staticServer(root, {
  performanceLogDir: logDirectory,
  performanceOutput: (text) => terminalLogs.push(text),
});
let finishSlowTrack, finishBufferedVideo;
let timedVideoRequests = 0,
  timedVideoClosed = false;
const streamingVideo = readFileSync(join(root, "tests/fixtures/bg-stream.mp4"));
let slowTrackFinished = false,
  bufferedVideoFinished = false;
const host = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/__slow-track") {
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Access-Control-Allow-Origin": "*",
      "Content-Length": wave.length,
    });
    res.write(wave.subarray(0, 44));
    finishSlowTrack = () => {
      slowTrackFinished = true;
      res.end(wave.subarray(44));
    };
    return;
  }
  if (path === "/__buffered-video") {
    const start = Number(
      /^bytes=(\d+)-/.exec(req.headers.range ?? "")?.[1] ?? 0,
    );
    if (start > 0) {
      res.writeHead(206, {
        "Content-Type": "video/mp4",
        "Access-Control-Allow-Origin": "*",
        "Content-Range": `bytes ${start}-${streamingVideo.length - 1}/${streamingVideo.length}`,
        "Content-Length": streamingVideo.length - start,
      });
      res.end(streamingVideo.subarray(start));
      return;
    }
    res.writeHead(206, {
      "Content-Type": "video/mp4",
      "Access-Control-Allow-Origin": "*",
      "Content-Length": streamingVideo.length,
      "Content-Range": `bytes 0-${streamingVideo.length - 1}/${streamingVideo.length}`,
      "Accept-Ranges": "bytes",
    });
    const split = Math.floor(streamingVideo.length * 0.8);
    res.write(streamingVideo.subarray(0, split));
    finishBufferedVideo = () => {
      bufferedVideoFinished = true;
      res.end(streamingVideo.subarray(split));
    };
    return;
  }
  if (path === "/__timeout-video") {
    timedVideoRequests++;
    res.on("close", () => {
      timedVideoClosed = true;
    });
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Access-Control-Allow-Origin": "*",
      "Content-Length": streamingVideo.length,
    });
    res.write(streamingVideo.subarray(0, 100));
    return;
  }
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
const renderer = staticServer(root, {
  performanceOutput: (text) => terminalLogs.push(text),
});
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
  const consoleLogs = [];
  page.on("console", (message) => consoleLogs.push(message.text()));
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
        maxFps: 30,
        pvTimeoutMs: 10000,
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
        "performance",
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
  assert.equal(state.maxFps, 30);
  assert.equal(state.pvTimeoutMs, 10000);
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
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await first.pause();
  });
  state = await page.evaluate(() => first.getState());
  assert.equal(state.playing, false);
  assert.ok(state.currentTime > 0);
  const displayedFps = Number(
    (await firstFrame.locator("#fps").textContent()).replace("FPS: ", ""),
  );
  assert.ok(
    displayedFps > 0 && displayedFps <= 35,
    `30 FPS cap must limit actual presented frames, got ${displayedFps}`,
  );
  await page.waitForFunction(() =>
    window.events.some(
      (e) => e.name === "performance" && e.payload.backendLog?.ok,
    ),
  );
  const embeddedLog = await page.evaluate(
    () =>
      window.events.find(
        (e) => e.name === "performance" && e.payload.backendLog?.ok,
      ).payload.backendLog,
  );
  assert.equal(embeddedLog.terminalEnabled, true);
  assert.equal(embeddedLog.fileEnabled, false);
  assert.ok(terminalLogs.includes(embeddedLog.text));
  const diagnostics = await page.evaluate(() => first.getDiagnostics());
  assert.equal(diagnostics.enabled, true);
  for (const name of [
    "engineLoad",
    "engineInit",
    "chartLoad",
    "maidataRead",
    "audioRead",
    "audioDecode",
    "videoAssetRead",
    "videoReady",
  ]) {
    assert.ok(
      diagnostics.reports.some((r) => r.metrics[name]?.count > 0),
      `Missing load metric: ${name}`,
    );
  }
  assert.equal(diagnostics.reports.filter((r) => r.logKind === "initialization").length, 3);
  const playbackReports = diagnostics.reports.filter((r) => r.logKind === "performance");
  assert.ok(playbackReports.length > 0, "Default playback must produce performance reports");
  assert.ok(playbackReports.every((r) => r.loaded && r.playing && r.metrics.hostWork && r.metrics.wasmTick && r.metrics.audioSchedule));
  const pausedReports = playbackReports.length;
  await page.waitForTimeout(1200);
  assert.equal((await page.evaluate(() => first.getDiagnostics())).reports.filter((r) => r.logKind === "performance").length, pausedReports, "Paused preview must not sample performance");
  assert.ok(
    diagnostics.reports.filter((r) => r.logKind === "initialization").every(
      (r) =>
        r.logKind === "initialization" &&
        !r.metrics.hostWork &&
        !r.metrics.wasmTick &&
        !r.metrics.audioSchedule,
    ),
  );
  assert.ok(
    diagnostics.reports.every(
      (r) =>
        !r.metrics.videoDraw &&
        !r.metrics.videoRead &&
        !r.metrics.videoCopy &&
        !r.metrics.wasmVideo &&
        !r.counters.videoUploads,
    ),
  );
  assert.equal(await firstFrame.locator("#stage-video").isVisible(), true);
  assert.equal(
    await firstFrame
      .locator("#viewport canvas")
      .evaluate(
        (canvas) => canvas.getContext("webgl2").getContextAttributes().alpha,
      ),
    true,
  );
  assert.ok(
    await page.evaluate(() =>
      window.events.some((e) => e.name === "performance"),
    ),
  );
  assert.equal(
    (await page.evaluate(() => first.resetDiagnostics())).reports.length,
    0,
  );
  await page.evaluate(() => first.setDiagnostics(false));
  assert.equal(
    (await page.evaluate(() => first.getDiagnostics())).enabled,
    false,
  );
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
  // Component UI and host API must share the same state and event boundary.
  await page.evaluate(() => { window.events.length = 0; });
  await firstFrame.locator("#tap-speed").evaluate((input) => {
    input.value = "8.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => events.some((e) => e.name === "settingsChanged" && e.payload.tapFlowSpeed === 8.5));
  assert.equal((await page.evaluate(() => first.getState())).settings.tapFlowSpeed, 8.5);
  await firstFrame.locator("#seek").evaluate((input) => {
    input.value = "2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => events.some((e) => e.name === "seeked" && e.payload.currentTime === 2));
  assert.equal((await page.evaluate(() => first.getState())).currentTime, 2);
  await page.evaluate(() => first.setSettings({ tapFlowSpeed: 8.25 }));
  await page.evaluate(() => first.seek(1.5));
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
  // Verify actual composed pixels, not only that the DOM video is visible.
  // Both points lie in the green quarter of the fixture, away from HUD/notes.
  async function backgroundPixels() {
    await firstFrame
      .locator("#viewport")
      .evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    const bytes = await firstFrame.locator("#viewport").screenshot();
    return page.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
          ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        const green = (x) =>
          ctx.getImageData(
            Math.floor(bitmap.width * x),
            Math.floor(bitmap.height * 0.25),
            1,
            1,
          ).data[1];
        const result = { inner: green(0.6), outer: green(0.9) };
        bitmap.close();
        return result;
      },
      [...bytes],
    );
  }
  await page.evaluate(() =>
    first.setSettings({ outerBrightness: 1, innerBrightness: 1 }),
  );
  const bright = await backgroundPixels();
  assert.ok(
    bright.inner > 100 && bright.outer > 100,
    `Video must show through Qt: ${JSON.stringify(bright)}`,
  );
  await page.evaluate(() =>
    first.setSettings({ outerBrightness: 0, innerBrightness: 1 }),
  );
  const darkOuter = await backgroundPixels();
  assert.ok(
    darkOuter.outer < 10 && darkOuter.inner > bright.inner * 0.8,
    "Outer dimming must preserve inner video",
  );
  await page.evaluate(() =>
    first.setSettings({ outerBrightness: 1, innerBrightness: 0 }),
  );
  const darkInner = await backgroundPixels();
  assert.ok(
    darkInner.inner < 10 && darkInner.outer > bright.outer * 0.8,
    "Inner dimming must preserve outer video",
  );
  await page.evaluate(() =>
    first.setSettings({ outerBrightness: 0.6, innerBrightness: 0.2 }),
  );
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
        maxFps: "unlimited",
        pvTimeoutMs: "unlimited",
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
  assert.equal(state.maxFps, "unlimited");
  assert.equal(state.pvTimeoutMs, "unlimited");
  assert.equal((await page.evaluate(() => first.getState())).maxFps, 30);
  assert.equal(state.playing, false);
  assert.equal(state.resolution.showTimestamp, true);
  assert.equal(state.resolution.showChartInfoHud, false);
  assert.equal(state.resolution.showObjectStatsHud, false);
  assert.equal(state.settings.noteSkin, "DX");
  assert.equal(state.settings.tapFlowSpeed, 7.5);
  assert.equal(state.settings.previewMode, "native");
  assert.equal(await secondFrame.locator("#stage-video").isVisible(), false);
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
  // Parsing stays parallel, but play remains disabled until the PV transfer ends.
  await page.evaluate(
    ({ chart, base }) => {
      window.streamEvents = [];
      first.on("progress", (payload) => streamEvents.push(payload.stage));
      window.streamLoadDone = false;
      window.streamLoadError = null;
      first
        .load({
          maidata: chart,
          audio: base + "/__slow-track",
          video: base + "/__buffered-video",
          difficulty: 5,
        })
        .then(() => {
          window.streamLoadDone = true;
        })
        .catch((error) => {
          window.streamLoadError = error.message;
        });
    },
    { chart, base },
  );
  await page.waitForFunction(() => streamEvents.includes("正在解析谱面"));
  assert.equal(
    slowTrackFinished,
    false,
    "Parsing must start while audio is downloading",
  );
  assert.ok(finishSlowTrack);
  finishSlowTrack();
  await page.waitForFunction(() => streamEvents.includes("正在准备背景视频"));
  assert.equal(await page.evaluate(() => streamLoadDone), false);
  assert.equal(await firstFrame.locator("#play").isDisabled(), true);
  assert.equal(
    await firstFrame.locator("#stage-video").getAttribute("src"),
    null,
  );
  assert.equal(bufferedVideoFinished, false);
  assert.ok(finishBufferedVideo);
  finishBufferedVideo();
  await page.waitForFunction(() => streamLoadDone || streamLoadError);
  assert.equal(await page.evaluate(() => streamLoadError), null);
  assert.ok(
    (await firstFrame.locator("#stage-video").getAttribute("src")).startsWith(
      "blob:",
    ),
  );
  assert.equal((await page.evaluate(() => first.getState())).loaded, true);

  await page.evaluate(
    ({ chart, base }) => {
      window.timeoutLoadDone = false;
      window.timeoutLoadError = null;
      first
        .setDiagnostics(true)
        .then(() =>
          first.load({
            maidata: chart,
            audio: base + "/__track",
            video: base + "/__timeout-video",
            difficulty: 5,
          }),
        )
        .then(() => {
          timeoutLoadDone = true;
        })
        .catch((error) => {
          timeoutLoadError = error.message;
        });
    },
    { chart, base },
  );
  await page.waitForFunction(() => timeoutLoadDone || timeoutLoadError, null, {
    timeout: 40000,
  });
  assert.equal(await page.evaluate(() => timeoutLoadError), null);
  assert.equal(timedVideoRequests, 1);
  assert.equal(
    timedVideoClosed,
    true,
    "Timeout must actually close the network transfer",
  );
  assert.equal(
    await firstFrame.locator("#stage-video").getAttribute("src"),
    null,
  );
  assert.equal(await firstFrame.locator("#stage-video").isVisible(), false);
  assert.equal(await firstFrame.locator("#play").isDisabled(), false);
  const timeoutDiagnostics = await page.evaluate(() => first.getDiagnostics());
  assert.ok(
    timeoutDiagnostics.reports.some((r) => r.counters.videoLoadTimeouts === 1),
  );
  await page.evaluate(() => first.selectDifficulty(3));
  assert.equal(
    timedVideoRequests,
    1,
    "Difficulty change must not retry a timed-out PV",
  );
  await page.evaluate(
    ({ chart, base }) =>
      first.load({
        maidata: chart,
        audio: base + "/__track",
        video: base + "/__timeout-video",
        difficulty: 5,
      }),
    { chart, base },
  );
  assert.equal(
    timedVideoRequests,
    1,
    "Explicit reload of the same PV must also skip it for this instance",
  );
  const missingResourceMessage = await page.evaluate(async () => {
    try {
      await first.load({ maidata: { url: "/missing-maidata.txt" } });
    } catch (error) {
      return error.message;
    }
    return "";
  });
  assert.match(missingResourceMessage, /谱面读取失败.*HTTP 404/);
  const errorReports = (await page.evaluate(() => first.getDiagnostics()))
    .reports;
  assert.ok(
    errorReports.some(
      (report) =>
        report.phase === "error" &&
        report.errors.some(
          (error) =>
            error.stage === "chart-load" && error.message.includes("HTTP 404"),
        ),
    ),
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
  const devRequests = [];
  page.on("request", (request) => devRequests.push({ url: request.url(), method: request.method() }));
  await page.goto(base + "/");
  assert.equal(new URL(page.url()).pathname, "/index.html");
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(() => document.getElementById("workbench").editor.ready);
  await page.goto(base + "/examples/index.html");
  assert.equal(new URL(page.url()).pathname, "/examples/index.html");
  await page.waitForFunction(() => document.getElementById("performance-output").textContent.includes("Qt 引擎初始化"), null, { timeout: 30000 });
  assert.equal(await page.locator("#network-form, #destroy, #remount, #diagnostics-export, #diagnostics-reset").count(), 0);
  const idleLogCount = terminalLogs.length;
  await page.waitForTimeout(1200);
  assert.equal(terminalLogs.length, idleLogCount, "Unloaded preview must not produce performance logs");
  const waitLoaded = () => page.waitForFunction(() =>
    !document.getElementById("files").disabled && document.getElementById("status").textContent.startsWith("已加载："),
    null, { timeout: 90000 });
  await page.locator("#files").setInputFiles(folder);
  await waitLoaded();
  const downloads = devRequests.filter((request) => request.method === "GET" && request.url.includes("/__dev-charts/"));
  for (const name of ["maidata.txt", "audio.wav", "video.webm"]) {
    assert.ok(downloads.some((request) => request.url.endsWith("/" + name)), `${name} must be fetched through its uploaded HTTP URL`);
  }
  const uploadedPvUrl = downloads.find((request) => request.url.endsWith("/video.webm")).url;
  assert.deepEqual(Buffer.from(await (await fetch(uploadedPvUrl)).arrayBuffer()), video);
  const devFrame = page.frameLocator("#preview iframe");
  assert.ok((await devFrame.locator("#stage-video").getAttribute("src")).startsWith("blob:"));
  await page.waitForFunction(() => document.getElementById("performance-output").textContent.includes("PV 首帧准备"));
  const panelText = await page.locator("#performance-output").textContent();
  assert.ok(terminalLogs.some((text) => panelText.includes(text)));
  await devFrame.locator("#play").click();
  await devFrame.locator("#play").filter({ hasText: "暂停" }).waitFor();
  await devFrame.locator("#play").click();
  await devFrame.locator("#play").filter({ hasText: "播放" }).waitFor();
  const logFiles = readdirSync(logDirectory);
  assert.equal(logFiles.length, 1);
  const backendReports = readFileSync(join(logDirectory, logFiles[0]), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(backendReports.some((entry) => entry.report.metrics.videoReady));
  assert.ok(backendReports.every((entry) => entry.report.schemaVersion === 1 && entry.sessionId));
  // A second upload changes the website's resources, while reusing its embed.
  await page.locator("#preview iframe").evaluate((iframe) => { iframe.dataset.originalInstance = "yes"; });
  await page.locator("#files").setInputFiles(folder);
  await waitLoaded();
  assert.equal(await page.locator("#preview iframe").getAttribute("data-original-instance"), "yes");
  const uploadsBeforeOptions = devRequests.filter((request) => request.method === "POST" && request.url === base + "/__dev-charts").length;
  assert.equal(uploadsBeforeOptions, 2);
  // Creation options rebuild the embed and reload existing URLs without uploading.
  await page.locator("#resolution").selectOption("1080x1080");
  await waitLoaded();
  assert.equal(await page.locator("#preview iframe").getAttribute("data-original-instance"), null);
  assert.deepEqual(await devFrame.locator("#viewport canvas").evaluate((canvas) => ({ width: canvas.width, height: canvas.height })), { width: 1080, height: 1080 });
  for (const maxFps of ["30", "unlimited"]) {
    await page.locator("#max-fps").selectOption(maxFps);
    await waitLoaded();
    const url = new URL(await page.locator("#preview iframe").getAttribute("src"));
    assert.equal(url.searchParams.get("maxFps"), maxFps);
    assert.equal(url.searchParams.get("width"), "1080");
    assert.equal(url.searchParams.get("height"), "1080");
  }
  for (const pvTimeout of ["10", "unlimited"]) {
    await page.locator("#pv-timeout").fill(pvTimeout);
    await page.locator("#pv-timeout").press("Tab");
    await waitLoaded();
    const url = new URL(await page.locator("#preview iframe").getAttribute("src"));
    assert.equal(url.searchParams.get("pvTimeoutMs"), pvTimeout === "unlimited" ? pvTimeout : "10000");
  }
  await page.locator("#diagnostics-enabled").uncheck();
  await waitLoaded();
  assert.equal(new URL(await page.locator("#preview iframe").getAttribute("src")).searchParams.get("diagnostics"), "0");
  assert.equal(devRequests.filter((request) => request.method === "POST" && request.url === base + "/__dev-charts").length, uploadsBeforeOptions);
  await page.screenshot({ path: join(output, "dev-page.png"), fullPage: true });
  assert.deepEqual(errors, []);
  assert.ok(
    !consoleLogs.some(
      (text) =>
        text.includes("[MiaView performance]") ||
        text.includes("[MiaView initialization]"),
    ),
  );
  console.log(`Standalone SDK browser smoke passed; screenshots: ${output}`);
} finally {
  await browser.close();
  await Promise.all([
    new Promise((resolve) => host.close(resolve)),
    new Promise((resolve) => renderer.close(resolve)),
  ]);
}

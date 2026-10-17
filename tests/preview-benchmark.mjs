import assert from "node:assert/strict";
import { cpus, release } from "node:os";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { launchPreviewBrowser, previewGraphics } from "./preview-browser.mjs";

// Explicit benchmark, independent of the functional gate and CI runner speed.
const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chrome";
const verifyReference = process.argv.includes("--verify-reference");
if (verifyReference) assert.equal(name, "chromium", "Reference profile uses bundled Chromium with the physical GPU");
const output = resolve("artifacts/preview-benchmark", process.env.MIACODE_BENCHMARK_LABEL || "baseline", name);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await listenForBrowser(server);
const headless = process.env.MIACODE_BENCHMARK_HEADED !== "1";
const browser = await launchPreviewBrowser(playwright, name, { hardware: true, headless });
const report = { cpu: cpus()[0].model, os: `${process.platform} ${release()}`, browser: browser.version(), headless,
  identity: JSON.parse(readFileSync("renderer/build-identity.json", "utf8")), cases: [] };
const chart = notes => `&title=Preview benchmark\n&first=0\n&lv_5=13\n&inote_5=(180){16}${notes.join(",")},E`;
const ordinary = chart(Array.from({ length: 512 }, (_, i) => String(i % 8 + 1)));
const dense = chart(Array.from({ length: 1024 }, (_, i) => `${i % 8 + 1}/${(i + 2) % 8 + 1}/${(i + 4) % 8 + 1}/${(i + 6) % 8 + 1}`));
const fireworks = chart(Array.from({ length: 512 }, () => "Cf/B1f/B3f/B5f/B7f"));
const long = chart(Array.from({ length: 8192 }, (_, i) => String(i % 8 + 1)));
const cases = [
  { key: "ordinary-square", text: ordinary, size: [1080, 1080] },
  { key: "dense-square", text: dense, size: [1080, 1080] },
  { key: "long-square", text: long, size: [1080, 1080], start: 120 },
  { key: "firework-square", text: fireworks, size: [1080, 1080] },
  { key: "ordinary-wide", text: ordinary, size: [1920, 1080] },
  { key: "ordinary-free", text: ordinary, size: [1350, 1080] },
  { key: "pv-wide", text: ordinary, size: [1920, 1080], pv: true },
];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1960, height: 1160 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  await page.route("**/browser-video.mjs", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
const benchmarkAt = BrowserVideoFrames.prototype.at;
BrowserVideoFrames.prototype.at = function(second, rate) {
  const source = benchmarkAt.call(this, second, rate);
  if (source) window.benchmarkPvTime = source.timestamp;
  return source;
};` });
  });
  await page.route("**/qtloader.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
const benchmarkQtLoad = qtLoad;
qtLoad = async config => {
  const module = await benchmarkQtLoad(config);
  window.benchmarkModule = module;
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
    if (this.canvas.id === 'stage-pv' && Number.isFinite(source.currentTime)) window.benchmarkPvTime = source.currentTime;
    return draw.call(this, source, ...args);
  };
  const call = module.ccall.bind(module);
  module.ccall = (name, result, types, values) => {
    if (name === 'miacode_tick') {
      window.benchmarkSecond = values[0];
    }
    return call(name, result, types, values);
  };
  return module;
};` });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);
  report.graphics = await previewGraphics(page, name);
  if (verifyReference) assert.doesNotMatch(report.graphics.renderer, /swiftshader|llvmpipe|software/i);
  await page.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs");
    document.body.style.padding = "0";
    document.getElementById("host-play").remove();
    document.getElementById("one").style.width = "1920px";
    window.preview = createPreview(document.getElementById("one"), { resolution: { width: 1080, height: 1080 }, maxFps: 60 });
    await preview.ready;
    const media = await import("/renderer/vendor/mediabunny/index.mjs"), target = new media.BufferTarget();
    const output = new media.Output({ format: new media.WebMOutputFormat(), target });
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext("2d"), source = new media.CanvasSource(canvas, { codec: "vp8", bitrate: 300000 });
    output.addVideoTrack(source, { frameRate: 60 }); await output.start();
    for (let frame = 0; frame < 600; ++frame) {
      context.fillStyle = `rgb(${frame % 200},80,${255 - frame % 200})`; context.fillRect(0, 0, 320, 180);
      await source.add(frame / 60, 1 / 60);
    }
    await output.finalize(); window.benchmarkVideo = new Blob([target.buffer], { type: "video/webm" });
  });
  const renderer = page.frames().find(frame => frame.url().includes("/renderer/index.html"));
  const selected = process.env.MIACODE_BENCHMARK_CASE
    ? cases.filter(item => item.key === process.env.MIACODE_BENCHMARK_CASE) : cases;
  for (const [index, item] of selected.entries()) {
    if (index) await page.evaluate(() => preview.pause());
    await page.evaluate(async item => {
      await preview.setCanvasSize({ width: item.size[0], height: item.size[1] });
      await preview.setSettings({ layoutSquareScale: 1 });
      await preview.load({ maidata: item.text, difficulty: 5, ...(item.pv ? { video: benchmarkVideo } : {}) });
      await preview.seek(item.start || 1); await preview.play();
    }, item);
    // Warm the loaded scene before measuring the retained frame pipeline.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1200)));
    const sample = await renderer.evaluate(async () => {
      const intervals = [], presentations = [], renderWork = [], sync = [], frame = () => benchmarkModule.ccall("miacode_frame_count", "number", [], []);
      const canvas = document.getElementById("qt-screen").querySelector("#qt-shadow-container").shadowRoot.querySelector("canvas");
      const capturedTimestamps = [], stream = canvas.captureStream();
      const track = stream.getVideoTracks()[0], reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      const capture = (async () => {
        for (;;) { const { value, done } = await reader.read(); if (done) break; capturedTimestamps.push(value.timestamp); value.close(); }
      })();
      const onFrame = benchmarkModule.onPreviewFrame;
      window.benchmarkCompositeSamples = [];
      let presentedAt;
      benchmarkModule.onPreviewFrame = (now, started, second) => {
        onFrame?.(now, started, second);
        const video = document.getElementById("stage-video");
        if (video.src && !video.hidden && Number.isFinite(window.benchmarkPvTime))
          window.benchmarkCompositeSamples.push(Math.abs(second - window.benchmarkPvTime) * 1000);
        if (Number.isFinite(started)) renderWork.push(now - started);
        if (presentedAt !== undefined) presentations.push(now - presentedAt);
        presentedAt = now;
      };
      let previous = frame(), last = performance.now(), total = 0;
      const start = last;
      await new Promise(resolve => {
        const poll = now => {
          const current = frame();
          if (current !== previous) { intervals.push(now - last); total += current - previous; previous = current; last = now; }
          const video = document.getElementById("stage-video");
          if (video.src && !video.seeking && !video.paused && Number.isFinite(window.benchmarkSecond))
            sync.push(Math.abs(video.currentTime - benchmarkSecond) * 1000);
          if (now - start >= 5000) resolve(); else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      });
      benchmarkModule.onPreviewFrame = onFrame;
      await reader.cancel(); track.stop(); await capture;
      const compositeSamples = window.benchmarkCompositeSamples; window.benchmarkCompositeSamples = null;
      const percentile = (values, p) => values.sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null;
      const captureIntervals = capturedTimestamps.slice(1).map((time, index) => (time - capturedTimestamps[index]) / 1000);
      return { durationMs: performance.now() - start, frames: total, fps: total * 1000 / (performance.now() - start),
        observedFrames: intervals.length, capturedFrames: capturedTimestamps.length,
        captureFps: (capturedTimestamps.length - 1) * 1e6 / (capturedTimestamps.at(-1) - capturedTimestamps[0]),
        captureIntervalP95Ms: percentile(captureIntervals, .95), captureIntervalMaxMs: Math.max(...captureIntervals),
        intervalP95Ms: percentile(intervals, .95), intervalMaxMs: Math.max(...intervals),
        nativePresentP95Ms: percentile(presentations, .95), nativePresentMaxMs: presentations.length ? Math.max(...presentations) : null,
        renderWorkP95Ms: percentile(renderWork, .95), renderWorkMaxMs: renderWork.length ? Math.max(...renderWork) : null,
        pvClockP95Ms: percentile(sync, .95), pvClockMaxMs: sync.length ? Math.max(...sync) : null,
        pvCompositeP95Ms: percentile(compositeSamples, .95),
        pvCompositeMaxMs: compositeSamples.length ? Math.max(...compositeSamples) : null };
    });
    await page.evaluate(() => preview.pause());
    const result = { key: item.key, size: item.size, ...sample, diagnostics: await page.evaluate(() => preview.getDiagnostics()) };
    report.cases.push(result); writeFileSync(resolve(output, "results.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...sample, key: item.key }));
    assert.ok(sample.frames > 0, item.key);
    if (verifyReference) {
      assert.ok(sample.fps >= 57 && sample.captureFps >= 57, `${item.key}: actual presented/captured FPS`);
      assert.ok(sample.intervalP95Ms <= 20 && sample.renderWorkP95Ms <= 20, `${item.key}: RAF-observed interval/render work p95`);
    }
  }
} finally {
  await page?.evaluate(() => window.preview?.destroy()).catch(() => {});
  writeFileSync(resolve(output, "results.json"), JSON.stringify(report, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

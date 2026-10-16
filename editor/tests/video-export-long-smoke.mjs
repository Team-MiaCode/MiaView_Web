import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", output = resolve("artifacts/video-export-long", name);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await browsers[name].launch({ headless: true });
const errors = [], started = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "log" && message.text().startsWith("Long export:")) console.log(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);
  await page.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs");
    window.preview = createPreview(document.getElementById("one"), { resolution: { width: 128, height: 128 }, controls: false, diagnostics: false });
    await preview.ready;
    const rate = 24000, seconds = 180, bytes = new Uint8Array(44 + rate * seconds * 2), view = new DataView(bytes.buffer);
    const text = (offset, value) => [...value].forEach((char, index) => bytes[offset + index] = char.charCodeAt(0));
    text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes.length - 44, true);
    for (let index = 0; index < rate * seconds; ++index) view.setInt16(44 + index * 2, Math.round(4000 * Math.sin(2 * Math.PI * 440 * index / rate)), true);
    await preview.load({ maidata: "&title=Three minute export\n&first=0\n&inote_5=(120){4}1,2,3,4,E", audio: new Blob([bytes], { type: "audio/wav" }), difficulty: 5 });
    await preview.seek(.3); await preview.setPlayback({ rate: .75 });
    await preview.setSettings({ showTimestamp: false, showChartInfoHud: false });
    window.exportResult = null; window.exportFailure = null;
    preview.on("exportCompleted", value => { window.exportResult = value; });
    preview.on("exportFailed", value => { window.exportFailure = value; });
    let milestone = -1;
    preview.on("exportProgress", value => {
      const quarter = Math.floor(value.progress * 4);
      if (quarter !== milestone) { milestone = quarter; console.log(`Long export: ${value.frame}/${value.frameCount} frames`); }
    });
    await preview.startExport({ width: 128, height: 128, fps: 30, introEnabled: false, clockCountEnabled: false, presetIndex: 0 });
  });
  await waitForAsync(page, () => Boolean(window.exportResult || window.exportFailure), undefined, { timeout: 900000, polling: 1000 });
  const result = await page.evaluate(async () => {
    if (window.exportFailure) throw new Error(window.exportFailure.message);
    const result = window.exportResult, media = await import("/renderer/vendor/mediabunny/index.mjs");
    const input = new media.Input({ source: new media.BlobSource(result.blob), formats: media.ALL_FORMATS });
    try {
      const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
      let frames = 0, firstTimestamp, lastTimestamp, gaps = 0;
      for await (const sample of new media.VideoSampleSink(video).samples()) {
        firstTimestamp ??= sample.timestamp;
        if (lastTimestamp !== undefined && Math.abs(sample.timestamp - lastTimestamp - 1 / 30) > .0001) ++gaps;
        lastTimestamp = sample.timestamp; ++frames; sample.close();
      }
      const windows = [[.2, 1.8], [5, 5.2], [91, 91.2], [181, 181.2]].map(([start, end]) => ({ start, end, energy: 0, count: 0 }));
      let audioEnd = 0;
      for await (const item of new media.AudioBufferSink(audio).buffers()) {
        const data = item.buffer.getChannelData(0), rate = item.buffer.sampleRate;
        audioEnd = item.timestamp + item.buffer.duration;
        for (const range of windows) {
          const start = Math.max(0, Math.ceil((range.start - item.timestamp) * rate)), end = Math.min(data.length, Math.floor((range.end - item.timestamp) * rate));
          for (let index = start; index < end; ++index) { range.energy += data[index] ** 2; ++range.count; }
        }
      }
      const { blob, ...metadata } = result;
      const encoded = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(blob); });
      return { ...metadata, bytes: blob.size, frames, firstTimestamp, lastTimestamp, gaps, audioEnd, duration: await input.computeDuration(),
        rms: windows.map(range => Math.sqrt(range.energy / range.count)), restored: await preview.getState(), encoded };
    } finally { input.dispose(); }
  });
  writeFileSync(join(output, `three-minute${result.extension}`), Buffer.from(result.encoded, "base64")); delete result.encoded;
  writeFileSync(join(output, "results.json"), JSON.stringify({ ...result, wallSeconds: (Date.now() - started) / 1000, errors }, null, 2));
  assert.equal(result.frameCount, 5460); assert.equal(result.frames, 5460); assert.equal(result.gaps, 0);
  assert.ok(Math.abs(result.duration - 182) < .06); assert.ok(Math.abs(result.audioEnd - 182) < .06);
  assert.ok(Math.abs(result.firstTimestamp) < .001); assert.ok(Math.abs(result.lastTimestamp - (182 - 1 / 30)) < .001);
  assert.ok(result.rms[0] < .001); assert.ok(result.rms.slice(1).every(value => value > .01));
  assert.ok(Math.max(...result.rms.slice(1)) - Math.min(...result.rms.slice(1)) < .005);
  assert.ok(Math.abs(result.restored.currentTime - .3) < .001); assert.equal(result.restored.playback.rate, .75);
  assert.equal(result.restored.playing, false); assert.equal(result.restored.resolution.width, 128); assert.deepEqual(errors, []);
  console.log("Three minute video: 5460 decoded frames, continuous timestamps, complete music and restored preview passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

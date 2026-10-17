import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chrome", output = resolve("artifacts/pv-sync", name);
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(playwright, name), results = [];
const deadline = setTimeout(() => { console.error("PV synchronization acceptance exceeded 120 seconds"); void browser.close(); }, 120000);
try {
  const page = await browser.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/browser-video.mjs", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
const syncAt = BrowserVideoFrames.prototype.at;
BrowserVideoFrames.prototype.at = function(second, rate) {
  const source = syncAt.call(this, second, rate);
  window.syncSelection = {timestamp:source?.timestamp, frames:this.frames.map(frame=>frame.timestamp)};
  return source;
};` });
  });
  await page.route("**/qtloader.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
const syncQtLoad = qtLoad;
qtLoad = async config => {
  const module = await syncQtLoad(config), call = module.ccall.bind(module);
  window.syncSamples = []; window.lastDecodedFrame = null;
  let onFrame;
  Object.defineProperty(module, 'onPreviewFrame', {
    get:()=> (...args)=> { onFrame?.(...args); window.syncRenderedSecond = args[2]; },
    set:handler=> { onFrame = handler; }
  });
  window.beginSyncMeasurement = () => {
    window.syncCompositeSamples = []; window.syncActive = true;
    const sample = () => {
      if (!syncActive) return;
      if (Number.isFinite(window.syncRenderedSecond) && lastDecodedFrame !== null)
        syncCompositeSamples.push({chartSecond:syncRenderedSecond,decodedFrame:lastDecodedFrame,selection:window.syncSelection});
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  };
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  const probe = document.createElement('canvas'); probe.width = 128; probe.height = 64;
  const context = probe.getContext('2d', {willReadFrequently:true});
  CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
    const result = draw.call(this, source, ...args);
    if (this.canvas.id === 'stage-pv') {
      draw.call(context, source, 0, 0, 128, 64);
      const pixels = context.getImageData(0, 32, 128, 1).data;
      let frame = 0;
      for (let bit = 0; bit < 9; ++bit) if (pixels[(bit * 12 + 6) * 4] > 127) frame |= 1 << bit;
      window.lastDecodedFrame = frame;
    }
    return result;
  };
  module.ccall = (name, result, types, values) => {
    const value = call(name, result, types, values);
    if (name === 'miacode_tick' || name === 'miacode_seek') window.syncNativeSecond = values[0];
    const video = document.getElementById('stage-video');
    if (name === 'miacode_tick' && window.syncActive && window.lastDecodedFrame !== null && !video.seeking)
      syncSamples.push({chartSecond:values[0], decodedFrame:lastDecodedFrame, videoSecond:video.currentTime,
        selection:window.syncSelection, frameError:Math.floor(values[0]*60)-lastDecodedFrame});
    return value;
  };
  return module;
};` });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);
  await page.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs"), media = await import("/renderer/vendor/mediabunny/index.mjs");
    window.preview = createPreview(document.getElementById("one"), { resolution: { width: 320, height: 180 }, controls: false }); await preview.ready;
    const target = new media.BufferTarget(), output = new media.Output({ format: new media.WebMOutputFormat(), target });
    const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 64;
    const context = canvas.getContext("2d"), source = new media.CanvasSource(canvas, { codec: "vp8", bitrate: 300000 });
    output.addVideoTrack(source, { frameRate: 60 }); await output.start();
    for (let frame = 0; frame < 360; ++frame) {
      context.fillStyle = "black"; context.fillRect(0, 0, 128, 64); context.fillStyle = "white";
      for (let bit = 0; bit < 9; ++bit) if (frame & 1 << bit) context.fillRect(bit * 12, 0, 11, 64);
      await source.add(frame / 60, 1 / 60);
    }
    await output.finalize();
    await preview.load({ maidata: "&title=PV frame sync\n&lv_5=12\n&inote_5=(120){4}" + "1,2,3,4,".repeat(8) + "E",
      video: new Blob([target.buffer], { type: "video/webm" }), difficulty: 5 });
  });
  const renderer = page.frames().find(frame => frame.url().includes("/renderer/index.html"));
  for (const rate of [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2]) {
    await page.evaluate(async rate => { await preview.pause(); await preview.seek(.3); await preview.setPlayback({ rate }); await preview.play(); }, rate);
    await renderer.evaluate(() => { syncSamples = []; beginSyncMeasurement(); });
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1500)));
    const { samples, compositeSamples } = await renderer.evaluate(() => { syncActive = false; return { samples:syncSamples, compositeSamples:syncCompositeSamples }; });
    await page.evaluate(() => preview.pause());
    // A source frame covers an interval. Convert distance to that interval to
    // display time so the 60 Hz tolerance retains the same meaning at each rate.
    const syncErrorMs = sample => Math.max(sample.decodedFrame / 60 - sample.chartSecond,
      sample.chartSecond - (sample.decodedFrame + 1) / 60, 0) / rate * 1000;
    const result = { rate, samples, compositeSamples, maximumFrameError: Math.max(...samples.map(sample => Math.abs(sample.frameError))),
      maximumSyncErrorMs: Math.max(...samples.map(syncErrorMs)), maximumCompositeSyncErrorMs: Math.max(...compositeSamples.map(syncErrorMs)) };
    results.push(result); assert.ok(samples.length > 40, JSON.stringify({ rate, samples: samples.length }));
    // Qt's deferred render callback supplies the scene time visible in the composite.
    assert.ok(compositeSamples.length > 40 && result.maximumCompositeSyncErrorMs <= 1000 / 60 + 1e-9,
      JSON.stringify({ rate, maximumCompositeSyncErrorMs: result.maximumCompositeSyncErrorMs,
        examples: compositeSamples.filter(sample => syncErrorMs(sample) > 1000 / 60).slice(0, 5) }));
    const paused = await page.evaluate(() => preview.getState());
    await renderer.waitForFunction(second => Math.abs(Math.floor(second * 60) - lastDecodedFrame) <= 1, paused.currentTime);
    console.log(JSON.stringify({ rate, samples: samples.length, maximumFrameError: result.maximumFrameError,
      maximumSyncErrorMs: result.maximumSyncErrorMs, maximumCompositeSyncErrorMs: result.maximumCompositeSyncErrorMs }));
  }
  for (const second of [2.5, .25]) {
    console.log(JSON.stringify({ seek: second }));
    await page.evaluate(second => preview.seek(second), second);
    try { await renderer.waitForFunction(second => Math.abs(Math.floor(second * 60) - lastDecodedFrame) <= 1, second, { timeout: 5000 }); }
    catch (error) {
      console.log(await renderer.evaluate(() => ({ decodedFrame: lastDecodedFrame, renderedSecond: syncRenderedSecond,
        videoSecond: document.getElementById("stage-video").currentTime, selection: syncSelection })));
      throw error;
    }
    assert.equal((await page.evaluate(() => preview.getState())).currentTime, second);
  }
  assert.deepEqual(errors, []);
} finally {
  clearTimeout(deadline);
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

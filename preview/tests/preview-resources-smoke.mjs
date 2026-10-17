import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium";
const output = resolve("artifacts/preview-resources", name); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(playwright, name), report = { browser: name, cycles: [] };
try {
  const page = await browser.newPage(); page.setDefaultTimeout(120000);
  await page.addInitScript(() => {
    if (parent === window) {
      window.resourceRecords = []; window.resourceURLs = new Set(); window.messageListeners = new Set();
      // Records belong to the host realm; their weak references cannot retain a removed iframe.
      window.trackResource = (kind, target) => {
        const record = { kind, reference: new WeakRef(target), released: false };
        resourceRecords.push(record); return record;
      };
      const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
      window.addEventListener = (type, listener, options) => {
        if (type === "message") messageListeners.add(listener); add(type, listener, options);
      };
      window.removeEventListener = (type, listener, options) => {
        if (type === "message") messageListeners.delete(listener); remove(type, listener, options);
      };
      return;
    }
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { const url = create(value); parent.resourceURLs.add(url); return url; };
    URL.revokeObjectURL = url => { parent.resourceURLs.delete(url); revoke(url); };
    for (const [kind, key, release] of [["audio", "AudioContext", "close"], ["worker", "Worker", "terminate"]]) {
      const Constructor = window[key];
      window[key] = new Proxy(Constructor, { construct(target, args) {
        const value = Reflect.construct(target, args), record = parent.trackResource(kind, value);
        const close = value[release].bind(value);
        value[release] = (...args) => { record.released = true; return close(...args); };
        return value;
      } });
    }
    const Frame = window.VideoFrame, records = new WeakMap(), close = Frame.prototype.close;
    window.VideoFrame = new Proxy(Frame, { construct(target, args) {
      const value = Reflect.construct(target, args);
      records.set(value, parent.trackResource("frame", value)); return value;
    } });
    Frame.prototype.close = function(...args) {
      const record = records.get(this); if (record) record.released = true;
      return close.apply(this, args);
    };
  });
  await page.route("**/qtloader.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
const resourceQtLoad = qtLoad;
qtLoad = async config => {
  const module = await resourceQtLoad(config);
  parent.trackResource('heap', module.HEAPU8.buffer);
  return module;
};` });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const collect = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
    await cdp.send("HeapProfiler.collectGarbage");
    return page.evaluate(() => ({ listeners: messageListeners.size, urls: resourceURLs.size,
      iframes: document.querySelectorAll("iframe").length,
      resources: resourceRecords.map(record => {
        const value = record.reference.deref();
        return { kind: record.kind, collected: !value, released: record.released,
          ...(record.kind === "audio" && value ? { state: value.state } : {}),
          ...(record.kind === "frame" && value ? { codedWidth: value.codedWidth } : {}) };
      }) }));
  };
  report.baseline = await collect();
  for (let cycle = 0; cycle < 4; ++cycle) {
    await page.evaluate(async () => {
      const { createPreview } = await import("/sdk/index.mjs");
      window.preview = createPreview(document.getElementById("one"), { resolution: { width: 320, height: 320 } });
      await preview.ready;
      const pv = await fetch("/tests/fixtures/bg-pattern.webm").then(response => response.blob());
      const samples = new Uint8Array(44 + 44100 * 2), view = new DataView(samples.buffer);
      const text = (at, value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
      text(0, "RIFF"); view.setUint32(4, samples.length - 8, true); text(8, "WAVEfmt ");
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 44100, true); view.setUint32(28, 88200, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length - 44, true);
      await preview.load({ maidata: "&title=Resources\n&inote_5=(120){4}1,2,3,4,E", difficulty: 5,
        video: pv, audio: new Blob([samples], { type: "audio/wav" }) });
      await preview.getAnalysis(); await preview.play();
      await new Promise(resolve => setTimeout(resolve, 150));
      preview.destroy(); window.preview = null;
    });
    const snapshot = await collect();
    const heap = await cdp.send("Runtime.getHeapUsage"), dom = await cdp.send("Memory.getDOMCounters");
    report.cycles.push({ cycle, ...snapshot, heap, dom });
    assert.equal(snapshot.listeners, report.baseline.listeners); assert.equal(snapshot.urls, 0); assert.equal(snapshot.iframes, 0);
    assert.ok(snapshot.resources.filter(record => record.kind !== "heap").every(record => record.collected || record.released), JSON.stringify(snapshot));
    assert.ok(snapshot.resources.filter(record => record.kind === "audio").every(record => record.collected || record.state === "closed"));
    assert.ok(snapshot.resources.filter(record => record.kind === "frame").every(record => record.collected || record.codedWidth === 0));
    assert.ok(snapshot.resources.filter(record => record.kind === "heap").every(record => record.collected), "WASM heaps retained after iframe disposal");
  }
  for (let cycle = 0; cycle < 4; ++cycle) {
    await page.evaluate(async () => {
      const { createPreview } = await import("/sdk/index.mjs");
      const preview = createPreview(document.getElementById("one"));
      const result = preview.ready.catch(error => error.message);
      await new Promise(resolve => setTimeout(resolve, 20)); preview.destroy();
      await result;
    });
  }
  report.afterEarlyCancellation = await collect();
  assert.equal(report.afterEarlyCancellation.listeners, report.baseline.listeners);
  assert.equal(report.afterEarlyCancellation.iframes, 0); assert.equal(report.afterEarlyCancellation.urls, 0);
  report.passed = true;
  console.log("Four media/analysis mount cycles release native heaps, decoded frames, audio, workers, URLs and listeners; four startup cancellations release widgets");
} finally {
  writeFileSync(resolve(output, "results.json"), JSON.stringify(report, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

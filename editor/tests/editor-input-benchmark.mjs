import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chrome", output = resolve("artifacts/editor-input-benchmark", name);
const profile = process.env.MIACODE_INPUT_PROFILE === "1";
const noteCounts = process.env.MIACODE_INPUT_NOTES ? [Number(process.env.MIACODE_INPUT_NOTES)] : [512, 8192];
const inputCount = Number(process.env.MIACODE_INPUT_KEYS || 40);
const wrap = process.env.MIACODE_INPUT_WRAP;
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false }); await listenForBrowser(server);
const browser = await launchPreviewBrowser(playwright, name), results = [];
const deadline = setTimeout(() => { console.error("Input benchmark exceeded 600 seconds"); void browser.close(); }, 600000);
let page, trace;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(120000);
  if (profile) page.on("console", message => { if (message.text().startsWith("INPUT_PROFILE")) console.log(message.text()); });
  if (profile) await page.route("**/qtloader.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
const inputQtLoad = qtLoad;
qtLoad = async config => {
  const module = await inputQtLoad(config), call = module.ccall.bind(module);
  module.ccall = (name, ...args) => {
    if (!['miacode_editor_command','miacode_document_command','miacode_analysis'].includes(name)) return call(name, ...args);
    const started = performance.now(); console.log('INPUT_PROFILE native-start', name);
    const result = call(name, ...args); console.log('INPUT_PROFILE native-end', name, performance.now() - started); return result;
  };
  return module;
};` });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => Boolean(document.getElementById("workbench")?.editor));
  await page.evaluate(async profile => {
    window.editor = document.getElementById("workbench").editor; await editor.ready;
    if (profile) {
      const owner = editor.preview.windowRouter.owner, request = owner.request.bind(owner);
      owner.request = (type, payload) => {
        const started = performance.now(); console.log("INPUT_PROFILE start", type, payload?.id || "");
        return request(type, payload).then(value => {
          console.log("INPUT_PROFILE end", type, payload?.id || "", performance.now() - started); return value;
        });
      };
    }
    const source = editor.workbench.sourceEditor, draw = source.draw.bind(source);
    if (profile) {
      const apply = source.applyTransaction.bind(source);
      source.applyTransaction = (...args) => {
        const started = performance.now(); console.log("INPUT_PROFILE apply-start");
        apply(...args); console.log("INPUT_PROFILE apply-end", performance.now() - started);
      };
      for (const [object, method] of [[source, "capture"], [source.input, "setRangeText"],
        [source.input, "setSelectionRange"], [source, "cursor"], [source, "focus"], [source, "onInput"],
        [editor.workbench, "setDocument"], [editor.workbench, "update"], [editor.workbench, "updateSidebar"],
        [editor.workbench, "renderBottom"], [editor.workbench.editorTabs, "update"], [editor.workbench.editorTabs, "layout"],
        [source, "setDocument"], [source, "setAnnotations"]]) {
        const original = object[method].bind(object);
        object[method] = (...args) => {
          const started = performance.now(), result = original(...args);
          console.log("INPUT_PROFILE phase", method, performance.now() - started); return result;
        };
      }
    }
    source.draw = (...args) => {
      if (profile) console.log("INPUT_PROFILE draw-start", source.input.value.length);
      const started = performance.now(); draw(...args);
      if (profile) console.log("INPUT_PROFILE draw-end", performance.now() - started);
      const sample = window.pendingInputSample;
      if (sample && !sample.visibleQueued && source.input.value.length !== sample.originalLength) {
        sample.visibleQueued = true; sample.drawMs = performance.now() - started;
        requestAnimationFrame(() => { sample.visibleMs = performance.now() - sample.started; });
      }
    };
  }, profile);
  if (profile && browser.browserType().name() === "chromium") {
    trace = await page.context().newCDPSession(page);
    await trace.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing", transferMode: "ReturnAsStream" });
  }
  for (const notes of noteCounts) {
    console.log(JSON.stringify({ phase: "load", notes }));
    await page.evaluate(async ({ notes, wrap }) => {
      const text = Array.from({ length: notes }, (_, i) => `${i % 8 + 1},`).join("\n");
      await editor.load({ maidata: `&title=Input benchmark\n&lv_5=13\n&inote_5=(180){16}\n${text}\nE`, difficulty: 5 });
      window.inputSamples = [];
      const source = editor.workbench.sourceEditor, input = source.input;
      if (wrap) editor.viewState.setPreference("editorAutoWrap", wrap === "on");
      input.setSelectionRange(0, 0); input.focus();
      window.inputProbe?.abort(); window.inputProbe = new AbortController();
      input.addEventListener("beforeinput", () => {
        const sample = { started: performance.now(), originalLength: input.value.length };
        window.pendingInputSample = sample; inputSamples.push(sample);
        void source.pending.then(() => {
          sample.commandMs = performance.now() - sample.started;
        });
      }, { signal: inputProbe.signal });
      window.originalInputLength = input.value.length;
    }, { notes, wrap });
    console.log(JSON.stringify({ phase: "input", notes }));
    if (profile) console.log(await page.evaluate(() => JSON.stringify({ phase: "dom", all: document.querySelectorAll("*").length,
      source: editor.workbench.sourceEditor.root.querySelectorAll("*").length,
      visibleRows: editor.workbench.sourceEditor.visibleRows.size,
      timeline: editor.workbench.timelineView.root.querySelectorAll("*").length })));
    const input = page.locator(".source-input");
    for (let index = 0; index < inputCount; ++index) {
      await input.press(String(index % 8 + 1));
      await page.waitForFunction(count => inputSamples.length >= count
        && inputSamples[count - 1].visibleMs !== undefined && inputSamples[count - 1].commandMs !== undefined, index + 1);
    }
    const result = await page.evaluate(notes => {
      const percentile = key => inputSamples.map(sample => sample[key]).sort((a, b) => a - b)[Math.ceil(inputSamples.length * .95) - 1];
      return { notes, samples: inputSamples, commandP95Ms: percentile("commandMs"), visibleP95Ms: percentile("visibleMs"),
        textGrowth: editor.workbench.sourceEditor.input.value.length - originalInputLength };
    }, notes);
    results.push(result);
    assert.equal(result.textGrowth, inputCount);
    assert.equal(await page.evaluate(async () => (await editor.preview.getDocument()).chartText), await input.inputValue());
    assert.ok(result.visibleP95Ms < 100, JSON.stringify({ notes, visibleP95Ms: result.visibleP95Ms }));
    console.log(JSON.stringify({ notes, commandP95Ms: result.commandP95Ms, visibleP95Ms: result.visibleP95Ms }));
  }
} finally {
  clearTimeout(deadline);
  if (trace) {
    writeFileSync(resolve(output, "dom-snapshot.json"), JSON.stringify(await trace.send("DOMSnapshot.captureSnapshot", { computedStyles: [] })));
    const complete = new Promise(resolve => trace.once("Tracing.tracingComplete", resolve));
    await trace.send("Tracing.end");
    const { stream } = await complete, file = openSync(resolve(output, "trace.json"), "w");
    try {
      for (;;) {
        const chunk = await trace.send("IO.read", { handle: stream });
        writeSync(file, chunk.base64Encoded ? Buffer.from(chunk.data, "base64") : chunk.data);
        if (chunk.eof) break;
      }
    } finally { closeSync(file); await trace.send("IO.close", { handle: stream }); }
  }
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

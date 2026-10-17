import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerController } from "../renderer/player-controller.mjs";

function fixture({ intro = false } = {}) {
  let chart = null, position = 0, exporting = false, settings = { tapFlowSpeed: 7.5, noteSkin: "DX" };
  const calls = [];
  const engine = {
    boot: Promise.resolve(),
    async flushPreview() {},
    events(listener) { this.emit = listener; },
    exportRunning:()=>exporting,
    introAuditionActive:()=>intro,
    async stopIntroAudition(){calls.push("introStopped");},
    setPerformance(value){calls.push(["performance",value]);return value;},
    startExport(){exporting=true;return {jobId:"export-job"};},
    async cancelExport(){exporting=false;return {jobId:"export-job"};},
    getExportStatus:()=>({running:exporting}),
    chart: () => chart,
    getDocument: () => ({ charts: chart?.charts || [] }),
    state: () => ({ currentTime: position, duration: 10, settings }),
    setCoverChart(resources, duration) { calls.push(["coverChart", resources, duration]); return { chartFrameDuration: duration }; },
    clear() { calls.push("clear"); chart = null; },
    async load(resources, difficulty) {
      calls.push(["load", resources, difficulty]);
      chart = { title: "Test", charts: [{ id: 5 }, { id: 6 }], difficultyId: difficulty ?? 6 };
      this.emit("paused", { elapsedMs: 0 });
    },
    async documentCommand(request) {
      calls.push(["document", request]);
      chart = { ...chart, difficultyId: request.args.difficulty };
      return { accepted: true };
    },
    setSettings(value) { calls.push(["settings", value]); settings = { ...settings, ...value }; return settings; },
    seek(value) { position = Math.min(value, 10); },
    async play() { calls.push("play"); },
    pause() { calls.push("pause"); },
  };
  const controller = createPlayerController(engine);
  const events = [];
  controller.events((type, payload) => events.push({ type, payload }));
  return { controller, engine, events, calls };
}

test("Read-only analysis keeps the captured revision while preview commands flush current edits", async () => {
  const { controller, engine } = fixture();
  let resolveAnalysis, stateResolved = false, flushed = false;
  engine.getAnalysis = () => new Promise(resolve => { resolveAnalysis = resolve; });
  engine.flushPreview = async () => { flushed = true; };
  const analysis = controller.execute("getAnalysis");
  const state = controller.execute("getState").then(value => { stateResolved = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(stateResolved, true); assert.equal(flushed, true); }
  finally { resolveAnalysis({ revision: 3 }); await state; await analysis; }
});

test("performance changes retain an active intro audition and validate frame rate modes", async () => {
  const { controller, calls } = fixture({ intro: true });
  const settings = { canvasFrameRateMode: 0, stageMediaFrameRateMode: 2, videoDecodePrefersSoftware: true };
  assert.deepEqual(await controller.execute("setPerformance", settings), settings);
  assert.deepEqual(calls, [["performance", settings]]);
  await assert.rejects(controller.execute("setPerformance", { canvasFrameRateMode: 4 }), /帧率/);
  assert.equal(calls.length, 1);
});

test("controller shares settings and seek events across UI and host commands", async () => {
  const { controller, events, calls } = fixture();
  await controller.execute("load", { maidata: { text: "&inote_5=1,E" } });
  await controller.execute("setSettings", { tapFlowSpeed: 8 });
  await controller.execute("seek", { second: 20 });
  assert.deepEqual(events.find((e) => e.type === "settingsChanged").payload, { tapFlowSpeed: 8, noteSkin: "DX" });
  assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === "settings"), ["settings", { tapFlowSpeed: 8 }]);
  assert.deepEqual(events.find((e) => e.type === "seeked").payload, { currentTime: 10 });
  await controller.execute("selectDifficulty", { difficulty: 5 });
  assert.equal(calls.filter(call => Array.isArray(call) && call[0] === "load").length, 1);
  assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === "document"),
    ["document", { id: "document.selectDifficulty", args: { difficulty: 5 } }]);
});

test("Cover charts preserve normalized text, local bytes and duration without starting playback", async () => {
  const { controller, calls } = fixture();
  const text = "&inote_5=(120){4}1,2,E";
  assert.equal((await controller.execute("setCoverChart", { chart: { maidata: { text }, difficulty: 5 }, duration: 12 })).chartFrameDuration, 12);
  assert.deepEqual(calls, [["coverChart", { maidata: { text }, difficulty: 5 }, 12]]);
  const file = new Blob([text]);
  await controller.execute("setCoverChart", { chart: { maidata: file } });
  assert.equal(calls.at(-1)[1].maidata, file);
  await assert.rejects(controller.execute("setCoverChart", { chart: { maidata: text }, duration: -1 }), /duration/);
  assert.equal(calls.length, 2);
});

test("invalid commands preserve the loaded chart and do not poison the queue", async () => {
  const { controller, calls } = fixture();
  await controller.execute("load", { maidata: "&inote_5=1,E" });
  const before = calls.length;
  await assert.rejects(controller.execute("load", { maidata: { url: "file:///bad" } }), /HTTP/);
  await assert.rejects(controller.execute("seek", { second: -1 }), /Seek/);
  await assert.rejects(controller.execute("selectDifficulty", { difficulty: 7 }), /not present/);
  await assert.rejects(controller.execute("unknown"), /Unsupported/);
  assert.equal(calls.length, before);
  await Promise.all([controller.execute("restart"), controller.execute("pause")]);
  assert.deepEqual(calls.slice(-2), ["play", "pause"]);
});

test("Export keeps its renderer snapshot stable and cancellation releases mutation commands",async()=>{
  const {controller}=fixture();await controller.execute("load",{maidata:"&inote_5=1,E"});
  await controller.execute("startExport",{});
  assert.equal((await controller.execute("getExportStatus")).running,true);
  await assert.rejects(controller.execute("seek",{second:1}),/导出/);
  await controller.execute("cancelExport");
  assert.equal((await controller.execute("getExportStatus")).running,false);
  assert.equal((await controller.execute("seek",{second:1})).currentTime,1);
});

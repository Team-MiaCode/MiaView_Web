import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerController } from "../renderer/player-controller.mjs";

function fixture() {
  let chart = null, position = 0, settings = { tapFlowSpeed: 7.5, noteSkin: "DX" };
  const calls = [];
  const engine = {
    boot: Promise.resolve(),
    events(listener) { this.emit = listener; },
    chart: () => chart,
    state: () => ({ currentTime: position, duration: 10, settings }),
    clear() { calls.push("clear"); chart = null; },
    async load(resources, difficulty) {
      calls.push(["load", resources, difficulty]);
      chart = { title: "Test", charts: [{ id: 5 }, { id: 6 }], difficultyId: difficulty ?? 6 };
      this.emit("paused", { elapsedMs: 0 });
    },
    setSettings(value) { settings = value; return settings; },
    seek(value) { position = Math.min(value, 10); },
    async play() { calls.push("play"); },
    pause() { calls.push("pause"); },
  };
  const controller = createPlayerController(engine);
  const events = [];
  controller.events((type, payload) => events.push({ type, payload }));
  return { controller, events, calls };
}

test("controller shares settings and seek events across UI and host commands", async () => {
  const { controller, events, calls } = fixture();
  await controller.execute("load", { maidata: { text: "&inote_5=1,E" } });
  await controller.execute("setSettings", { tapFlowSpeed: 8 });
  await controller.execute("seek", { second: 20 });
  assert.deepEqual(events.find((e) => e.type === "settingsChanged").payload, { tapFlowSpeed: 8, noteSkin: "DX" });
  assert.deepEqual(events.find((e) => e.type === "seeked").payload, { currentTime: 10 });
  await controller.execute("selectDifficulty", { difficulty: 5 });
  const loads = calls.filter(Array.isArray);
  assert.equal(loads[0][1], loads[1][1]);
  assert.equal(loads[1][2], 5);
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

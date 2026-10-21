import test from "node:test";
import assert from "node:assert/strict";
import { startDevApp } from "../dev/app.mjs";

const charts = [
  { id: 2, label: "BSC 4" },
  { id: 5, label: "MAS 13+" },
  { id: 7, label: "UTAGE" },
];
const loaded = (difficultyId = 5, available = charts) => ({
  title: "Test", difficultyId, charts: available,
});
const chart = (name) => ({ maidata: { url: `http://localhost/${name}/maidata.txt` } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Only the DOM surface consumed by startDevApp; select values follow real DOM
// semantics so a missing option cannot accidentally look like a valid choice.
class Element {
  constructor(id = "", select = false) {
    Object.assign(this, { id, select, disabled: false, textContent: "", children: [], files: [], listeners: new Map(), currentValue: "" });
  }
  get value() { return this.currentValue; }
  set value(value) {
    const text = String(value);
    this.currentValue = this.select && !this.children.some(option => option.value === text) ? "" : text;
  }
  replaceChildren(...children) {
    this.children = children;
    this.currentValue = children[0]?.value ?? "";
  }
  addEventListener(type, listener, options) {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ listener, options });
    this.listeners.set(type, entries);
  }
  emit(type) {
    const entries = this.listeners.get(type) ?? [];
    assert.equal(entries.length, 1, `${this.id || "window"} must have exactly one ${type} handler`);
    return entries[0].listener({ type, target: this });
  }
}

function fixture(effects = {}) {
  const ids = ["files", "difficulty", "resolution", "max-fps", "diagnostics-enabled"];
  const elements = new Map(ids.map(id => [id, new Element(id, id === "difficulty")]));
  elements.set("status", new Element("status"));
  const difficulty = elements.get("difficulty");
  const placeholder = new Element();
  placeholder.value = "";
  placeholder.textContent = "请先上传谱面";
  difficulty.replaceChildren(placeholder);
  const controls = ids.map(id => elements.get(id));
  const document = {
    getElementById(id) {
      assert.ok(elements.has(id), `unexpected element: ${id}`);
      return elements.get(id);
    },
    querySelectorAll(selector) {
      assert.equal(selector, "#controls input, #controls select");
      return controls;
    },
    createElement(tag) { assert.equal(tag, "option"); return new Element(); },
  };
  const window = new Element();
  const calls = { createHost: 0, mount: 0, load: [], select: [], upload: [], attach: [], pause: 0, destroy: 0 };
  const host = {
    active: false,
    preview: undefined,
    async mount() {
      host.active = false;
      calls.mount++;
      host.preview = { pause: async () => { calls.pause++; } };
      hostOptions.onMount(host.preview);
      await effects.mount?.();
      host.active = true;
    },
    async load(input) {
      calls.load.push(input);
      return effects.load ? effects.load(input) : loaded(input.difficulty ?? 5);
    },
    async selectDifficulty(id) {
      calls.select.push(id);
      return effects.select ? effects.select(id) : loaded(id);
    },
    destroy() { calls.destroy++; host.active = false; },
  };
  let hostOptions, getPreview;
  const app = startDevApp({
    document, window,
    createHost(options) { calls.createHost++; hostOptions = options; return host; },
    async upload(files, status) {
      calls.upload.push(files);
      assert.equal(status, hostOptions.status);
      return effects.upload ? effects.upload(files, status) : chart("first");
    },
    createLogPanel(getter) {
      getPreview = getter;
      return { attach(instance) { assert.equal(getter(), instance); calls.attach.push(instance); } };
    },
  });
  function change(id, value) {
    const element = elements.get(id);
    if (value !== undefined) element.value = value;
    const pending = element.emit("change");
    assert.ok(pending instanceof Promise, `${id} listener must return its promise`);
    return pending;
  }
  function upload(files = [{ name: "maidata.txt", webkitRelativePath: "first/maidata.txt" }]) {
    elements.get("files").files = files;
    elements.get("files").value = "selected-folder";
    return change("files");
  }
  const options = () => difficulty.children.map(option => ({ id: option.value, label: option.textContent }));
  return { app, host, calls, elements, controls, difficulty, window, change, upload, options, getPreview: () => getPreview() };
}

function assertReadyControls(f, hasChart) {
  for (const control of f.controls)
    assert.equal(control.disabled, control === f.difficulty && !hasChart, control.id);
}

test("startup disables controls until mount finishes and leaves difficulty disabled without a chart", async () => {
  const gate = deferred();
  const f = fixture({ mount: () => gate.promise });
  assert.ok(f.controls.every(control => control.disabled));
  assert.equal(f.calls.mount, 1);
  gate.resolve();
  await f.app.ready;
  assertReadyControls(f, false);
  assert.deepEqual(f.options(), [{ id: "", label: "请先上传谱面" }]);
  assert.equal(f.difficulty.value, "");
  assert.equal(f.getPreview(), f.host.preview);
  assert.deepEqual(f.calls.attach, [f.host.preview]);
  assert.equal(f.window.listeners.get("pagehide")[0].options.once, true);
  f.window.emit("pagehide");
  assert.equal(f.calls.destroy, 1);
});

test("upload lists only LoadedInfo chart ids and labels and selects its difficultyId", async () => {
  const input = chart("first");
  const f = fixture({ upload: () => input });
  await f.app.ready;
  const files = [{ name: "maidata.txt", webkitRelativePath: "first/maidata.txt" }, { name: "track.ogg" }];
  await f.upload(files);
  assert.deepEqual(f.options(), charts.map(({ id, label }) => ({ id: String(id), label })));
  assert.equal(f.difficulty.value, "5");
  assertReadyControls(f, true);
  assert.deepEqual(f.calls.upload, [files]);
  assert.deepEqual(f.calls.load, [input]);
  assert.equal(f.calls.load[0], input);
  assert.equal(f.calls.mount, 1);
  assert.equal(f.calls.pause, 1);
  assert.equal(f.elements.get("files").value, "");
});

test("difficulty change awaits selectDifficulty without upload, reload, or configuration remount", async () => {
  const gate = deferred();
  const f = fixture({ select: () => gate.promise });
  await f.app.ready;
  await f.upload();
  const originalPreview = f.host.preview;
  const pending = f.change("difficulty", "2");
  assert.ok(f.controls.every(control => control.disabled));
  assert.deepEqual(f.calls.select, [2]);
  gate.resolve(loaded(2));
  await pending;
  assert.equal(f.difficulty.value, "2");
  assertReadyControls(f, true);
  assert.equal(f.host.preview, originalPreview);
  assert.equal(f.calls.createHost, 1);
  assert.equal(f.calls.mount, 1);
  assert.equal(f.calls.upload.length, 1);
  assert.equal(f.calls.load.length, 1);
  assert.equal(f.calls.attach.length, 1);
});

test("configuration changes rebuild the host and reload the chart with the selected difficulty", async () => {
  const input = { ...chart("first"), audio: { url: "http://localhost/first/track.ogg" } };
  const f = fixture({ upload: () => input });
  await f.app.ready;
  await f.upload();
  await f.change("difficulty", "7");
  const originalPreview = f.host.preview;
  await f.change("resolution", "1280x720");
  assert.notEqual(f.host.preview, originalPreview);
  assert.equal(f.calls.mount, 2);
  assert.equal(f.calls.upload.length, 1);
  assert.deepEqual(f.calls.select, [7]);
  assert.deepEqual(f.calls.load, [input, { ...input, difficulty: 7 }]);
  assert.equal(f.difficulty.value, "7");
  assertReadyControls(f, true);
  assert.equal(f.calls.attach.length, 2);
  await f.change("max-fps", "30");
  assert.equal(f.calls.mount, 3);
  assert.deepEqual(f.calls.load[2], { ...input, difficulty: 7 });
  assert.equal(f.calls.upload.length, 1);
});

test("a failed difficulty switch restores the previous choice and re-enables valid difficulties", async () => {
  const gate = deferred();
  const f = fixture({ select: () => gate.promise });
  await f.app.ready;
  await f.upload();
  const before = f.options();
  const pending = f.change("difficulty", "2");
  assert.equal(f.difficulty.disabled, true);
  gate.reject(new Error("Cannot switch difficulty"));
  await pending;
  assert.equal(f.elements.get("status").textContent, "Cannot switch difficulty");
  assert.equal(f.difficulty.value, "5");
  assert.deepEqual(f.options(), before);
  assertReadyControls(f, true);
  assert.equal(f.calls.mount, 1);
  // Rebuilding after the failure must also retain the actual loaded choice,
  // not the failed selector value.
  await f.change("resolution", "640x360");
  assert.equal(f.calls.load[1].difficulty, 5);
  assert.equal(f.difficulty.value, "5");
});

test("startup and chart-load failures leave difficulty disabled when no chart is available", async () => {
  const startup = fixture({ mount: () => { throw new Error("Mount failed"); } });
  await startup.app.ready;
  assert.equal(startup.elements.get("status").textContent, "Mount failed");
  assertReadyControls(startup, false);
  const f = fixture({ load: () => { throw new Error("Chart failed"); } });
  await f.app.ready;
  await f.upload();
  assert.equal(f.elements.get("status").textContent, "Chart failed");
  assertReadyControls(f, false);
  assert.equal(f.difficulty.value, "");
  assert.deepEqual(f.options(), [{ id: "", label: "请先上传谱面" }]);
  assert.equal(f.elements.get("files").value, "");
});

test("a new folder clears old difficulty options while loading and does not inherit the old selection", async () => {
  const entered = deferred(), gate = deferred();
  const nextCharts = [{ id: 3, label: "ADV 7" }, { id: 6, label: "Re:MAS 14" }];
  const first = chart("first"), second = chart("second");
  const f = fixture({
    upload: files => files[0].webkitRelativePath.startsWith("second/") ? second : first,
    load: input => {
      if (input === second) { entered.resolve(); return gate.promise; }
      return loaded(input.difficulty ?? 5);
    },
  });
  await f.app.ready;
  await f.upload();
  await f.change("difficulty", "7");
  const pending = f.upload([{ name: "maidata.txt", webkitRelativePath: "second/maidata.txt" }]);
  await entered.promise;
  assert.equal(f.difficulty.disabled, true);
  assert.equal(f.difficulty.value, "");
  assert.deepEqual(f.options(), [{ id: "", label: "请先上传谱面" }]);
  assert.equal(f.calls.load[1], second);
  assert.equal(Object.hasOwn(f.calls.load[1], "difficulty"), false);
  gate.resolve(loaded(6, nextCharts));
  await pending;
  assert.deepEqual(f.options(), nextCharts.map(({ id, label }) => ({ id: String(id), label })));
  assert.equal(f.difficulty.value, "6");
  assertReadyControls(f, true);
  assert.equal(f.calls.mount, 1);
  assert.equal(f.calls.upload.length, 2);
  assert.deepEqual(f.calls.select, [7]);
  await f.change("resolution", "1920x1080");
  assert.deepEqual(f.calls.load[2], { ...second, difficulty: 6 });
});

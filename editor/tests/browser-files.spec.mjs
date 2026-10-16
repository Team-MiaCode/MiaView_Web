import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserFiles } from "../services/browser-files.mjs";

test("directory traversal retains relative paths and matching handles", async () => {
  const file = (name, text) => ({ kind: "file", name, getFile: async () => new File([text], name) });
  const directory = (name, children) => ({ kind: "directory", name, async *values() { yield* children; } });
  const maidata = file("maidata.txt", "&inote_5=1,E"), music = file("track.wav", "wave");
  const root = directory("Collection", [directory("Song", [maidata, music])]);
  const service = new BrowserFiles({ pickDirectory: async () => root });
  const result = await service.openFolder();
  assert.deepEqual(result.files.map(file => file.webkitRelativePath), ["Collection/Song/maidata.txt", "Collection/Song/track.wav"]);
  assert.equal(result.handles.get("Collection/Song/maidata.txt"), maidata);
});
test("save commits by close; write failures abort the pending stream", async () => {
  const calls = [];
  const handle = { name: "maidata.txt", createWritable: async () => ({ write: async text => calls.push(text), close: async () => calls.push("close"), abort: async () => calls.push("abort") }) };
  const service = new BrowserFiles({ pickSaveFile: async () => handle });
  await service.write(await service.saveTarget(null, true), "&title=中文");
  assert.deepEqual(calls, ["&title=中文", "close"]);
  handle.createWritable = async () => ({ write: async () => { throw new Error("write failure"); }, abort: async () => calls.push("abort") });
  await assert.rejects(service.write({ fileHandle: handle }, "source"), /write failure/);
  assert.equal(calls.at(-1), "abort");
});
test("picker cancellation returns no target, fallback generates the requested file", async () => {
  const cancelled = new BrowserFiles({ pickSaveFile: async () => { throw new DOMException("cancel", "AbortError"); } });
  assert.equal(await cancelled.saveTarget(null, true), null);
  const outputs = [];
  const fallback = new BrowserFiles({ pickSaveFile: null, download: (text, name) => outputs.push({ text, name }) });
  await fallback.write(await fallback.saveTarget({ filePath: "Song/maidata.txt" }), "chart");
  assert.deepEqual(outputs, [{ text: "chart", name: "maidata.txt" }]);
});

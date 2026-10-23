import test from "node:test";
import assert from "node:assert/strict";
import { BrowserVideoFrames } from "../renderer/browser-video.mjs";

test("browser PV keeps three immutable timestamps and releases images, waits and callbacks", async t => {
  const callbacks = new Map(), images = [], previous = globalThis.VideoFrame;
  let presenting = false, decoded = false;
  globalThis.VideoFrame = class {
    constructor(video) {
      if (!presenting && !decoded) throw new DOMException("Decoded image pending", "InvalidStateError");
      this.index = video.currentFrame; this.timestamp = video.timestampScale === 1 ? Math.trunc(video.currentTime) : video.currentTime * 1e6; images.push(this);
    }
    close() { assert.ok(!this.closed); this.closed = true; }
  };
  t.after(() => { if (previous) globalThis.VideoFrame = previous; else delete globalThis.VideoFrame; });
  const video = new EventTarget(), document = new EventTarget(); document.hidden = false;
  let frameVisible = true;
  document.defaultView = { frameElement: { checkVisibility: () => frameVisible } };
  Object.assign(video, { ownerDocument: document, readyState: 2, currentTime: 0, currentFrame: 0, seeking: false,
    requestVideoFrameCallback(callback) { const id = ++this.serial; callbacks.set(id, callback); return id; },
    cancelVideoFrameCallback(id) { callbacks.delete(id); }, serial: 0 });
  const present = (index, timestamp) => {
    video.currentFrame = index; video.currentTime = timestamp;
    const [id, callback] = callbacks.entries().next().value; callbacks.delete(id);
    presenting = true;
    try { callback(0, { mediaTime: timestamp }); }
    finally { presenting = false; }
  };
  let changes = 0; const errors = [];
  const frames = new BrowserVideoFrames(video, () => ++changes, error => errors.push(error));
  const initial = frames.ready(new AbortController().signal);
  assert.equal(frames.frames.length, 0);
  present(0, 0); await initial;
  present(1, 1 / 60); present(3, 3 / 60);
  assert.equal(frames.at(1.5 / 60).image.index, 1); assert.equal(frames.at(1.5 / 60).timestamp, 1 / 60);
  assert.equal(frames.at(2.75 / 60).image.index, 3);
  assert.equal(frames.at(2.6 / 60, .25).image.index, 1);
  assert.equal(frames.at(2.8 / 60, .25).image.index, 3);
  assert.equal(frames.at(3 / 60).image.index, 3); assert.equal(frames.at(3 / 60).timestamp, 3 / 60);
  present(4, 4 / 60); assert.equal(frames.frames.length, 3); assert.equal(images[0].closed, true);
  video.seeking = true; video.dispatchEvent(new Event("seeking"));
  const ready = frames.ready(new AbortController().signal);
  assert.equal(frames.at(2), null);
  video.seeking = false; video.currentFrame = 120; video.currentTime = 2; video.dispatchEvent(new Event("seeked"));
  assert.equal(frames.at(2), null); assert.deepEqual(errors, []); present(120, 2); await ready;
  assert.equal(frames.at(2).image.index, 120); assert.equal(frames.waiters.size, 0);
  video.seeking = true; frames.beginSeek();
  const earlyFrame = frames.ready(new AbortController().signal);
  present(60, 1); assert.equal(frames.at(1), null); assert.equal(frames.pendingSeek, true);
  video.seeking = false; video.dispatchEvent(new Event("seeked")); await earlyFrame;
  assert.equal(frames.at(1).image.index, 60); assert.equal(frames.waiters.size, 0);
  frames.beginSeek();
  const hidden = frames.ready(new AbortController().signal);
  document.hidden = true; document.dispatchEvent(new Event("visibilitychange")); await hidden;
  assert.equal(frames.waiters.size, 0); assert.equal(frames.at(2), null);
  await frames.ready(new AbortController().signal);
  document.hidden = false; present(120, 2); assert.equal(frames.at(2).image.index, 120);
  frames.beginSeek(); frameVisible = false;
  await frames.ready(new AbortController().signal);
  assert.equal(frames.waiters.size, 0);
  frameVisible = true; present(120, 2);
  frames.beginSeek();
  const sameFrame = frames.ready(new AbortController().signal);
  video.currentTime = 2.02; decoded = true;
  video.dispatchEvent(new Event("seeked"));
  await sameFrame;
  assert.equal(frames.at(2.02).timestamp, 2.02); assert.equal(frames.at(2.02).image.index, 120); assert.equal(frames.pendingSeek, false);
  video.timestampScale = 1; video.currentTime = 2.5; frames.beginSeek();
  const secondBased = frames.ready(new AbortController().signal);
  video.dispatchEvent(new Event("seeked")); await secondBased;
  assert.equal(frames.at(2.5).timestamp, 2.5);
  decoded = false;
  video.seeking = true; video.dispatchEvent(new Event("seeking"));
  const controller = new AbortController(), aborted = assert.rejects(frames.ready(controller.signal), /cancelled/);
  controller.abort(new Error("cancelled")); await aborted; assert.equal(frames.waiters.size, 0);
  const failed = assert.rejects(frames.ready(new AbortController().signal), /PV/);
  video.dispatchEvent(new Event("error")); await failed;
  assert.equal(errors.length, 1); assert.equal(frames.waiters.size, 0);
  frames.close(); assert.equal(callbacks.size, 0); assert.equal(frames.frames.length, 0);
  assert.ok(images.every(image => image.closed));
  const before = changes; video.dispatchEvent(new Event("seeking")); video.dispatchEvent(new Event("seeked"));
  assert.equal(changes, before);
  await assert.rejects(frames.ready(new AbortController().signal), /关闭/);
});

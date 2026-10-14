import test from "node:test";
import assert from "node:assert/strict";
import { previewPvTimeout, pvTimeoutFromSearch } from "../renderer/pv-timeout.mjs";
import { PreviewMediaCache } from "../renderer/runtime.mjs";

test("PV deadline accepts 10 seconds up to unlimited and strictly validates URL input", () => {
  assert.equal(previewPvTimeout(), 30000);
  assert.equal(pvTimeoutFromSearch(""), 30000);
  for (const value of [10000, 10001, 60000, 2147483648, Number.MAX_SAFE_INTEGER, "unlimited"]) {
    assert.equal(previewPvTimeout(value), value);
    assert.equal(pvTimeoutFromSearch(`?pvTimeoutMs=${value}`), value);
  }
  for (const value of [null, 9999, -1, Infinity, NaN, 10000.5, "10000", {}, "infinite"])
    assert.throws(() => previewPvTimeout(value));
  for (const value of ["", "010000", "1e4", "Infinity", "10000&pvTimeoutMs=20000"])
    assert.throws(() => pvTimeoutFromSearch(`?pvTimeoutMs=${value}`));
});

test("custom 10-second budget covers PV acquisition and preparation together", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cache = new PreviewMediaCache({ videoTimeoutMs: 10000 });
  let prepared, finishRead, markPreparationStarted;
  const preparationStarted = new Promise((resolve) => { markPreparationStarted = resolve; });
  const parent = new AbortController();
  const pending = cache.loadVideo({ url: "https://example.test/pv.mp4" }, parent.signal,
    () => new Promise((resolve) => { finishRead = resolve; }),
    (_blob, signal) => { prepared = signal; markPreparationStarted(); return new Promise(() => {}); });
  await Promise.resolve();
  t.mock.timers.tick(7000);
  finishRead(new Blob(["pv"]));
  await preparationStarted;
  t.mock.timers.tick(2999);
  assert.equal(prepared.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(await pending, null);
  assert.equal(parent.signal.aborted, false);
  assert.equal(prepared.aborted, true);
});

test("unlimited PV survives long waits while destruction can still abort it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cache = new PreviewMediaCache({ videoTimeoutMs: "unlimited" });
  const parent = new AbortController();
  let signal, finish;
  const pending = cache.loadVideo({ url: "https://example.test/pv.mp4" }, parent.signal,
    (s) => { signal = s; return new Promise((resolve) => { finish = resolve; }); });
  await Promise.resolve();
  t.mock.timers.tick(2147483647);
  assert.equal(signal.aborted, false);
  finish(new Blob(["complete"]));
  assert.equal(await (await pending).text(), "complete");
  const waiting = cache.loadVideo({ url: "https://example.test/other.mp4" }, parent.signal,
    () => new Promise(() => {}));
  parent.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.equal(cache.skippedVideoUrls.size, 0);
});

test("finite PV deadlines beyond browser timer limit do not overflow", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cache = new PreviewMediaCache({ videoTimeoutMs: 2147483647 + 10000 });
  let signal;
  const pending = cache.loadVideo({ url: "https://example.test/large.mp4" }, null,
    (s) => { signal = s; return new Promise(() => {}); });
  await Promise.resolve();
  t.mock.timers.tick(2147483647);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(9999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(await pending, null);
});

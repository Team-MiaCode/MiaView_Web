import test from "node:test";
import assert from "node:assert/strict";
import { nextAnimationFrame } from "../renderer/animation-frame.mjs";

function frameScheduler(t, request, cancel) {
  const previous = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = request; globalThis.cancelAnimationFrame = cancel;
  t.after(() => {
    for (const [index, key] of ["requestAnimationFrame", "cancelAnimationFrame"].entries()) {
      if (previous[index] === undefined) delete globalThis[key]; else globalThis[key] = previous[index];
    }
  });
}

test("Warm-up cancellation releases a queued frame even when the renderer is hidden", async t => {
  const pending = new Map(); let sequence = 0;
  frameScheduler(t, callback => {
    pending.set(++sequence, callback); return sequence;
  }, id => pending.delete(id));
  const lifetime = new AbortController(), frame = nextAnimationFrame(lifetime.signal);
  assert.equal(pending.size, 1);
  lifetime.abort();
  await assert.rejects(frame, { name: "AbortError" });
  assert.equal(pending.size, 0);
  assert.throws(() => nextAnimationFrame(lifetime.signal), { name: "AbortError" });
});

test("A presented warm-up frame removes its cancellation subscription", async t => {
  let callback, cancelled = 0;
  frameScheduler(t, action => { callback = action; return 7; }, () => { ++cancelled; });
  const lifetime = new AbortController(), frame = nextAnimationFrame(lifetime.signal);
  callback(120); assert.equal(await frame, 120);
  lifetime.abort(); assert.equal(cancelled, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { PreviewDiagnostics } from "../renderer/diagnostics.mjs";

test("diagnostics computes real presentation rate, percentiles and playback gaps without paused time", () => {
  let now = 0,
    presentedFrames = 0;
  const reports = [];
  const diagnostics = new PreviewDiagnostics({
    clock: () => now,
    context: () => ({ presentedFrames }),
    publish: (r) => reports.push(r),
  });
  diagnostics.setEnabled(true);
  try {
    for (let n = 1; n <= 100; n++) diagnostics.record("work", n);
    diagnostics.hostFrame(0, true);
    diagnostics.hostFrame(16, true);
    diagnostics.hostFrame(80, true);
    diagnostics.hostFrame(100, false);
    diagnostics.hostFrame(900, true);
    now = 1000;
    presentedFrames = 30;
    const report = diagnostics.flush();
    assert.equal(report.presentedFps, 30);
    assert.deepEqual(report.metrics.work, {
      count: 100,
      meanMs: 50.5,
      p95Ms: 95,
      maxMs: 100,
      sampledCount: 100,
    });
    assert.equal(report.metrics.hostInterval.count, 2);
    assert.equal(report.counters.hostGapsOver50ms, 1);
    assert.equal(reports.length, 1);
    now = 3000;
    presentedFrames = 60;
    assert.equal(diagnostics.flush().presentedFps, 15);
    assert.equal(diagnostics.snapshot().reports.length, 2);
  } finally {
    diagnostics.dispose();
  }
});

test("diagnostics bounds samples/history, records thrown calls, resets and stops disabled sampling", () => {
  let now = 0;
  const diagnostics = new PreviewDiagnostics({
    clock: () => now,
    historyLimit: 2,
  });
  diagnostics.setEnabled(true);
  try {
    for (let i = 0; i < 5000; i++) diagnostics.record("work", i);
    assert.throws(
      () =>
        diagnostics.measure("error", () => {
          now += 5;
          throw new Error("failed");
        }),
      /failed/,
    );
    now = 1000;
    const report = diagnostics.flush();
    assert.equal(report.metrics.work.count, 5000);
    assert.equal(report.metrics.work.sampledCount, 4096);
    assert.equal(report.metrics.work.meanMs, 2499.5);
    assert.equal(report.metrics.error.maxMs, 5);
    now = 2000;
    diagnostics.flush();
    now = 3000;
    diagnostics.flush();
    assert.equal(diagnostics.snapshot().reports.length, 2);
    diagnostics.reset();
    assert.equal(diagnostics.snapshot().reports.length, 0);
    now = 4000;
    assert.equal(diagnostics.flush().sequence, 1);
    diagnostics.setEnabled(false);
    diagnostics.record("work", 100);
    assert.equal(diagnostics.flush(), null);
    assert.equal(diagnostics.metrics.size, 0);
  } finally {
    diagnostics.dispose();
  }
});

test("long tasks crossing a report boundary are retained but entries before reset are dropped", () => {
  let now = 0;
  const diagnostics = new PreviewDiagnostics({ clock: () => now });
  diagnostics.setEnabled(true);
  try {
    now = 1000;
    diagnostics.flush();
    diagnostics.longTasks([{ startTime: 950, duration: 100 }]);
    now = 2000;
    assert.equal(diagnostics.flush().metrics.longTask.count, 1);
    diagnostics.reset();
    diagnostics.longTasks([{ startTime: 1950, duration: 100 }]);
    now = 3000;
    assert.equal(diagnostics.flush().metrics.longTask, undefined);
  } finally {
    diagnostics.dispose();
  }
});

test("failure reports retain the phase, omit resource credentials, and do not repeat errors", () => {
  let now = 0;
  const diagnostics = new PreviewDiagnostics({ clock: () => now });
  diagnostics.setEnabled(true);
  try {
    diagnostics.error(
      "engine-init",
      new Error("Failed to fetch https://example.com/asset?token=secret"),
    );
    now = 100;
    assert.deepEqual(diagnostics.flush().errors, [
      { stage: "engine-init", message: "Failed to fetch [resource URL]" },
    ]);
    now = 200;
    assert.deepEqual(diagnostics.flush().errors, []);
  } finally {
    diagnostics.dispose();
  }
});

test("initialization-only logging has no timer, ignores playback work and emits no empty reports", () => {
  let now = 0;
  const reports = [];
  const diagnostics = new PreviewDiagnostics({
    initializationOnly: true,
    clock: () => now,
    publish: (report) => reports.push(report),
  });
  diagnostics.setEnabled(true);
  try {
    assert.equal(diagnostics.timer, undefined);
    assert.equal(diagnostics.observer, null);
    diagnostics.measure("hostWork", () => {
      now += 5;
    });
    diagnostics.hostFrame(0, true);
    diagnostics.hostFrame(100, true);
    diagnostics.count("audioLateEvents");
    assert.equal(diagnostics.flush(), null);
    diagnostics.record("engineInit", 123);
    const report = diagnostics.flush();
    assert.equal(report.logKind, "initialization");
    assert.equal(report.metrics.engineInit.meanMs, 123);
    assert.deepEqual(report.counters, {});
    now += 10000;
    assert.equal(diagnostics.flush(), null);
    assert.equal(reports.length, 1);
    diagnostics.count("videoLoadTimeouts");
    assert.equal(diagnostics.flush().counters.videoLoadTimeouts, 1);
  } finally {
    diagnostics.dispose();
  }
});

test("initialization resource timeline tracks overlapping work, failures and byte sizes without periodic reports", async () => {
  let now = 100;
  const diagnostics = new PreviewDiagnostics({
    clock: () => now,
    initializationOnly: true,
  });
  diagnostics.setEnabled(true);
  let finish;
  const slow = diagnostics.measureLoadingStep(
    "sfxRead",
    "tap.wav",
    2,
    100,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  now = 200;
  await diagnostics.measureLoadingStep(
    "videoAssetRead",
    "",
    2,
    100,
    async () => {
      now = 400;
      return new Blob([new Uint8Array(16)]);
    },
  );
  now = 900;
  finish(new ArrayBuffer(32));
  await slow;
  now = 1000;
  await assert.rejects(
    diagnostics.measureLoadingStep("sfxDecode", "tap.wav", 2, 100, async () => {
      now = 1100;
      throw new DOMException("cancelled", "AbortError");
    }),
    { name: "AbortError" },
  );
  const report = diagnostics.flush();
  assert.equal(report.loadingSteps.length, 3);
  assert.deepEqual(report.loadingSteps[0], {
    kind: "videoAssetRead",
    resource: "",
    loadId: 2,
    startMs: 100,
    durationMs: 200,
    endMs: 300,
    status: "ok",
    byteSize: 16,
  });
  assert.equal(report.loadingSteps[1].durationMs, 800);
  assert.equal(report.loadingSteps[1].byteSize, 32);
  assert.equal(report.loadingSteps[2].status, "cancelled");
  assert.equal(diagnostics.timer, undefined);
  assert.equal(diagnostics.flush(), null);
  diagnostics.setEnabled(false);
  await diagnostics.measureLoadingStep(
    "sfxRead",
    "ignored.wav",
    3,
    now,
    async () => 1,
  );
  assert.equal(diagnostics.loadingSteps.length, 0);
  diagnostics.dispose();
});

test("playback-only reports reject unloaded/paused context and restart sampling without paused time", () => {
  let now = 0, loaded = false, playing = false, presentedFrames = 0;
  const reports = [];
  const diagnostics = new PreviewDiagnostics({
    clock: () => now,
    context: () => ({ loaded, playing, presentedFrames }),
    playbackOnly: true,
    publish: (report) => reports.push(report),
  });
  try {
    diagnostics.setEnabled(true);
    diagnostics.record("hostWork", 3);
    now = 1000;
    assert.equal(diagnostics.flush(), null);
    loaded = true;
    assert.equal(diagnostics.flush(), null);
    diagnostics.setEnabled(false);
    assert.equal(diagnostics.timer, undefined);
    playing = true;
    diagnostics.setEnabled(true);
    diagnostics.hostFrame(now, true);
    now = 2000;
    presentedFrames = 60;
    diagnostics.record("hostWork", 4);
    const report = diagnostics.flush();
    assert.equal(report.logKind, "performance");
    assert.equal(report.presentedFps, 60);
    assert.equal(report.metrics.hostWork.count, 1);
    diagnostics.record("hostWork", 99);
    diagnostics.setEnabled(false);
    playing = false;
    now = 10000;
    assert.equal(diagnostics.flush(), null);
    assert.equal(reports.length, 1, "Pausing discards the partial playback window");
    playing = true;
    diagnostics.setEnabled(true);
    now = 11000;
    presentedFrames = 90;
    diagnostics.record("hostWork", 2);
    assert.equal(diagnostics.flush().presentedFps, 30);
    assert.equal(reports[1].metrics.hostWork.maxMs, 2);
    loaded = false;
    now = 12000;
    assert.equal(diagnostics.flush(), null);
  } finally {
    diagnostics.dispose();
  }
});

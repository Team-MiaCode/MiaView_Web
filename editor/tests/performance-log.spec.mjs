import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatPerformanceReport } from "../scripts/performance-log.mjs";
import { staticServer } from "../scripts/serve.mjs";
import { listenForBrowser } from "./helpers/browser-server.mjs";

test("dev backend saves parseable JSONL and rejects cross-origin, malformed and oversized reports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "miaview-log-test-"));
  const printed = [];
  const server = staticServer(directory, {
    performanceLogDir: join(directory, ".logs"),
    performanceOutput: (text) => printed.push(text),
  });
  await listenForBrowser(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const body = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    report: { schemaVersion: 1, sequence: 1, durationMs: 1000, metrics: {} },
  };
  const send = (value, requestOrigin = origin) =>
    fetch(origin + "/__performance", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin, Connection: "close" },
      body: typeof value === "string" ? value : JSON.stringify(value),
    });
  try {
    const firstResponse = await send(body);
    assert.equal(firstResponse.status, 200);
    const result = await firstResponse.json();
    assert.equal(result.terminalEnabled, true);
    assert.equal(result.fileEnabled, true);
    assert.equal(result.text, printed[0]);
    assert.equal(
      (await send({ ...body, report: { ...body.report, sequence: 2 } })).status,
      200,
    );
    assert.equal((await send(body, "https://foreign.example")).status, 403);
    assert.equal((await send("{")).status, 400);
    assert.equal((await send({})).status, 400);
    assert.equal((await send("x".repeat(65537))).status, 413);
    const files = await readdir(join(directory, ".logs"));
    assert.equal(files.length, 1);
    const lines = (await readFile(join(directory, ".logs", files[0]), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].text, printed[0]);
    assert.equal(lines[1].text, printed[1]);
    assert.equal(lines[0].sessionId, body.sessionId);
    assert.equal(lines[1].report.sequence, 2);
    assert.ok(lines[0].receivedAt);
    assert.equal((await fetch(origin + "/.logs/" + files[0],{headers:{Connection:"close"}})).status, 404);
    assert.equal((await fetch(origin + "/%2f.logs/" + files[0],{headers:{Connection:"close"}})).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("backend defaults to terminal output with no file creation, and terminal can be disabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "miaview-terminal-test-"));
  const printed = [];
  const server = staticServer(directory, {
    performanceOutput: (text) => printed.push(text),
  });
  const silent = staticServer(directory, {
    performanceTerminal: false,
    performanceOutput: (text) => printed.push(text),
  });
  await Promise.all([server, silent].map(listenForBrowser));
  try {
    for (const [index, host] of [server, silent].entries()) {
      const origin = `http://127.0.0.1:${host.address().port}`;
      const response = await fetch(origin + "/miacode/__performance", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, Connection: "close" },
        body: JSON.stringify({
          sessionId: "00000000-0000-4000-8000-000000000001",
          report: {
            schemaVersion: 1,
            sequence: 1,
            durationMs: 1000,
            metrics: {},
          },
        }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.terminalEnabled, index === 0);
      assert.equal(result.fileEnabled, false);
    }
    assert.equal(printed.length, 1);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await Promise.all(
      [server, silent].map(
        (host) => new Promise((resolve) => host.close(resolve)),
      ),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("terminal log distinguishes pending Qt startup from a failed resource request", () => {
  const text = formatPerformanceReport(
    "session",
    {
      sequence: 1,
      ready: false,
      phase: "error",
      metrics: {},
      errors: [{ stage: "engine-init", message: "Failed to fetch" }],
    },
    "now",
  );
  assert.match(text, /播放器尚未就绪/);
  assert.match(text, /错误（Qt 初始化）: Failed to fetch/);
});

test("initialization logs print loading durations without periodic playback statistics", () => {
  const text = formatPerformanceReport(
    "session",
    {
      sequence: 1,
      logKind: "initialization",
      ready: true,
      phase: "ready",
      metrics: { engineInit: { count: 1, meanMs: 123 } },
    },
    "now",
  );
  assert.match(text, /\[MiaView initialization\]/);
  assert.match(text, /Qt 引擎初始化: 123.00ms/);
  assert.doesNotMatch(text, /FPS|长帧|视频上传|窗口/);
});

test("initialization text distinguishes full PV acquisition from first frame and identifies late sound downloads", () => {
  const text = formatPerformanceReport(
    "session",
    {
      sequence: 1,
      logKind: "initialization",
      metrics: {},
      loadingSteps: [
        {
          kind: "sfxRead",
          resource: "tap.wav",
          loadId: 1,
          startMs: 500,
          durationMs: 31000,
          endMs: 31500,
          status: "ok",
          byteSize: 1048576,
        },
        {
          kind: "videoAssetRead",
          resource: "",
          loadId: 1,
          startMs: 0,
          durationMs: 400,
          endMs: 400,
          status: "ok",
        },
        {
          kind: "videoReady",
          resource: "",
          loadId: 1,
          startMs: 400,
          durationMs: 500,
          endMs: 900,
          status: "ok",
        },
      ],
    },
    "now",
  );
  assert.match(text, /PV 完整数据取得/);
  assert.match(text, /PV 首帧准备/);
  assert.match(text, /音效下载 tap.wav: 开始 \+500.00ms \| 耗时 31000.00ms/);
  assert.match(text, /本批日志最晚结束的资源步骤：音效下载 tap.wav/);
  assert.match(text, /1.00 MiB/);
  assert.ok(text.indexOf("PV 完整数据取得") < text.indexOf("PV 首帧准备"));
  assert.doesNotMatch(text, /FPS/);
});

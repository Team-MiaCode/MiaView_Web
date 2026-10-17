import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PreviewMediaCache, loadPreviewRuntime } from "../renderer/runtime.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("chart parsing remains parallel but every URL PV must finish downloading before preparation", async () => {
  const audio = deferred();
  const video = deferred();
  const reads = [];
  let decodes = 0;
  const resources = {
    maidata: { text: "&title=test" },
    audio: { url: "https://example.com/song" },
    video: { url: "https://example.com/video.webm" },
  };
  const context = {
    decodeAudioData: async () => {
      decodes++;
      return { duration: 12 };
    },
  };
  const read = (source) => {
    reads.push(source);
    return source === resources.audio
      ? audio.promise
      : source === resources.video
        ? video.promise
        : Promise.resolve(new TextEncoder().encode(source.text));
  };
  const cache = new PreviewMediaCache();
  const entry = cache.load(
    resources,
    context,
    read,
    new AbortController().signal,
  );
  assert.equal(await entry.text, "&title=test");
  assert.equal(entry.mediaReady, undefined);
  assert.equal(entry.complete, false);
  assert.deepEqual(reads, [
    resources.maidata,
    resources.audio,
    resources.video,
  ]);
  video.resolve(new TextEncoder().encode("complete PV"));
  assert.equal(await (await entry.video).text(), "complete PV");
  audio.resolve(new ArrayBuffer(8));
  await entry.media;
  assert.equal(
    cache.load(resources, context, read, new AbortController().signal),
    entry,
  );
  assert.equal(decodes, 1);
});

test("local PV retains its Blob and integrity-bearing PV must finish verification first", async () => {
  const bytes = deferred();
  const local = new Blob(["video"], { type: "video/webm" });
  const context = {};
  const cache = new PreviewMediaCache();
  const read = (source) =>
    source.text
      ? Promise.resolve(new TextEncoder().encode(source.text))
      : bytes.promise;
  const signal = new AbortController().signal;
  const first = cache.load(
    { maidata: { text: "chart" }, video: local },
    context,
    read,
    signal,
  );
  assert.equal(await first.video, local);
  await first.media;
  const second = cache.load(
    {
      maidata: { text: "chart" },
      video: {
        url: "https://example.com/video",
        sha256: "a".repeat(64),
        byteSize: 5,
        contentType: "video/webm",
      },
    },
    context,
    read,
    signal,
  );
  await second.text;
  assert.equal(second.mediaReady, undefined);
  bytes.resolve(new TextEncoder().encode("video"));
  const verified = await second.video;
  assert.equal(await verified.text(), "video");
  assert.equal(verified.type, "video/webm");
  await second.media;
});

test("PV times out at 30 seconds, aborts only its request, and never retries that source", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const video = deferred();
  const signal = new AbortController().signal;
  let videoSignal,
    reads = 0,
    timeouts = 0,
    prepared = 0;
  const cache = new PreviewMediaCache({ onVideoTimeout: () => timeouts++ });
  const resource = { url: "https://example.com/slow.mp4" };
  const pending = cache.loadVideo(
    resource,
    signal,
    (s) => {
      videoSignal = s;
      reads++;
      return video.promise;
    },
    () => {
      prepared++;
    },
  );
  await Promise.resolve();
  t.mock.timers.tick(29999);
  assert.equal(videoSignal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(await pending, null);
  assert.equal(videoSignal.aborted, true);
  assert.equal(signal.aborted, false);
  assert.equal(timeouts, 1);
  assert.equal(
    await cache.loadVideo(
      { ...resource },
      signal,
      () => {
        reads++;
      },
      () => {
        prepared++;
      },
    ),
    null,
  );
  video.resolve(new Blob(["too late"]));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(prepared, 0, "Late completion must not attach the timed-out PV");
});

test("PV preparation shares the same deadline and parent cancellation is not a timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cache = new PreviewMediaCache();
  const controller = new AbortController();
  let preparingSignal;
  const resource = { url: "https://example.com/decoding.mp4" };
  const preparationStarted = deferred();
  const pending = cache.loadVideo(
    resource,
    controller.signal,
    async () => new Blob(["video"]),
    (_, signal) => {
      preparingSignal = signal;
      preparationStarted.resolve();
      return new Promise(() => {});
    },
  );
  await preparationStarted.promise;
  t.mock.timers.tick(30000);
  assert.equal(await pending, null);
  assert.equal(preparingSignal.aborted, true);
  const other = new AbortController();
  const loading = cache.loadVideo(
    { url: "https://example.com/other.mp4" },
    other.signal,
    () => new Promise(() => {}),
  );
  other.abort();
  await assert.rejects(loading, { name: "AbortError" });
  assert.equal(cache.skippedVideoUrls.size, 1);
});

test("resource errors identify the failing asset while preserving cancellation", async () => {
  for (const kind of ["maidata", "audio", "cover", "video"]) {
    const resources = {
      maidata: new Blob(["chart"]),
      [kind]: { url: "https://example.com/missing" },
    };
    const entry = new PreviewMediaCache().load(
      resources,
      {},
      async (resource) => {
        if (resource === resources[kind])
          throw new TypeError("Failed to fetch");
        return resource.arrayBuffer();
      },
      new AbortController().signal,
    );
    const expected = {
      maidata: "谱面",
      audio: "音乐",
      cover: "封面",
      video: "PV",
    }[kind];
    await assert.rejects(
      kind === "maidata" ? entry.text : entry.media,
      new RegExp(`${expected}读取失败：网络请求失败`),
    );
  }
  const controller = new AbortController();
  const entry = new PreviewMediaCache().load(
    { maidata: new Blob(["chart"]) },
    {},
    async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    },
    controller.signal,
  );
  await assert.rejects(entry.text, { name: "AbortError" });
});

function runtimeFixture({ wrongBytes = false } = {}) {
  const identity = Buffer.from(
    JSON.stringify({
      upstream: "MiaCodeWebGL",
      protocolVersion: 1,
      version: "test",
    }),
  );
  const wasm = Buffer.from("test binary");
  const files = [
    {
      path: "build-identity.json",
      byteSize: identity.length,
      sha256: hash(identity),
    },
    { path: "miacode-preview.js", byteSize: 4, sha256: hash("glue") },
    { path: "miacode-preview.wasm", byteSize: wasm.length, sha256: hash(wasm) },
  ];
  const tail = deferred(),
    compiling = deferred();
  let executed = false,
    persisted = false;
  const document = {
    defaultView: { miacode_preview_entry() {} },
    createElement: () => ({ remove() {} }),
    head: {
      append(element) {
        if (element.src) {
          executed = true;
          queueMicrotask(() => element.onload());
        }
      },
    },
  };
  const fetcher = async (url, options) => {
    if (url.pathname.endsWith("build-identity.json"))
      return new Response(identity);
    if (url.pathname.endsWith("artifact-manifest.json"))
      return Response.json({ files });
    assert.equal(options.credentials, "omit");
    const body = wrongBytes ? Buffer.from("wrong bytes") : wasm;
    return new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(body.subarray(0, 4));
          await tail.promise;
          controller.enqueue(body.subarray(4));
          controller.close();
        },
      }),
      { headers: { "content-type": "application/wasm" } },
    );
  };
  const compiler = {
    async compileStreaming(response) {
      const reader = response.body.getReader();
      await reader.read();
      compiling.resolve();
      while (!(await reader.read()).done) {}
      return { compiled: true };
    },
  };
  const cache = {
    read: async () => null,
    write: () => {
      persisted = true;
      return new Promise(() => {});
    },
  };
  return {
    document,
    fetcher,
    compiler,
    cache,
    tail,
    compiling,
    executed: () => executed,
    persisted: () => persisted,
  };
}

test("WASM compiles during download and startup does not wait for disk writes", async () => {
  const f = runtimeFixture();
  const loading = loadPreviewRuntime(
    "https://example.com/renderer/index.html",
    f.fetcher,
    f.document,
    f.compiler,
    f.cache,
  );
  await f.compiling.promise;
  assert.equal(f.executed(), false);
  f.tail.resolve();
  const result = await loading;
  assert.deepEqual(result.wasmModule, { compiled: true });
  assert.equal(f.executed(), true);
  assert.equal(f.persisted(), true);
});

test("WASM hash mismatch blocks glue execution even when compilation succeeds", async () => {
  const f = runtimeFixture({ wrongBytes: true });
  const loading = loadPreviewRuntime(
    "https://example.com/renderer/index.html",
    f.fetcher,
    f.document,
    f.compiler,
    f.cache,
  );
  await f.compiling.promise;
  f.tail.resolve();
  await assert.rejects(loading, /加载或校验失败/);
  assert.equal(f.executed(), false);
  assert.equal(f.persisted(), false);
});

test("Disposal during WASM compilation prevents runtime script execution", async () => {
  const f = runtimeFixture(), controller = new AbortController();
  const loading = loadPreviewRuntime("https://example.com/renderer/index.html",
    f.fetcher, f.document, f.compiler, f.cache, controller.signal);
  await f.compiling.promise;
  controller.abort(); f.tail.resolve();
  await assert.rejects(loading, { name: "AbortError" });
  assert.equal(f.executed(), false);
});

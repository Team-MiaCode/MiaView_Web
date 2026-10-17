import assert from "node:assert/strict";
import test from "node:test";
import { createPreview } from "../sdk/index.mjs";
import { FRAME_SOURCE } from "../sdk/protocol.mjs";

function dom({ invalidIdentity = false, respond = true, reply = () => undefined } = {}) {
  const messages = [],
    listeners = new Set();
  const identity = {
    upstream: "MiaCodeWebGL",
    version: "sdk-test",
    sourceRevision: "a".repeat(64),
  };
  const window = {
    crypto: globalThis.crypto,
    location: { origin: "https://host.example" },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    fetch: async (_url, options) => {
      assert.equal(options.credentials, "omit");
      return Response.json(invalidIdentity ? {} : identity);
    },
  };
  const document = {
    defaultView: window,
    baseURI: "https://host.example/demo/",
  };
  document.createElement = (name) => {
    const element = {
      ownerDocument: document,
      style: {},
      children: [],
      setAttribute() {},
      appendChild(child) {
        this.children.push(child);
        child.parent = this;
      },
      remove() {
        this.parent.children = this.parent.children.filter(
          (child) => child !== this,
        );
      },
    };
    if (name === "iframe")
      element.contentWindow = {
        postMessage(message, origin) {
          messages.push({ ...message, origin });
          if (!respond && message.type !== "initialize") return;
          const data = {
            source: FRAME_SOURCE,
            protocolVersion: 1,
            sessionId: message.sessionId,
            requestId: message.requestId,
            type: "response",
            ok: true,
            value: reply(message) ?? { type: message.type },
            playerVersion: identity.version,
            sourceRevision: identity.sourceRevision,
          };
          queueMicrotask(() => {
            for (const listener of listeners)
              listener({ source: element.contentWindow, origin, data });
          });
        },
      };
    return element;
  };
  const container = document.createElement("div");
  const append = container.appendChild;
  container.appendChild = function (child) {
    append.call(this, child);
    queueMicrotask(() => child.children[0].onload?.());
  };
  return { container, messages, listeners, identity };
}
test("An analysis request preserves its snapshot while later commands continue", async () => {
  const f = dom({ respond: false });
  const preview = createPreview(f.container, { rendererUrl: "https://renderer.example/index.html" });
  await preview.ready;
  const analysis = preview.getAnalysis();
  await new Promise(resolve => setImmediate(resolve));
  const state = preview.getState();
  await new Promise(resolve => setImmediate(resolve));
  const requests = f.messages.filter(message => message.type !== "initialize");
  try {
    assert.deepEqual(requests.map(message => message.type), ["getAnalysis", "getState"]);
    const reply = (request, value) => {
      const data = { source: FRAME_SOURCE, protocolVersion: 1, sessionId: preview.sessionId,
        type: "response", requestId: request.requestId, ok: true, value,
        playerVersion: f.identity.version, sourceRevision: f.identity.sourceRevision };
      for (const listener of f.listeners) listener({ source: preview.iframe.contentWindow, origin: preview.origin, data });
    };
    reply(requests[1], { currentTime: 2 }); assert.deepEqual(await state, { currentTime: 2 });
    reply(requests[0], { revision: 3 }); assert.deepEqual(await analysis, { revision: 3 });
  } finally { preview.destroy(); }
});

test("cover playback observes a stalled renderer and releases the host timer on pause and destruction", async t => {
  const { container, messages, listeners, identity } = dom({ reply: message =>
    message.type === "getCoverComposition" ? { chartFramePlaying: true } : undefined });
  const preview = createPreview(container, { rendererUrl: "https://renderer.example/index.html" }); await preview.ready;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const pulse = playing => {
    const data = { source: FRAME_SOURCE, protocolVersion: 1, sessionId: preview.sessionId,
      type: "coverPlaybackChanged", payload: { chartFramePlaying: playing },
      playerVersion: identity.version, sourceRevision: identity.sourceRevision };
    for (const listener of listeners) listener({ source: preview.iframe.contentWindow, origin: preview.origin, data });
  };
  const observations = () => messages.filter(message => message.type === "getCoverComposition").length;
  try {
    pulse(true); t.mock.timers.tick(249); await settle(); assert.equal(observations(), 0);
    pulse(true); t.mock.timers.tick(249); await settle(); assert.equal(observations(), 0);
    t.mock.timers.tick(1); await settle(); assert.equal(observations(), 1);
    pulse(false); t.mock.timers.tick(1000); await settle(); assert.equal(observations(), 1);
    pulse(true); preview.destroy(); t.mock.timers.tick(1000); await settle(); assert.equal(observations(), 1);
  } finally { preview.destroy(); }
});
test("SDK mounts without touching host content, serializes commands and releases its iframe", async () => {
  const { container, messages, listeners } = dom();
  const unrelated = {};
  container.children.push(unrelated);
  const preview = createPreview(container, {
    rendererUrl: "https://renderer.example/engine/index.html",
    resolution: { width: 720, height: 720 },
    maxFps: 120,
    theme: "light",
  });
  await preview.ready;
  const iframe = container.children[1].children[0];
  const url = new URL(iframe.src);
  assert.equal(url.searchParams.get("hostOrigin"), "https://host.example");
  assert.equal(url.searchParams.get("width"), "720");
  assert.equal(url.searchParams.get("maxFps"), "120");
  assert.equal(url.searchParams.get("theme"), "light");
  assert.equal(url.searchParams.get("audioContextOwner"), "renderer");
  assert.equal(iframe.referrerPolicy, "no-referrer");
  await Promise.all([
    preview.load({ maidata: "&inote_5=1,E" }),
    preview.seek(1),
    preview.setSettings({ tapFlowSpeed: 8 }),
    preview.setResources({ audio: "./track.wav", video: null }),
  ]);
  assert.deepEqual(
    messages.map((message) => message.type),
    ["initialize", "load", "seek", "setSettings", "setResources"],
  );
  assert.deepEqual(messages.at(-1).payload, { audio: { url: "https://host.example/demo/track.wav" }, video: null });
  assert.ok(
    messages.every((message) => message.origin === "https://renderer.example"),
  );
  preview.destroy();
  preview.destroy();
  assert.deepEqual(container.children, [unrelated]);
  assert.equal(listeners.size, 0);
  await assert.rejects(preview.getState(), /destroyed/);
});
test("detached preview audio ownership is explicit and validated before mounting", async () => {
  const { container } = dom();
  const rendererUrl = "https://renderer.example/index.html";
  assert.throws(() => createPreview(container, { rendererUrl, audioContextOwner: "parent" }), /audio context owner/);
  assert.equal(container.children.length, 0);
  const preview = createPreview(container, { rendererUrl, audioContextOwner: "opener" });
  await preview.ready;
  assert.equal(new URL(preview.iframe.src).searchParams.get("audioContextOwner"), "opener");
  preview.destroy();
});
test("performance preferences use the same validated SDK command boundary", async () => {
  const { container, messages } = dom();
  const preview = createPreview(container, { rendererUrl: "https://renderer.example/index.html" });
  await preview.ready;
  const changes = { canvasFrameRateMode: 0, stageMediaFrameRateMode: 3, videoDecodePrefersSoftware: true };
  await preview.setPerformance(changes);
  assert.equal(messages.at(-1).type, "setPerformance"); assert.deepEqual(messages.at(-1).payload, changes);
  const count = messages.length;
  await assert.rejects(preview.setPerformance({ videoDecodePrefersSoftware: 1 }), /布尔/);
  await assert.rejects(preview.setPerformance({ canvasFrameRateMode: 4 }), /帧率/);
  assert.equal(messages.length, count); preview.destroy();
});
test("startup failure and early disposal do not leak a widget or message listeners", async () => {
  const fixture = dom({ invalidIdentity: true });
  const preview = createPreview(fixture.container, {
    rendererUrl: "https://renderer.example/index.html",
  });
  await assert.rejects(preview.ready, /identity/);
  assert.equal(fixture.container.children.length, 0);
  assert.equal(fixture.listeners.size, 0);
  const early = dom();
  const second = createPreview(early.container, {
    rendererUrl: "https://renderer.example/index.html",
  });
  second.destroy();
  await assert.rejects(second.ready, /destroyed/);
  assert.equal(early.listeners.size, 0);
});
test("command timeouts reject callers; invalid API arguments never reach the renderer", async () => {
  const { container, messages } = dom({ respond: false });
  const preview = createPreview(container, {
    rendererUrl: "https://renderer.example/index.html",
    timeoutMs: 30,
  });
  await preview.ready;
  await assert.rejects(preview.seek(-1), /Seek/);
  await assert.rejects(
    preview.setSettings({ showJudgeEffects: false }),
    /Unsupported/,
  );
  await assert.rejects(preview.load({}), /maidata/);
  assert.equal(messages.length, 1);
  await assert.rejects(preview.getState(), /timed out/);
  preview.destroy();
});
test("invalid resolutions are rejected before adding any iframe", () => {
  const { container } = dom();
  assert.throws(
    () => createPreview(container, { resolution: { width: 800, height: 600 } }),
    /分辨率/,
  );
  assert.equal(container.children.length, 0);
  assert.throws(() => createPreview(container, { theme: "invalid" }), /theme/);
  assert.equal(container.children.length, 0);
});

test("Font, metadata and intro resources resolve against the embedding page",async()=>{
  const {container,messages}=dom();const preview=createPreview(container,{rendererUrl:"https://renderer.example/index.html"});await preview.ready;
  await preview.importFont("./font.ttf","font.ttf");
  await preview.readAudioInfo("./track.wav");
  await preview.startExport({introBackground:"./image.png",fps:30});
  await preview.setIntroAudition({introBackground:"./intro.png",introAuditionLoop:true});
  assert.equal(messages.find(message=>message.type==="importFont").payload.font.url,"https://host.example/demo/font.ttf");
  assert.equal(messages.find(message=>message.type==="readAudioInfo").payload.audio.url,"https://host.example/demo/track.wav");
  assert.equal(messages.find(message=>message.type==="startExport").payload.introBackground.url,"https://host.example/demo/image.png");
  assert.equal(messages.find(message=>message.type==="setIntroAudition").payload.introBackground.url,"https://host.example/demo/intro.png");
  await assert.rejects(preview.startExport({introBackground:"file:///private/image.png"}),/HTTP/);preview.destroy();
});
test("maximum FPS is validated before mounting and unlimited reaches the renderer", async () => {
  const { container } = dom();
  for (const maxFps of [29, null, Infinity, 60.5, "60"])
    assert.throws(() => createPreview(container, { maxFps }), /帧率/);
  assert.equal(container.children.length, 0);
  const preview = createPreview(container, {
    rendererUrl: "https://renderer.example/index.html",
    maxFps: "unlimited",
  });
  await preview.ready;
  assert.equal(
    new URL(container.children[0].children[0].src).searchParams.get("maxFps"),
    "unlimited",
  );
  preview.destroy();
});

test("diagnostics defaults on and commands validate enabled before reaching the renderer", async () => {
  const { container, messages } = dom();
  const preview = createPreview(container, {
    rendererUrl: "https://renderer.example/index.html",
  });
  try {
    await preview.ready;
    assert.equal(
      new URL(container.children[0].children[0].src).searchParams.get(
        "diagnostics",
      ),
      "1",
    );
    await preview.getDiagnostics();
    await preview.resetDiagnostics();
    await preview.setDiagnostics(false);
    assert.deepEqual(
      messages.slice(-3).map((message) => message.type),
      ["getDiagnostics", "resetDiagnostics", "setDiagnostics"],
    );
    const count = messages.length;
    await assert.rejects(preview.setDiagnostics("yes"), /boolean/);
    assert.equal(messages.length, count);
  } finally {
    preview.destroy();
  }
  const disabled = createPreview(container, {
    diagnostics: false,
    rendererUrl: "https://renderer.example/index.html",
  });
  await disabled.ready;
  assert.equal(
    new URL(container.children[0].children[0].src).searchParams.get(
      "diagnostics",
    ),
    "0",
  );
  disabled.destroy();
  assert.throws(() => createPreview(container, { diagnostics: 1 }), /boolean/);
});

test("PV timeout is a creation option and unlimited loads remain cancellable past SDK timeout", async () => {
  const { container, messages } = dom({ respond: false });
  for (const pvTimeoutMs of [9999, null, Infinity, "10000"])
    assert.throws(() => createPreview(container, { pvTimeoutMs }), /PV/);
  assert.equal(container.children.length, 0);
  const preview = createPreview(container, {
    rendererUrl: "https://renderer.example/index.html",
    pvTimeoutMs: "unlimited",
    timeoutMs: 30,
  });
  await preview.ready;
  assert.equal(new URL(container.children[0].children[0].src).searchParams.get("pvTimeoutMs"), "unlimited");
  let settled = false;
  const load = preview.load({ maidata: "&inote_5=1,E" });
  const rejection = assert.rejects(load, /destroyed/);
  void load.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(settled, false);
  assert.equal(messages.at(-1).type, "load");
  preview.destroy();
  await rejection;
});

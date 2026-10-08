import assert from "node:assert/strict";
import test from "node:test";
import { createPreview } from "../sdk/index.mjs";
import { FRAME_SOURCE } from "../sdk/protocol.mjs";

function dom({ invalidIdentity = false, respond = true } = {}) {
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
            value: { type: message.type },
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
  return { container, messages, listeners };
}
test("SDK mounts without touching host content, serializes commands and releases its iframe", async () => {
  const { container, messages, listeners } = dom();
  const unrelated = {};
  container.children.push(unrelated);
  const preview = createPreview(container, {
    rendererUrl: "https://renderer.example/engine/index.html",
    resolution: { width: 720, height: 720 },
  });
  await preview.ready;
  const iframe = container.children[1].children[0];
  const url = new URL(iframe.src);
  assert.equal(url.searchParams.get("hostOrigin"), "https://host.example");
  assert.equal(url.searchParams.get("width"), "720");
  assert.equal(iframe.referrerPolicy, "no-referrer");
  await Promise.all([
    preview.load({ maidata: "&inote_5=1,E" }),
    preview.seek(1),
    preview.setSettings({ tapFlowSpeed: 8 }),
  ]);
  assert.deepEqual(
    messages.map((message) => message.type),
    ["initialize", "load", "seek", "setSettings"],
  );
  assert.ok(
    messages.every((message) => message.origin === "https://renderer.example"),
  );
  preview.destroy();
  preview.destroy();
  assert.deepEqual(container.children, [unrelated]);
  assert.equal(listeners.size, 0);
  await assert.rejects(preview.getState(), /destroyed/);
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
});

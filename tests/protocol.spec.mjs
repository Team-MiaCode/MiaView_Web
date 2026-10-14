import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_SOURCE,
  FRAME_SOURCE,
  trustedRequest,
  trustedResponse,
  normalizeChart,
  normalizeSettings,
  difficultyId,
  httpUrl,
  validIdentity,
  previewTheme,
} from "../sdk/protocol.mjs";
import { previewResolution } from "../sdk/resolution.mjs";
const sessionId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
test("Original theme tokens use the same validation for creation and runtime commands", () => {
  assert.equal(previewTheme(undefined), "dark");
  for (const theme of ["dark", "light", "legacy", "legacy_light"]) assert.equal(previewTheme(theme), theme);
  for (const theme of ["system", "Dark", "", 1]) assert.throws(() => previewTheme(theme), /Unknown MiaCode theme/);
});
test("SDK request boundary checks parent window, exact origin, session, protocol and request id", () => {
  const parent = {},
    origin = "https://host.example";
  const data = {
    source: HOST_SOURCE,
    sessionId,
    requestId,
    protocolVersion: 1,
    type: "initialize",
  };
  const event = { source: parent, origin, data };
  assert.equal(trustedRequest(event, parent, origin, null), data);
  for (const other of [
    { ...event, source: {} },
    { ...event, origin: "https://other.example" },
    { ...event, data: { ...data, sessionId: requestId } },
    { ...event, data: { ...data, requestId: "not-uuid" } },
    { ...event, data: { ...data, protocolVersion: 2 } },
    { ...event, data: { ...data, type: "unknown" } },
    { ...event, data: { ...data, source: "maiChart" } },
  ])
    assert.equal(trustedRequest(other, parent, origin, sessionId), null);
});
test("SDK responses reject unrelated frames and malformed replies", () => {
  const frame = {},
    origin = "https://renderer.example";
  const data = {
    source: FRAME_SOURCE,
    sessionId,
    requestId,
    protocolVersion: 1,
    type: "response",
    ok: true,
    playerVersion: "v1",
    sourceRevision: "a".repeat(64),
  };
  const event = { source: frame, origin, data };
  assert.equal(trustedResponse(event, frame, origin, sessionId), data);
  for (const other of [
    { ...event, source: {} },
    { ...event, origin: origin + ".bad" },
    { ...event, data: { ...data, sessionId: requestId } },
    { ...event, data: { ...data, requestId: "bad" } },
    { ...event, data: { ...data, ok: "yes" } },
    { ...event, data: { ...data, sourceRevision: "bad" } },
    { ...event, data: { ...data, type: "unknown" } },
  ])
    assert.equal(trustedResponse(other, frame, origin, sessionId), null);
  assert.ok(
    validIdentity({
      upstream: "MiaCodeWebGL",
      version: "v1",
      sourceRevision: "a".repeat(64),
    }),
  );
  assert.equal(
    validIdentity({
      upstream: "MajdataNetWebGL",
      version: "v1",
      sourceRevision: "a".repeat(64),
    }),
    false,
  );
});
test("resource interface accepts text, Blobs and URLs without website manifests", () => {
  const base = "https://host.example/charts/one/";
  const file = new Blob(["audio"], { type: "audio/wav" });
  const normalized = normalizeChart(
    {
      maidata: "&inote_5=(120)1,E",
      audio: file,
      video: "../../pv.webm",
      cover: { url: "/cover.jpg", sha256: "a".repeat(64), byteSize: 100 },
      difficulty: 5,
    },
    base,
  );
  assert.equal(normalized.maidata.text, "&inote_5=(120)1,E");
  assert.equal(normalized.audio, file);
  assert.equal(normalized.video.url, "https://host.example/pv.webm");
  assert.equal(normalized.cover.url, "https://host.example/cover.jpg");
  assert.equal(
    normalizeChart({ maidata: { url: "maidata.txt" } }, base).maidata.url,
    base + "maidata.txt",
  );
  for (const input of [
    {},
    { maidata: {} },
    { maidata: "ok", audio: "file:///private" },
    { maidata: "ok", audio: { url: "/x", byteSize: 1 } },
    { maidata: "ok", difficulty: 0 },
  ])
    assert.throws(() => normalizeChart(input, base));
  for (const url of [
    "javascript:alert(1)",
    "file:///secret",
    "https://user:password@host.example/a",
  ])
    assert.throws(() => httpUrl(url));
});
test("settings remain bounded and judgment effects cannot be disabled", () => {
  const values = {
    outerBrightness: 0.4,
    innerBrightness: 0.1,
    tapFlowSpeed: 8.25,
    touchFlowSpeed: 9.25,
    earlierSlideOnTop: false,
    noteSkin: "SD",
    previewMode: "maimuri_dx_style",
  };
  assert.deepEqual(normalizeSettings(values), values);
  for (const values of [
    { outerBrightness: 2 },
    { innerBrightness: NaN },
    { tapFlowSpeed: 0 },
    { touchFlowSpeed: Infinity },
    { noteSkin: "bad" },
    { earlierSlideOnTop: 0 },
    { showJudgeEffects: false },
    { previewMode: "unknown" },
    { previewMode: 1 },
    { previewMode: null },
  ])
    assert.throws(() => normalizeSettings(values));
  assert.equal(difficultyId(null), null);
  for (const previewMode of ["native", "maimuri_dx_style", "erase_by_area"])
    assert.deepEqual(normalizeSettings({ previewMode }), { previewMode });
  assert.equal(difficultyId(5), 5);
  assert.throws(() => difficultyId(8));
});
test("SDK only accepts square or exact 16:9 resolution", () => {
  assert.deepEqual(previewResolution(), { width: 1920, height: 1080 });
  assert.deepEqual(previewResolution({ width: 720, height: 720 }), {
    width: 720,
    height: 720,
  });
  assert.throws(() => previewResolution({ width: 800, height: 600 }));
  assert.throws(() => previewResolution({ width: 1080, height: 1920 }));
});

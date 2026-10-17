import test from "node:test";
import assert from "node:assert/strict";
import { PerformanceTransport } from "../renderer/performance-transport.mjs";

test("renderer transport sends ordered reports to its backend and forwards exact backend text", async () => {
  const requests = [],
    events = [];
  const transport = new PerformanceTransport({
    url: "https://renderer.example/miacode/__performance",
    fetcher: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return Response.json({
        text: "terminal output",
        terminalEnabled: true,
        fileEnabled: false,
      });
    },
    publish: (event) => events.push(event),
  });
  transport.send({ sequence: 1 });
  await transport.send({ sequence: 2 });
  assert.deepEqual(
    requests.map((r) => r.body.report.sequence),
    [1, 2],
  );
  assert.equal(
    requests[0].url,
    "https://renderer.example/miacode/__performance",
  );
  assert.equal(requests[0].body.sessionId, requests[1].body.sessionId);
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(events[0].backendLog.text, "terminal output");
  assert.equal(events[1].backendLog.fileEnabled, false);
  assert.equal(transport.pending, 0);
});

test("backend failure backs off without blocking playback or printing browser logs", async () => {
  let requests = 0;
  const events = [];
  const transport = new PerformanceTransport({
    fetcher: async () => {
      requests++;
      return new Response(null, { status: 404 });
    },
    publish: (event) => events.push(event),
  });
  await transport.send({ sequence: 1 });
  await transport.send({ sequence: 2 });
  assert.equal(requests, 1);
  assert.equal(events.length, 2);
  assert.equal(events[0].backendLog.ok, false);
  assert.equal(events[0].backendLog.message, "HTTP 404");
});

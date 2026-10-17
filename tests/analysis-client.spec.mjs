import test from "node:test";
import assert from "node:assert/strict";
import { PreviewAnalysis } from "../renderer/analysis-client.mjs";

function fixture() {
  let worker;
  class Worker {
    constructor(url) { this.url = url; this.messages = []; worker = this; }
    postMessage(message) { this.messages.push(message); }
    reply(message, value) { this.onmessage({ data: { id: message.id, value } }); }
    terminate() { this.terminated = true; }
  }
  const manifest = { files: ["miacode-analysis.js", "miacode-analysis.wasm"].map(path => ({ path, byteSize: 64, sha256: "a".repeat(64) })) };
  const client = new PreviewAnalysis({ version: "test" }, manifest, { WorkerClass: Worker, baseUrl: "https://preview.test/subpath/renderer/index.html" });
  return { client, worker };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = { documentOpenGeneration: 2, revision: 3, difficultyId: 5, language: "zh", renderMode: "native" };

test("Background analysis retains snapshot identities and resolves concurrent replies by request id", async () => {
  const { client, worker } = fixture();
  const initialize = worker.messages[0];
  assert.equal(worker.url.href, "https://preview.test/subpath/renderer/analysis-worker.mjs?build=test");
  assert.ok(initialize.payload.every(resource => resource.url.startsWith("https://preview.test/subpath/renderer/miacode-analysis.")));
  worker.reply(initialize, null); await client.ready;
  const first = client.analyze(input);
  assert.equal(client.analyze(input), first);
  const next = client.analyze({ ...input, revision: 4 }); await tick();
  const messages = worker.messages.slice(1); assert.equal(messages.length, 2);
  worker.reply(messages[1], { revision: 4 }); worker.reply(messages[0], { revision: 3 });
  assert.deepEqual(await first, { revision: 3 }); assert.deepEqual(await next, { revision: 4 });
  assert.equal(client.pending.size, 0); client.close(); assert.equal(worker.terminated, true);
});

test("Closing during worker initialization releases pending analysis and rejects later requests", async () => {
  const { client, worker } = fixture();
  const pending = assert.rejects(client.analyze(input), /关闭/);
  client.close(); await pending;
  assert.equal(worker.terminated, true); assert.equal(client.pending.size, 0);
  await assert.rejects(client.analyze({ ...input, revision: 4 }), /关闭/);
});

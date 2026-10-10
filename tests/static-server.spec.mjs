import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { staticServer } from "../scripts/serve.mjs";

test("server negotiates compression, caches versioned builds, and serves media byte ranges", async () => {
  const directory = await mkdtemp(join(tmpdir(), "miaview-static-"));
  await mkdir(join(directory, "renderer"));
  const body = Buffer.from("0123456789".repeat(100));
  const file = join(directory, "renderer/engine.wasm");
  await writeFile(file, body);
  await writeFile(file + ".br", brotliCompressSync(body));
  await writeFile(file + ".gz", gzipSync(body));
  await writeFile(
    join(directory, "renderer/build-identity.json"),
    JSON.stringify({ version: "test" }),
  );
  await writeFile(join(directory, "video.webm"), body);
  const server = staticServer(directory, { performanceTerminal: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const compressed = await fetch(base + "/renderer/engine.wasm?build=test", {
      headers: { "accept-encoding": "br, gzip" },
    });
    assert.equal(compressed.headers.get("content-encoding"), "br");
    assert.equal(compressed.headers.get("content-type"), "application/wasm");
    assert.match(compressed.headers.get("cache-control"), /immutable/);
    assert.deepEqual(Buffer.from(await compressed.arrayBuffer()), body);
    const gzip = await fetch(base + "/renderer/engine.wasm", {
      headers: { "accept-encoding": "br;q=0, gzip" },
    });
    assert.equal(gzip.headers.get("content-encoding"), "gzip");
    await gzip.arrayBuffer();
    const head = await fetch(base + "/renderer/engine.wasm", {
      method: "HEAD",
      headers: { "accept-encoding": "identity" },
    });
    assert.equal(Number(head.headers.get("content-length")), body.length);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const cached = await fetch(base + "/renderer/engine.wasm", {
      headers: {
        "accept-encoding": "identity",
        "if-none-match": head.headers.get("etag"),
      },
    });
    assert.equal(cached.status, 304);
    const metadata = await fetch(
      base + "/renderer/build-identity.json?build=test",
    );
    assert.equal(metadata.headers.get("cache-control"), "no-store");
    await metadata.arrayBuffer();
    for (const [range, contentRange, expected] of [
      ["bytes=5-9", "bytes 5-9/1000", body.subarray(5, 10)],
      ["bytes=-4", "bytes 996-999/1000", body.subarray(996)],
    ]) {
      const partial = await fetch(base + "/video.webm", { headers: { range } });
      assert.equal(partial.status, 206);
      assert.equal(partial.headers.get("content-range"), contentRange);
      assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expected);
    }
    const missing = await fetch(base + "/missing.mp4", {
      headers: { origin: "http://another.example" },
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("access-control-allow-origin"), "*");
    const invalid = await fetch(base + "/video.webm", {
      headers: { range: "bytes=1000-" },
    });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */1000");
    assert.equal(
      (await fetch(base + "/renderer/engine.wasm", { method: "POST" })).status,
      405,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true });
  }
});

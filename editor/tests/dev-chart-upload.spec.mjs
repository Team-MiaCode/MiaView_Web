import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { staticServer } from "../scripts/serve.mjs";

test("folder resources become isolated HTTP URLs only after complete streaming uploads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "miaview-upload-test-"));
  const server = staticServer(directory, { performanceTerminal: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const metadata = {
    maidata: { name: "maidata.txt", size: 2 },
    video: { name: "../../outside.mp4", size: 7 },
  };
  const register = (body, origin = base) =>
    fetch(base + "/__dev-charts", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await register(metadata, "http://foreign.example")).status,
      403,
    );
    assert.equal(
      (await register({ maidata: { name: "script.js", size: 2 } })).status,
      400,
    );
    assert.equal(
      (await register({ maidata: { name: "maidata.txt", size: 2 ** 32 } }))
        .status,
      400,
    );
    const created = await register(metadata);
    assert.equal(created.status, 201);
    const { chart } = await created.json();
    assert.match(chart.video.url, /^\/__dev-charts\/[a-f0-9-]+\/video\.mp4$/);
    assert.equal((await fetch(base + chart.video.url)).status, 404);
    const uploaded = await fetch(base + chart.maidata.url, {
      method: "PUT",
      headers: { Origin: base },
      body: "hi",
    });
    assert.equal(uploaded.status, 200);
    const text = await fetch(base + chart.maidata.url);
    assert.equal(await text.text(), "hi");
    assert.equal(text.headers.get("cache-control"), "no-store");
    assert.equal(
      (
        await fetch(base + chart.maidata.url, {
          headers: { "if-none-match": text.headers.get("etag") },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + chart.video.url, {
          method: "PUT",
          headers: { Origin: base },
          body: "short",
        })
      ).status,
      400,
    );
    let put;
    const finished = new Promise((resolve, reject) => {
      put = request(
        base + chart.video.url,
        { method: "PUT", headers: { Origin: base, "Content-Length": "7" } },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      put.on("error", reject);
      put.write("PV-");
    });
    assert.equal((await fetch(base + chart.video.url)).status, 404);
    put.end("data");
    assert.equal(await finished, 200);
    const pv = await fetch(base + chart.video.url);
    assert.equal(await pv.text(), "PV-data");
    assert.equal(pv.headers.get("content-type"), "video/mp4");
    assert.equal(pv.headers.get("access-control-allow-origin"), "*");
    const partial = await fetch(base + chart.video.url, {
      headers: { Range: "bytes=3-6" },
    });
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), "data");
    assert.equal(
      (
        await fetch(base + chart.video.url, {
          method: "PUT",
          headers: { Origin: base },
          body: "PV-data",
        })
      ).status,
      409,
    );
    const second = await (await register(metadata)).json();
    assert.notEqual(second.chart.video.url, chart.video.url);
    assert.deepEqual(
      await readdir(directory),
      [],
      "Uploads must not write into the project",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

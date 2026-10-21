import test from "node:test";
import assert from "node:assert/strict";
import { uploadChartFolder } from "../dev/resources.mjs";

async function upload(t, names) {
  const files = names.map(name => new File([name], name));
  const requests = [];
  const statuses = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    if (url === "/__dev-charts") {
      const metadata = JSON.parse(options.body);
      const chart = Object.fromEntries(Object.entries(metadata).map(([kind, file]) => [
        kind, { ...file, url: `/__dev-charts/test/${kind}` },
      ]));
      return new Response(JSON.stringify({ chart }), { status: 201 });
    }
    return new Response(null, { status: 200 });
  });
  const chart = await uploadChartFolder(files, text => statuses.push(text));
  return { chart, files, requests, statuses, metadata: JSON.parse(requests[0].body) };
}

for (const name of ["bg.mp4", "bg.webm", "pv.mp4", "pv.webm", "BG.MP4", "Pv.WeBm"]) {
  test(`folder upload recognizes canonical PV ${name}`, async t => {
    const { chart, files, requests, metadata } = await upload(t, [
      "maidata.txt", "song_MASTER.mp4", name,
    ]);
    assert.equal(chart.video.name, name);
    assert.deepEqual(metadata.video, { name, size: files[2].size });
    assert.equal(requests.find(request => request.url === chart.video.url).body, files[2]);
    assert.equal(requests.length, 3, "register plus only maidata and canonical PV uploads");
  });
}

test("folder without a canonical PV does not upload exported or similarly named videos", async t => {
  const { chart, requests, metadata } = await upload(t, [
    "maidata.txt", "谱面确认视频.mp4", "song_MASTER.mp4", "out.webm",
    "bg.mp4.bak", "old_bg.mp4", "pv_backup.mp4", "bg-preview.webm", "pv_backup.webm",
  ]);
  assert.equal(Object.hasOwn(chart, "video"), false);
  assert.equal(Object.hasOwn(metadata, "video"), false);
  assert.equal(requests.length, 2, "register plus maidata only; no accidental video upload");
});

test("PV selection prefers bg before pv and MP4 within each basename, independent of file order", async t => {
  for (const [videos, expected] of [
    [["confirmation.mp4", "pv.webm", "pv.mp4", "bg.webm", "bg.mp4"], "bg.mp4"],
    [["bg.mp4", "bg.webm", "pv.mp4", "pv.webm", "confirmation.mp4"], "bg.mp4"],
    [["PV.MP4", "confirmation.mp4", "bG.Mp4"], "bG.Mp4"],
    [["pv.mp4", "BG.WEBM", "pv.webm"], "BG.WEBM"],
    [["pv.webm", "Pv.Mp4", "confirmation.mp4"], "Pv.Mp4"],
  ]) {
    await t.test(videos.join(", "), async child => {
      const { chart } = await upload(child, ["maidata.txt", ...videos]);
      assert.equal(chart.video.name, expected);
    });
  }
});

test("PV filtering preserves HTTP upload protocol and first-match audio/cover selection", async t => {
  const { chart, files, requests, metadata, statuses } = await upload(t, [
    "MAIDATA.TXT", "custom.WAV", "track.mp3", "custom.PNG", "bg.jpg", "pv.mp4",
  ]);
  assert.deepEqual(metadata, {
    maidata: { name: "MAIDATA.TXT", size: files[0].size },
    audio: { name: "custom.WAV", size: files[1].size },
    cover: { name: "custom.PNG", size: files[3].size },
    video: { name: "pv.mp4", size: files[5].size },
  });
  assert.equal(requests[0].url, "/__dev-charts");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers["Content-Type"], "application/json");
  assert.equal(requests.length, 5);
  for (const [kind, index] of [["maidata", 0], ["audio", 1], ["cover", 3], ["video", 5]]) {
    const request = requests.find(request => request.url === chart[kind].url);
    assert.equal(request.method, "PUT");
    assert.equal(request.body, files[index]);
  }
  assert.ok(statuses.at(-1).includes("4/4"));
});

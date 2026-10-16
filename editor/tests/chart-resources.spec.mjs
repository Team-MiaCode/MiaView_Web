import assert from "node:assert/strict";
import test from "node:test";
import { resourceFile, stageResource, relocatePath, resolveChartResource } from "../services/chart-resources.mjs";
import { projectArchive } from "../services/zip-store.mjs";

test("Resource staging backs up canonical files and retains sibling projects", async () => {
  const files = new Map([["Collection/A/bg.jpg", new File(["old"], "bg.jpg")], ["Collection/A/bg_bak.jpg", new File(["older"], "bg_bak.jpg")],
    ["Collection/B/bg.png", new File(["sibling"], "bg.png")]]);
  const staged = stageResource(files, "Collection/A/maidata.txt", "cover", new File(["new"], "picked.PNG"));
  assert.equal(staged.path, "Collection/A/bg.png");
  assert.equal(await staged.files.get("Collection/A/bg_bak_2.jpg").text(), "old");
  assert.equal(await staged.files.get("Collection/B/bg.png").text(), "sibling");
  assert.equal(staged.writes.get("Collection/A/bg.jpg"), null);
  assert.equal(staged.file.webkitRelativePath, staged.path);
  assert.equal(await files.get("Collection/A/bg.jpg").text(), "old");
});
test("PV removal includes the selected custom file and all fallback names", () => {
  const paths = ["Song/assets/clip.webm", "Song/PV.MP4", "Song/bg.webm", "Song/track.wav"];
  const files = new Map(paths.map(path => [path, resourceFile(new File([path], path.split("/").at(-1)), path)]));
  const staged = stageResource(files, "Song/maidata.txt", "video", null, paths[0]);
  for (const path of paths.slice(0,3)) { assert.equal(staged.files.has(path), false); assert.equal(staged.writes.get(path), null); }
  assert.ok(staged.files.has("Song/assets/clip_bak.webm")); assert.ok(staged.files.has("Song/track.wav"));
});
test("Video fields resolve inside the uploaded tree, with case and relative directories", () => {
  const video = new File(["video"], "clip.webm"), files = new Map([["Collection/common/Clip.WEBM", video]]);
  assert.equal(resolveChartResource(files, "Collection/Song/maidata.txt", "../common/clip.webm"), video);
  assert.equal(resolveChartResource(files, "Collection/Song/maidata.txt", "../../clip.webm"), null);
  assert.equal(relocatePath("Collection/Song/maidata.txt", "Collection", "Export"), "Export/Song/maidata.txt");
  assert.throws(() => relocatePath("Other/bg.png", "Collection", "Export"));
});
test("Stored ZIP exports UTF-8 paths, CRC and exact file bytes", async () => {
  const archive = await projectArchive(new Map([["歌曲/maidata.txt", new File(["123456789"], "maidata.txt")], ["歌曲/assets.bin", new Blob([new Uint8Array([0,255,13,10])])]]));
  const bytes = new Uint8Array(await archive.arrayBuffer()), view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0,true), 0x04034b50);
  assert.equal(view.getUint16(6,true), 0x800); assert.equal(view.getUint32(14,true), 0xcbf43926);
  const size = view.getUint16(26,true);
  assert.equal(new TextDecoder().decode(bytes.subarray(30,30+size)), "歌曲/maidata.txt");
  assert.equal(new TextDecoder().decode(bytes.subarray(30+size,39+size)), "123456789");
  assert.equal(view.getUint32(bytes.length-22,true),0x06054b50); assert.equal(view.getUint16(bytes.length-12,true),2);
  await assert.rejects(projectArchive(new Map([["../outside.txt", new Blob(["data"])]])), /路径/);
});

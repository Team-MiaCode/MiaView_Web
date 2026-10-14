import test from "node:test";
import assert from "node:assert/strict";
import { inspectChartFolder } from "../services/chart-folder.mjs";

const file = path => ({ name: path.split("/").at(-1), webkitRelativePath: path });

test("Chart folders keep bg, PV, track and source together and retain their full inventory", () => {
  const files = ["Song/icon.png", "Song/other.mp3", "Song/other.mp4", "Song/maidata.txt", "Song/BG.PNG", "Song/PV.MP4", "Song/TRACK.MP3", "Song/cover/layout.json"].map(file);
  const { preferred } = inspectChartFolder(files);
  assert.equal(preferred.path, "Song/maidata.txt");
  assert.equal(preferred.chart.audio.name, "TRACK.MP3");
  assert.equal(preferred.chart.cover.name, "BG.PNG");
  assert.equal(preferred.chart.video.name, "PV.MP4");
  assert.equal(preferred.files.size, files.length);
  assert.equal(preferred.files.get("Song/cover/layout.json"), files.at(-1));
});

test("Multiple chart directories require selection and never borrow sibling media", () => {
  const { projects, preferred } = inspectChartFolder(["Collection/A/maidata.txt", "Collection/A/track.wav", "Collection/B/maidata.txt", "Collection/B/bg.jpg", "Collection/B/bg.mp4"].map(file));
  assert.equal(preferred, null);
  assert.equal(projects.length, 2);
  assert.equal(projects[0].chart.audio.name, "track.wav");
  assert.equal(projects[0].chart.video, undefined);
  assert.equal(projects[1].chart.audio, undefined);
  assert.equal(projects[1].chart.cover.name, "bg.jpg");
  assert.equal(projects[1].chart.video.name, "bg.mp4");
});

test("Root charts and native candidate priority determine resource selection", () => {
  const { preferred } = inspectChartFolder(["Song/extra/maidata.txt", "Song/maidata.txt", "Song/track.ogg", "Song/track.wav", "Song/bg.png", "Song/bg.jpg", "Song/pv.mp4", "Song/bg.mp4"].map(file));
  assert.equal(preferred.path, "Song/maidata.txt");
  assert.equal(preferred.chart.audio.name, "track.wav");
  assert.equal(preferred.chart.cover.name, "bg.jpg");
  assert.equal(preferred.chart.video.name, "bg.mp4");
  assert.throws(() => inspectChartFolder([file("Song/notes.txt")]), /maidata\.txt/);
});

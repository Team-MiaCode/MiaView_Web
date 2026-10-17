import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { nativeInputsFingerprint } from "../scripts/build-identity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browser = process.env.MIACODE_BROWSER || "chromium";
assert.ok(["chromium", "firefox"].includes(browser), browser);
const output = join(root, "artifacts/stage2", browser); mkdirSync(output, { recursive: true });
const common = ["document-fields", "editor-core", "editor-ime", "project-files", "project-media", "resources-core",
  "analysis-core", "preview-settings-core", "touch-authoring", "audio-settings-core", "latency-core", "audio-info-core",
  "shortcuts-core", "preferences-core", "editor-preferences", "appearance-core", "intro-audition-core", "cover-canvas",
  "cover-files-core", "cover-chart-frame", "cover-pv", "video-export-core", "video-export-workbench", "video-export-long",
  "preview-window", "performance-core", "video-geometry", "creation-workflow", "timeline-playback"];
const firefox = ["latency-core", "audio-info-core", "shortcuts-core", "preferences-core", "editor-preferences", "appearance-core",
  "intro-audition-core", "cover-canvas", "cover-files-core", "cover-chart-frame", "cover-pv", "video-export-core",
  "preview-window", "performance-core", "video-geometry", "timeline-playback"];
const cases = (browser === "chromium" ? common : firefox).map(name => ({ name, software: false }));
for (const name of ["intro-audition-core", "cover-pv", "video-export-core", "preview-window"])
  cases.push({ name, software: true });
function fingerprint() {
  const hash = createHash("sha256");
  const visit = relative => {
    const path = join(root, relative);
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "__pycache__") continue;
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else hash.update(name).update(readFileSync(join(root, name)));
    }
  };
  for (const path of ["app.mjs", "page.css", "index.html", "preview-window.html", "package.json", "package-lock.json"])
    hash.update(path).update(readFileSync(join(root, path)));
  hash.update(nativeInputsFingerprint(identity.sourceRevision,
    JSON.parse(readFileSync(join(root, "native/toolchain.json"), "utf8")), join(root, "native")));
  for (const path of ["sdk", "services", "ui", "renderer", "tests", "scripts", "backend"]) visit(path);
  return hash.digest("hex");
}
const identity = JSON.parse(readFileSync(join(root, "renderer/build-identity.json"), "utf8"));
const report = { stage: 2, browser, runtime: identity.version, sourceFingerprint: fingerprint(), startedAt: new Date().toISOString(), cases: [] };
const save = () => writeFileSync(join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
try {
  for (const item of cases) {
    const name = `${item.name}${item.software ? "-software" : ""}`, start = performance.now();
    console.log(`Stage2 ${browser}: ${name}`);
    const log = [];
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`tests/${item.name}-smoke.mjs`], { cwd: root,
        env: { ...process.env, MIACODE_BROWSER: browser, MIACODE_SOFTWARE_VIDEO: item.software ? "1" : "0" }, windowsHide: true });
      child.stdout.on("data", data => log.push(data)); child.stderr.on("data", data => log.push(data));
      child.on("error", reject); child.on("close", resolve);
    });
    writeFileSync(join(output, `${name}.log`), Buffer.concat(log));
    report.cases.push({ name, code, durationSeconds: (performance.now() - start) / 1000 }); save();
    assert.equal(code, 0, `${name}:\n${Buffer.concat(log).toString("utf8")}`);
  }
  assert.equal(fingerprint(), report.sourceFingerprint, "Stage2 inputs changed during acceptance");
  report.completedAt = new Date().toISOString(); report.passed = true;
  console.log(`Stage2 ${browser}: ${report.cases.length} functional cases passed`);
} finally { save(); }

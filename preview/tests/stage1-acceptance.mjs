import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const read = path => JSON.parse(readFileSync(path, "utf8"));
const verdict = name => {
  const data = read(`.assets/ui-reference/${name}-verdict.json`);
  assert.equal(data.verdict, "pass", name);
  assert.ok(data.score >= 85, `${name}: ${data.score}`);
  return { name, score: data.score };
};
const frame = ["gallery", "workbench-chrome", "chart-sidebar", "editor-tabs", "source-editor", "timeline-canvas", "timeline-controls", "analysis", "preview-controls"].map(verdict);
const frameMinimum = Math.min(...frame.map(item => item.score));
const pageDefinitions = [
  ["difficulty", ["difficulty-header", "designer-slots", "source-editor"]],
  ["welcome", ["welcome"]], ["metadata", ["metadata", "designer-slots"]], ["latency", ["latency"]],
  ["preferences/interface", ["preferences-interface"]], ["preferences/background", ["preferences-background"]],
  ["preferences/editor", ["preferences-editor"]], ["preferences/performance", ["preferences-performance"]],
  ["preferences/shortcuts", ["preferences-shortcuts"]],
  ["preview/video", ["preview-video"]], ["preview/gameplay", ["preview-gameplay"]], ["preview/skin", ["preview-skin"]],
  ["audio", ["audio-settings"]], ["about", ["about"]], ["export", ["export"]], ["cover", ["cover"]],
];
const pages = pageDefinitions.map(([id, components]) => {
  const direct = components.map(verdict);
  // A page inherits its displayed common workbench; retain the lowest score.
  return { id, weight: 1, components: direct, score: Math.min(frameMinimum, ...direct.map(item => item.score)) };
});
const layouts = read("artifacts/workbench-ui/results.json");
const layoutCases = layouts.filter(item => item.layout === "pass");
assert.equal(layoutCases.length, 621);
for (const engine of ["chromium", "firefox", "webkit"]) assert.equal(layoutCases.filter(item => item.engine === engine).length, 207);
const densities = read("artifacts/workbench-ui/density-results.json");
assert.equal(densities.length, 120);
assert.ok(densities.every(item => item.inputAlignment === "pass"));
const source = read("artifacts/source-editor/results.json");
assert.equal(source.length, 8);
assert.ok(source.every(item => item.measured.lineHeight === item.native.lineHeight && Math.abs(item.measured.textLeft - item.native.textLeft) <= 1));
const ime = read("artifacts/editor-ime/results.json");
assert.equal(ime.measured.focused, true);
assert.deepEqual(ime.errors, []);
const report = {
  stage: 1, threshold: 85, uiSourceCommit: read(".assets/ui-reference/reference.json").sourceCommit,
  runtime: read("renderer/build-identity.json").version,
  method: "Pages inherit the minimum accepted score of their common workbench and page components. Page weights are equal.",
  frame, frameMinimum, pages,
  overallScore: pages.reduce((sum, item) => sum + item.score * item.weight, 0) / pages.reduce((sum, item) => sum + item.weight, 0),
  minimumPageScore: Math.min(...pages.map(item => item.score)),
  layoutCases: layoutCases.length, densityCases: densities.length,
  sourceEditorCases: source.length, chineseComposition: "pass",
};
assert.ok(report.overallScore >= report.threshold && report.minimumPageScore >= report.threshold);
const output = resolve("artifacts/stage1"); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "ui-acceptance.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`Stage1 UI: ${report.overallScore.toFixed(2)}, minimum ${report.minimumPageScore}; 621 layouts, 120 density cases, native source metrics and IME passed`);

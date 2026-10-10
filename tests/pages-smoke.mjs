import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = mkdtempSync(join(tmpdir(), "miaview-pages-"));
const build = spawnSync(process.execPath, ["scripts/build-pages.mjs", join(output, "site")],
  { cwd: root, encoding: "utf8" });
assert.equal(build.status, 0, build.stderr);
const site = staticServer(join(output, "site"));
const server = createServer((request, response) => {
  if (!request.url.startsWith("/MiaView_Web/")) { response.writeHead(404).end(); return; }
  request.url = request.url.slice("/MiaView_Web".length);
  site.emit("request", request, response);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/MiaView_Web/`;
const browser = await chromium.launch({ executablePath: process.env.MIACODE_CHROMIUM,
  headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1080 } });
  const errors = [], methods = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => methods.push(request.method()));
  await page.goto(base + "index.html");
  await page.waitForURL(base + "examples/index.html");
  assert.equal(await page.locator("#local-pv").isDisabled(), true);
  const folder = join(output, "chart");
  mkdirSync(folder);
  writeFileSync(join(folder, "maidata.txt"), readFileSync(join(root, "tests/fixtures/maidata.txt")));
  await page.locator("#files").setInputFiles(folder);
  await page.locator("#play:not([disabled])").waitFor({ timeout: 90000 });
  const frame = page.frameLocator("#preview iframe");
  const iframeUrl = new URL(await page.locator("#preview iframe").getAttribute("src"));
  assert.equal(iframeUrl.pathname, "/MiaView_Web/renderer/index.html");
  await page.locator("#difficulty").selectOption("3");
  await page.waitForFunction(() => document.getElementById("status").textContent === "");
  await page.locator("#local-pv").setInputFiles(join(root, "tests/fixtures/bg-pattern.webm"));
  await page.locator("#play:not([disabled])").waitFor();
  assert.equal(await page.locator("#difficulty").inputValue(), "3");
  assert.ok((await page.locator("#media-status").textContent()).includes("bg-pattern.webm"));
  const wave = Buffer.alloc(44 + 24000 * 12 * 2);
  wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28); wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
  for (let i = 0; i < 24000 * 12; i++) wave.writeInt16LE(Math.round(Math.sin(i / 24000 * 2 * Math.PI * 440) * 800), 44 + i * 2);
  const audio = join(output, "local-track.wav");
  writeFileSync(audio, wave);
  await page.locator("#local-audio").setInputFiles(audio);
  await page.locator("#play:not([disabled])").waitFor();
  assert.ok((await page.locator("#media-status").textContent()).includes("local-track.wav"));
  await page.locator("#play").click();
  await frame.locator("#play").filter({ hasText: "暂停" }).waitFor();
  await page.locator("#pause").click();
  await frame.locator("#play").filter({ hasText: "播放" }).waitFor();
  mkdirSync(join(root, "artifacts/ui"), { recursive: true });
  await page.screenshot({ path: join(root, "artifacts/ui/pages-local-files.png"), fullPage: true });
  await page.locator("#remove-pv").click();
  await page.locator("#play:not([disabled])").waitFor();
  assert.ok((await page.locator("#media-status").textContent()).includes("PV：未选择"));
  assert.equal(await page.locator("#remove-pv").isDisabled(), true);
  assert.ok(methods.every(method => ["GET", "HEAD"].includes(method)), "Local media must not be uploaded");
  assert.deepEqual(errors, []);
  console.log("Project Pages paths, local PV/music, difficulty preservation and upload-free playback passed");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

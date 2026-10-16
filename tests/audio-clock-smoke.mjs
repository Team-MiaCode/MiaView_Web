import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { launchPreviewBrowser } from "./preview-browser.mjs";

const playwright = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const name = process.env.MIACODE_BROWSER || "chromium", browser = await launchPreviewBrowser(playwright, name);
try {
  const page = await browser.newPage();
  await page.setContent('<button type="button">Audio clock</button>');
  await page.evaluate(() => {
    window.clockContext = new AudioContext();
    document.querySelector("button").onclick = () => clockContext.resume();
  });
  await page.getByRole("button", { name: "Audio clock" }).click();
  const before = await page.evaluate(() => ({ state: clockContext.state, seconds: clockContext.currentTime }));
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
  const after = await page.evaluate(() => ({ state: clockContext.state, seconds: clockContext.currentTime }));
  console.log(JSON.stringify({ browser: name, before, after }));
  assert.equal(after.state, "running");
  assert.ok(after.seconds - before.seconds > .1, "Audio output advances its real WebAudio clock");
  await page.evaluate(() => clockContext.close());
} finally { await browser.close(); }

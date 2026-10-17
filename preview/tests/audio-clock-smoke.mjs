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
    const source = clockContext.createOscillator(), gain = clockContext.createGain();
    gain.gain.value = 0; source.connect(gain).connect(clockContext.destination);
    document.querySelector("button").onclick = async () => { await clockContext.resume(); source.start(); };
  });
  await page.getByRole("button", { name: "Audio clock" }).click();
  await page.waitForFunction(() => clockContext.currentTime > .1, null, { timeout: 10000 });
  const before = await page.evaluate(() => ({ state: clockContext.state, seconds: clockContext.currentTime }));
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
  const after = await page.evaluate(() => ({ state: clockContext.state, seconds: clockContext.currentTime }));
  console.log(JSON.stringify({ browser: name, before, after }));
  assert.equal(after.state, "running");
  assert.ok(after.seconds - before.seconds > .1, "Audio output advances its real WebAudio clock");
  await page.evaluate(() => clockContext.close());
} finally { await browser.close(); }

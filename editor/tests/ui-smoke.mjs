import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "artifacts/ui");
mkdirSync(output, { recursive: true });
const server = staticServer(root);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.MIACODE_CHROMIUM,
  headless: true, args: ["--mute-audio", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1140, height: 850 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/tests/host.html");
  await page.evaluate(async chart => {
    document.getElementById("host-play").remove();
    document.getElementById("two").remove();
    document.getElementById("one").style.width = "1080px";
    const { createPreview } = await import("/sdk/index.mjs");
    window.preview = createPreview(document.getElementById("one"), {
      resolution: { width: 1280, height: 720 }, theme: "dark",
    });
    await preview.ready;
    await preview.load({ maidata: chart, difficulty: 5 });
    await preview.seek(1.5);
  }, readFileSync(resolve(root, "tests/fixtures/maidata.txt"), "utf8"));
  const frame = page.frameLocator("#one iframe");
  await frame.locator("#play:not([disabled])").waitFor();
  await page.locator("#one iframe").screenshot({ path: resolve(output, "desktop-dark.png") });
  await frame.locator("#settings-toggle").click();
  const desktop = await frame.locator("body").evaluate(() => {
    const stage = document.getElementById("stage").getBoundingClientRect();
    const panel = document.getElementById("settings-panel").getBoundingClientRect();
    return { beside: panel.left >= stage.right, visible: panel.height > 0 };
  });
  assert.deepEqual(desktop, { beside: true, visible: true });
  await page.locator("#one iframe").screenshot({ path: resolve(output, "desktop-settings.png") });
  await frame.locator("#theme-toggle").click();
  assert.equal(await frame.locator("html").getAttribute("data-theme"), "light");
  await page.locator("#one iframe").screenshot({ path: resolve(output, "desktop-light.png") });
  await frame.locator("#settings-close").click();
  await frame.locator("#fullscreen").click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await frame.locator("#fullscreen").click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await frame.locator("#theme-toggle").click();
  await page.evaluate(() => document.getElementById("one").style.width = "320px");
  await page.setViewportSize({ width: 360, height: 740 });
  const mobile = await frame.locator("body").evaluate(() => ({
    width: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    transportHeight: document.getElementById("transport").getBoundingClientRect().height,
  }));
  assert.equal(mobile.content, mobile.width, "320px player must not overflow horizontally");
  assert.equal(mobile.transportHeight, 80);
  await page.locator("#one iframe").screenshot({ path: resolve(output, "mobile-dark.png") });
  await frame.locator("#settings-toggle").click();
  assert.ok(await frame.locator("#settings-panel").evaluate(panel =>
    panel.getBoundingClientRect().top >= document.getElementById("transport").getBoundingClientRect().bottom));
  await page.locator("#one iframe").screenshot({ path: resolve(output, "mobile-settings.png") });
  await frame.locator("#settings-close").click();
  assert.equal(await frame.locator("#settings-panel").isVisible(), false);
  assert.equal((await page.evaluate(() => preview.getState())).currentTime, 1.5);
  await page.evaluate(() => preview.destroy());
  assert.deepEqual(errors, []);
  console.log(`Theme, fullscreen and responsive UI passed; screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

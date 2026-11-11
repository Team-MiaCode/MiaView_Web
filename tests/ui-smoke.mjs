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
  const settings = frame.getByRole("button", { name: "预览设置", exact: true });
  const closeSettings = frame.getByRole("button", { name: "关闭设置", exact: true });
  const overlay = frame.locator("#preview-settings-overlay");
  const stage = frame.locator("#stage");
  const seek = frame.getByRole("slider", { name: "播放位置", exact: true });
  await seek.waitFor();
  assert.equal(await frame.locator(".panel-heading button").count(), 0);
  const actions = await frame.locator(".preview-control-row button").evaluateAll(buttons =>
    buttons.slice(-3).map(button => button.getAttribute("aria-label")));
  assert.deepEqual(actions, ["预览设置", "音频设置", "全屏"]);
  await page.locator("#one iframe").screenshot({ path: resolve(output, "desktop-dark.png") });
  await settings.click();
  assert.deepEqual(await overlay.boundingBox(), await stage.boundingBox());
  assert.ok((await seek.boundingBox()).y >= (await stage.boundingBox()).y + (await stage.boundingBox()).height);
  const freeAspect = frame.getByRole("switch", { name: "自由比例", exact: true });
  await freeAspect.check();
  await page.waitForFunction(async () => (await preview.getState()).resolution.width !== 1280, undefined, { polling: 100 });
  await freeAspect.uncheck();
  await page.waitForFunction(async () => (await preview.getState()).resolution.width === 1280, undefined, { polling: 100 });
  const hidePv = frame.getByRole("switch", { name: "隐藏 PV", exact: true });
  await hidePv.check();
  await page.waitForFunction(async () => (await preview.getState()).media.hidePv, undefined, { polling: 100 });
  await hidePv.uncheck();
  await page.waitForFunction(async () => !(await preview.getState()).media.hidePv, undefined, { polling: 100 });
  const debugInfo = frame.getByRole("switch", { name: "显示预览调试信息", exact: true });
  const fps = frame.locator("#fps");
  await fps.waitFor({ state: "hidden" });
  await debugInfo.check();
  await fps.waitFor({ state: "visible" });
  await debugInfo.uncheck();
  await fps.waitFor({ state: "hidden" });
  await page.locator("#one iframe").screenshot({ path: resolve(output, "desktop-settings.png") });
  await frame.getByRole("tab", { name: "播放", exact: true }).click();
  await frame.getByRole("combobox", { name: "主题", exact: true }).selectOption("light");
  await page.waitForFunction(() => document.querySelector("#one iframe").contentDocument.documentElement.dataset.theme === "light");
  await page.locator("#one iframe").screenshot({ path: resolve(output, "desktop-light.png") });
  await closeSettings.click();
  await frame.getByRole("button", { name: "全屏", exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await frame.getByRole("button", { name: "退出全屏", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.evaluate(async () => {
    await preview.setTheme("dark");
    document.getElementById("one").style.width = "320px";
  });
  await page.setViewportSize({ width: 360, height: 740 });
  const mobile = await frame.locator("body").evaluate(() => ({
    width: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    panel: document.querySelector(".preview-host").getBoundingClientRect().toJSON(),
  }));
  assert.equal(mobile.content, mobile.width, "320px player must not overflow horizontally");
  assert.ok(Math.abs(mobile.panel.width - mobile.panel.height * 741 / 865) < 1);
  await page.locator("#one iframe").screenshot({ path: resolve(output, "mobile-dark.png") });
  await frame.getByRole("button", { name: "音频设置", exact: true }).click();
  assert.deepEqual(await overlay.boundingBox(), await stage.boundingBox());
  await page.locator("#one iframe").screenshot({ path: resolve(output, "mobile-settings.png") });
  await closeSettings.click();
  assert.equal(await overlay.isVisible(), false);
  assert.equal((await page.evaluate(() => preview.getState())).currentTime, 1.5);
  await page.evaluate(() => preview.destroy());
  assert.deepEqual(errors, []);
  console.log(`Theme, fullscreen and responsive UI passed; screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/workbench-chrome"); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  for (const theme of ["dark", "light", "legacy", "legacy_light"]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-workbench.html?theme=${theme}`);
    await page.locator(".difficulty-header").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 300);
    assert.equal((await page.locator(".toolbar").boundingBox()).height, 30);
    assert.equal((await page.locator(".statusbar").boundingBox()).height, 23);
    assert.equal(await page.locator('.toolbar [aria-label="侧栏"]').getAttribute("aria-pressed"), "true");
    await page.locator(".toolbar").screenshot({ path: resolve(output, `workbench-toolbar-${theme}.png`) });
    await page.locator(".statusbar").screenshot({ path: resolve(output, `workbench-statusbar-${theme}.png`) });
    const controls = await page.locator(".toolbar button").evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).map(node => {
      const box = node.getBoundingClientRect(); return { label: node.getAttribute("aria-label"), x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    for (const box of controls) assert.ok(box.x >= 0 && box.x + box.width <= 800, JSON.stringify(box));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: resolve(output, `workbench-${theme}.png`) });
    await page.setViewportSize({ width: 800, height: 600 });
    await page.locator('.toolbar [aria-label="侧栏"]').click();
    const boundaries = await page.evaluate(() => {
      const root = document.getElementById("workbench");
      const top = root.querySelector(".workspace").getBoundingClientRect().top;
      const bottom = root.querySelector(".statusbar").getBoundingClientRect().top;
      const sidebar = root.querySelector(".sidebar").getBoundingClientRect();
      return { top, bottom, sidebarTop: sidebar.top, sidebarBottom: sidebar.bottom };
    });
    assert.equal(boundaries.top, boundaries.sidebarTop);
    assert.equal(boundaries.bottom, boundaries.sidebarBottom);
    await page.evaluate(() => document.getElementById("workbench").workbench.viewState.openEditor("metadata"));
    assert.equal(await page.locator(".bottom-panel").isVisible(), false);
    assert.equal(await page.locator('.toolbar [aria-label="底部面板"]').isEnabled(), false);
    assert.equal(await page.locator(".statusbar").evaluate(node => [...node.children].filter(child => child.checkVisibility()).map(child => child.textContent).join("")), "Song/maidata.txt谱面信息UTF-8");
    results.push({ theme, controls, boundaries });
  }
  assert.deepEqual(errors, []);
  console.log("Workbench chrome: four themes, toolbar/status heights, active icons, drawer boundaries and page status passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
}

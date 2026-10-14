import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/editor-tabs"); mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  for (const theme of ["dark", "light", "legacy", "legacy_light"]) {
    for (const width of [480, 240]) {
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=editor-tabs&width=${width}&theme=${theme}`);
      await page.locator('.editor-tab[data-editor-key="difficulty:6"]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator(".editor-tab").count(), 3);
      assert.equal((await page.locator(".editor-tabs").boundingBox()).height, 34);
      assert.equal(await page.locator('.editor-tab[data-editor-key="difficulty:5"] .editor-tab-label').textContent(), "*MASTER");
      assert.equal(await page.locator(".editor-tab-overflow").isVisible(), width === 240);
      const active = await page.locator(".editor-tab.active").boundingBox();
      const viewport = await page.locator(".editor-tab-viewport").boundingBox();
      assert.ok(active.x >= viewport.x - 1 && active.x + active.width <= viewport.x + viewport.width + 1);
      await page.locator(".editor-tabs").screenshot({ path: resolve(output, `editor-tabs-${width}-${theme}.png`) });
      results.push({ theme, width, active, viewport });
    }
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(async () => {
    const editor = document.getElementById("workbench").editor;
    await editor.ready;
    await editor.load({ maidata: "&title=Tabs\n&first=0\n&lv_5=12\n&inote_5=(120){4}1,2,E\n&lv_6=13\n&inote_6=(120){4}3,4,E\n" });
    editor.viewState.openEditor("difficulty:6");
  });
  await page.locator('.editor-tab[data-editor-key="difficulty:5"] [role="tab"]').click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.activeDifficultyId === 5);
  await page.locator('.editor-tab[data-editor-key="difficulty:6"] [role="tab"]').click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.activeDifficultyId === 6);
  assert.equal(await page.getByRole("textbox", { name: "Simai 谱面正文", exact: true }).inputValue(), "(120){4}3,4,E");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => {
    const state = document.getElementById("workbench").editor.viewState;
    state.openEditor("metadata"); state.openEditor("latency"); state.openEditor("preferences");
  });
  await page.locator(".editor-tab-overflow").click();
  await page.getByRole("menuitemradio", { name: "MASTER", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("workbench").editor.workbench.documentSession.activeDifficultyId === 5);
  assert.equal(await page.getByRole("textbox", { name: "Simai 谱面正文", exact: true }).inputValue(), "(120){4}1,2,E");
  assert.deepEqual(errors, []);
  console.log("Editor tabs: four themes, widths, overflow selection and native difficulty/body activation passed");
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
}

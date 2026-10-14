import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/analysis");
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 240 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const theme of ["dark", "light", "legacy", "legacy_light"]) {
    for (const kind of ["validation", "muri"]) {
      for (const state of ["empty", "pending", "results"]) {
        const name = `analysis-${kind}-${state}-${theme}`;
        await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=analysis-${kind}-${state}&theme=${theme}`);
        await page.locator(".analysis-panel").waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator(".analysis-panel").evaluate(node => getComputedStyle(node).fontSize), "11px");
        assert.equal(await page.locator(".analysis-issue").count(), state === "results" ? 2 : 0);
        const bounds = await page.locator(".analysis-panel").evaluate(node => {
          const panel = node.getBoundingClientRect();
          return [...node.querySelectorAll(".analysis-summary,.analysis-issue,.analysis-empty")].map(child => {
            const box = child.getBoundingClientRect();
            return { x: box.x - panel.x, y: box.y - panel.y, width: box.width, height: box.height };
          });
        });
        for (const box of bounds) {
          assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 801 && box.y + box.height <= 241, `${name}: ${JSON.stringify(box)}`);
        }
        await page.locator(".analysis-panel").screenshot({ path: resolve(output, `${name}.png`) });
        results.push({ name, bounds });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log("Analysis panels: four themes, syntax/Muri, empty/pending/results, 24 captures passed");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
}

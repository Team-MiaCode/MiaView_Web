import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const runtime = process.env.MIACODE_PLAYWRIGHT_MODULE;
const { chromium } = await import(runtime ? pathToFileURL(runtime).href : "playwright");
const references = JSON.parse(readFileSync(".assets/ui-reference/reference.json", "utf8"));
const output = resolve("artifacts/workbench-ui/gallery");
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const results = [];
async function captureRegion(page, selector, path) {
  await page.mouse.move(790, 410);
  await page.locator(selector).screenshot({ path });
}
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 420 } });
  for (const [theme, reference] of Object.entries(references.themes)) {
    await page.setViewportSize({ width: 800, height: 420 });
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-gallery.html?theme=${theme}`);
    await page.locator("#settingsButton .icon").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const actual = await page.evaluate(names => names.map(name => {
      const node = document.getElementById(name), box = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { name, x: box.x, y: box.y, width: box.width, height: box.height, fontSize: parseFloat(style.fontSize), fontFamily: style.fontFamily };
    }), reference.controls.map(control => control.name));
    for (const expected of reference.controls) {
      const measured = actual.find(control => control.name === expected.name);
      for (const dimension of ["x", "y", "width", "height"]) assert.ok(Math.abs(measured[dimension] - expected[dimension]) <= 1, `${theme}/${expected.name}/${dimension}: ${measured[dimension]} vs ${expected[dimension]}`);
      if (!expected.name.endsWith("Button") || ["regularButton", "primaryButton", "disabledButton"].includes(expected.name)) {
        assert.equal(measured.fontSize, expected.fontSize, `${theme}/${expected.name}/fontSize`);
        assert.ok(measured.fontFamily.includes(expected.fontFamily), `${theme}/${expected.name}/fontFamily`);
      }
    }
    const screenshot = await page.screenshot({ path: resolve(output, `${theme}.png`) });
    const pixels = await page.evaluate(async ({ native, web, controls }) => {
      async function data(url) {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      }
      const [a, b] = await Promise.all([data(native), data(web)]);
      const color = (data, x, y) => Array.from(data.slice((y * 800 + x) * 4, (y * 800 + x) * 4 + 3));
      const delta = (a, b) => Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
      const background = color(a, 0, 0);
      // Compare foreground inside each control, so empty gallery space cannot inflate fidelity.
      const regions = controls.map(control => {
        let intersection = 0, union = 0;
        const bounds = data => {
          let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
          for (let y = Math.floor(control.y); y < control.y + control.height; y++) {
            for (let x = Math.floor(control.x); x < control.x + control.width; x++) {
              if (delta(color(data, x, y), background) <= 48) continue;
              left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
            }
          }
          return { left, top, right, bottom };
        };
        for (let y = Math.floor(control.y); y < control.y + control.height; y++) {
          for (let x = Math.floor(control.x); x < control.x + control.width; x++) {
            const left = color(a, x, y), right = color(b, x, y);
            const foreground = delta(left, background) > 16 || delta(right, background) > 16;
            if (foreground) { union++; if (delta(left, right) <= 24) intersection++; }
          }
        }
        return { name: control.name, similarity: union ? intersection / union : 1, foregroundPixels: union, nativeInk: bounds(a), browserInk: bounds(b) };
      });
      return { regions, surfaceMatches: delta(color(a, 0, 0), color(b, 0, 0)) === 0 };
    }, { native: `data:image/png;base64,${readFileSync(`.assets/ui-reference/${theme}.png`).toString("base64")}`, web: `data:image/png;base64,${screenshot.toString("base64")}`, controls: reference.controls });
    assert.equal(pixels.surfaceMatches, true, `${theme} surface color`);
    results.push({ theme, sourceCommit: references.sourceCommit, geometry: actual, pixels });
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-welcome.html?theme=${theme}`);
    await page.locator(".welcome-title").waitFor();
    await page.screenshot({ path: resolve(output, `welcome-${theme}.png`) });
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=latency&theme=${theme}`);
    await page.locator("#latencyBpmField").waitFor();
    await page.screenshot({ path: resolve(output, `latency-${theme}.png`) });
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=preferences&theme=${theme}`);
    for (const section of ["interface", "background", "editor", "performance", "shortcuts"]) {
      await page.locator(`.settings-tabs [data-page="${section}"]`).click();
      await captureRegion(page, ".preferences-content", resolve(output, `preferences-${section}-${theme}.png`));
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=preview-settings&theme=${theme}`);
    await page.evaluate(() => { document.getElementById("page").style.height = "auto"; document.getElementById("page").style.overflow = "visible"; document.documentElement.style.overflow = "visible"; document.body.style.overflow = "visible"; });
    for (const section of ["video", "gameplay", "skin"]) {
      await page.locator(`.settings-tabs [data-page="${section}"]`).click();
      if (section === "gameplay") assert.equal(await page.getByRole("slider", { name: "Tap流速", exact: true }).inputValue(), "7.5");
      await captureRegion(page, ".settings-form", resolve(output, `preview-settings-${section}-${theme}.png`));
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=audio-settings&theme=${theme}`);
    await page.evaluate(() => { document.getElementById("page").style.height = "auto"; document.getElementById("page").style.overflow = "visible"; document.documentElement.style.overflow = "visible"; document.body.style.overflow = "visible"; });
    await captureRegion(page, ".audio-settings", resolve(output, `audio-settings-${theme}.png`));
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=about&theme=${theme}`);
    await captureRegion(page, ".about-content", resolve(output, `about-${theme}.png`));
    for (const key of ["metadata", "metadata-narrow"]) {
      await page.setViewportSize({ width: 800, height: 900 });
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=${key}&theme=${theme}`);
      const box = await page.locator(".metadata-page").boundingBox();
      const nativeImage = readFileSync(resolve(".assets/ui-reference", `${key}-${theme}.png`));
      assert.ok(Math.abs(box.width - nativeImage.readUInt32BE(16)) <= 1 && Math.abs(box.height - nativeImage.readUInt32BE(20)) <= 1, `${theme}/${key} original page geometry: ${JSON.stringify(box)}`);
      for (const font of ["Arial", "serif"]) {
        await page.evaluate(font => document.documentElement.style.setProperty("--ui-font-family", font), font);
        const fallback = await page.locator(".metadata-page").boundingBox();
        assert.equal(fallback.height, box.height, `${theme}/${key}/${font} fallback font page height`);
      }
      await page.evaluate(() => document.documentElement.style.removeProperty("--ui-font-family"));
      await captureRegion(page, ".metadata-page", resolve(output, `${key}-${theme}.png`));
    }
    for (const key of ["difficulty-header", "difficulty-header-narrow", "designer-slots"]) {
      await page.setViewportSize({ width: 800, height: 720 });
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=${key}&theme=${theme}`);
      const selector = key === "designer-slots" ? ".designer-slots" : ".difficulty-header";
      const box = await page.locator(selector).boundingBox();
      const nativeImage = readFileSync(resolve(".assets/ui-reference", `${key}-${theme}.png`));
      const expected = key === "designer-slots" ? reference[key].bodyBounds : { width: nativeImage.readUInt32BE(16), height: nativeImage.readUInt32BE(20) };
      assert.ok(Math.abs(box.width - expected.width) <= 1 && Math.abs(box.height - expected.height) <= 1, `${theme}/${key} original content geometry: ${JSON.stringify(box)} vs ${JSON.stringify(expected)}`);
      await captureRegion(page, selector, resolve(output, `${key}-${theme}.png`));
    }
    await page.setViewportSize({ width: 800, height: 420 });
    await page.setViewportSize({ width: 800, height: 720 });
    for (const tab of ["output", "intro", "batch"]) {
      await page.setViewportSize({ width: 800, height: 900 });
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=export-${tab}&theme=${theme}`);
      await captureRegion(page, "#page", resolve(output, `export-${tab}-${theme}.png`));
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=chart-sidebar&theme=${theme}`);
    await captureRegion(page, "#page", resolve(output, `chart-sidebar-${theme}.png`));
    await page.setViewportSize({ width: 1200, height: 720 });
    for (const tab of ["canvas", "card", "image", "text"]) {
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui-page.html?page=cover-${tab}&theme=${theme}&native=1`);
      await page.evaluate(() => document.querySelector(".cover-editor").coverRenderer.ready);
      await captureRegion(page, "#page", resolve(output, `cover-${tab}-${theme}.png`));
    }
    for (const section of ["interface", "background", "editor", "performance", "shortcuts"]) {
      const name = `preferences-${section}-${theme}`;
      const bounds = reference.preferences[section].bodyBounds;
      const data = await page.evaluate(async ({ name, bounds }) => {
        const image = new Image(); image.src = `/.assets/ui-reference/${name}.png`; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = bounds.width; canvas.height = bounds.height;
        canvas.getContext("2d").drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL().split(",")[1];
      }, { name, bounds });
      writeFileSync(resolve(output, `native-${name}.png`), Buffer.from(data, "base64"));
    }
    for (const name of [`preview-settings-video-${theme}`, `preview-settings-gameplay-${theme}`, `preview-settings-skin-${theme}`, `audio-settings-${theme}`, `about-${theme}`, `designer-slots-${theme}`]) {
      const bounds = name.startsWith("preview-settings") ? reference["preview-settings"][name.split("-")[2]].bodyBounds : reference[name.slice(0, -(theme.length + 1))].bodyBounds;
      const data = await page.evaluate(async ({name, bounds}) => {
        const image = new Image(); image.src = `/.assets/ui-reference/${name}.png`; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = bounds.width; canvas.height = bounds.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL().split(",")[1];
      }, { name, bounds });
      writeFileSync(resolve(output, `native-${name}.png`), Buffer.from(data, "base64"));
    }
    console.log(`${theme}: original QML control bounds, font metrics and surface color passed`);
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(resolve(output, "comparison.json"), JSON.stringify(results, null, 2) + "\n");
}

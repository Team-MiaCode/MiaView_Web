import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";
import { launchPreviewBrowser, previewGraphics } from "./preview-browser.mjs";

const runtime = process.env.MIACODE_PLAYWRIGHT_MODULE;
const playwright = await import(runtime ? pathToFileURL(runtime).href : "playwright");
const engines = (process.env.MIACODE_TEST_ENGINES || "chromium,firefox,webkit").split(",");
const output = resolve("artifacts/workbench-ui");
mkdirSync(output, { recursive: true });
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const sizes = [[320, 568], [360, 800], [390, 844], [640, 360], [768, 1024], [800, 600], [1024, 600], [1280, 720], [1366, 768], [1920, 1080], [2560, 1080], [3440, 1440], [1080, 1920], [2560, 1440],
  [719, 800], [720, 800], [721, 800], [1059, 768], [1060, 768], [1061, 768], [1280, 479], [1280, 480], [1280, 481]];
const pages = ["welcome", "metadata", "preferences", "latency", "export", "cover", "preview-settings", "audio-settings", "about"];
const results = [];
const capabilities = [];
async function assertControlBounds(page, label) {
  const bounds = await page.evaluate(() => {
    const parent = document.querySelector(".editor-content").getBoundingClientRect();
    return [...document.querySelectorAll(".editor-content button,.editor-content input,.editor-content select,.editor-content textarea")]
      .filter(node => node.checkVisibility()).map(node => ({ label: node.getAttribute("aria-label") || node.textContent, left: node.getBoundingClientRect().left - parent.left, right: node.getBoundingClientRect().right - parent.right }));
  });
  for (const control of bounds) assert.ok(control.left >= -1 && control.right <= 1, `${label}: ${JSON.stringify(control)}`);
}
try {
  for (const name of engines) {
    const browser = await launchPreviewBrowser(playwright, name);
    let page, activeCase;
    try {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      page = await context.newPage();
      const graphics = await previewGraphics(page, name);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(base + "/index.html");
      await page.locator(".welcome-title").waitFor();
      await page.evaluate(() => document.getElementById("workbench").editor.ready);
      const webAudio = await page.evaluate(() => typeof (globalThis.AudioContext ?? globalThis.webkitAudioContext) === "function");
      capabilities.push({ engine: name, version: browser.version(), webAudio, graphics, platform: process.platform, architecture: process.arch });
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        for (const key of pages) {
          activeCase = { engine: name, width, height, page: key };
          await page.evaluate(key => document.getElementById("workbench").editor.viewState.openEditor(key), key);
          const geometry = await page.evaluate(() => {
            const root = document.getElementById("workbench");
            const panels = [...root.querySelectorAll(".menubar,.toolbar,.activitybar,.editor-panel,.statusbar")].filter(node => node.getClientRects().length);
            return panels.map(node => ({ type: node.className, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom }));
          });
          for (const panel of geometry) {
            assert.ok(panel.left >= -1 && panel.right <= width + 1, `${name} ${width}×${height} ${key}: horizontal bounds ${JSON.stringify(panel)}`);
            assert.ok(panel.top >= -1 && panel.bottom <= height + 1, `${name} ${width}×${height} ${key}: vertical bounds ${JSON.stringify(panel)}`);
          }
          if (key === "preferences") {
            for (const section of ["interface", "background", "editor", "performance", "shortcuts"]) {
              await page.locator(`.settings-tabs button[data-page="${section}"]`).click();
              if (section === "shortcuts") {
                assert.equal(await page.locator(".shortcut-row").count(), 25);
                const list = await page.locator(".shortcut-list").evaluate(node => ({ height: node.clientHeight, scroll: node.scrollHeight }));
                assert.ok(list.height > 0 && list.scroll > list.height, `${name}/${width}/shortcuts scroll area ${JSON.stringify(list)}`);
                await page.locator('.shortcut-capture[data-shortcut-id="editor.overwrite_mode"]').scrollIntoViewIfNeeded();
              }
              const bounds = await page.evaluate(() => {
                const parent = document.querySelector(".editor-content").getBoundingClientRect();
                return [...document.querySelectorAll(".settings-tab-content button,.settings-tab-content input,.settings-tab-content select")]
                  .filter(node => node.getClientRects().length).map(node => ({ label: node.getAttribute("aria-label") || node.textContent, left: node.getBoundingClientRect().left - parent.left, right: node.getBoundingClientRect().right - parent.right }));
              });
              for (const control of bounds) assert.ok(control.left >= -1 && control.right <= 1, `${name}/${width}/${section}: ${JSON.stringify(control)}`);
            }
            await page.locator('.settings-tabs button[data-page="interface"]').click();
          }
          if (key === "preview-settings") {
            for (const section of ["video", "gameplay", "skin"]) {
              await page.locator(`.settings-tabs button[data-page="${section}"]`).click();
              const bounds = await page.evaluate(() => {
                const parent = document.querySelector(".editor-content").getBoundingClientRect();
                return [...document.querySelectorAll(".settings-tab-content input,.settings-tab-content select,.settings-tab-content button")]
                  .filter(node => node.getClientRects().length).map(node => ({ label: node.getAttribute("aria-label"), left: node.getBoundingClientRect().left - parent.left, right: node.getBoundingClientRect().right - parent.right }));
              });
              for (const control of bounds) assert.ok(control.left >= -1 && control.right <= 1, `${name}/${width}/preview/${section}: ${JSON.stringify(control)}`);
            }
          }
          if (key === "export") {
            for (const section of ["output", "video", "gameplay", "skin", "intro"]) {
              await page.locator(`.settings-tabs button[data-page="${section}"]`).click();
              await assertControlBounds(page, `${name}/${width}/export/${section}`);
            }
          }
          if (key === "cover") {
            await page.locator('.settings-tabs button[data-page="layer"]').click();
            await assertControlBounds(page, `${name}/${width}/cover/layer`);
            await page.locator('.settings-tabs button[data-page="canvas"]').click();
            for (const menu of [".cover-topbar .cover-menu", ".cover-layers-pane .cover-menu"]) {
              activeCase.menu = menu;
              await page.locator(`${menu} summary`).click();
              await assertControlBounds(page, `${name}/${width}/cover/menu`);
              await page.locator(`${menu} summary`).click();
            }
          }
          if (key === "metadata") {
            await page.getByRole("button", { name: "管理", exact: true }).click();
            const dialog = page.locator(".workbench-dialog");
            assert.equal(await dialog.locator(".designer-slot").count(), 7);
            const box = await dialog.boundingBox();
            assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= height + 1, `${name}/${width}/designer dialog bounds`);
            const overflow = await dialog.evaluate(node => [...node.querySelectorAll("input,button")].filter(child => child.checkVisibility()).map(child => {
              const a = child.getBoundingClientRect(), b = node.getBoundingClientRect(); return { left: a.left - b.left, right: a.right - b.right };
            }));
            for (const child of overflow) assert.ok(child.left >= 0 && child.right <= 0, `${name}/${width}/designer control ${JSON.stringify(child)}`);
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "detached" });
            assert.equal(await page.getByRole("button", { name: "管理", exact: true }).evaluate(node => node === document.activeElement), true);
          }
          await assertControlBounds(page, `${name}/${width}/${key}`);
          results.push({ engine: name, width, height, page: key, layout: "pass" });
        }
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      activeCase = { engine: name, phase: "editorInput", width: 1366, height: 768 };
      if (webAudio) await page.evaluate(() => document.getElementById("workbench").editor.command("file.demo"));
      else await page.evaluate(() => {
        const editor = document.getElementById("workbench").editor;
        editor.workbench.setDocument({ hasDocument: true, chartText: "(120){4}E", charts: [{ id: 5 }] });
        editor.viewState.openEditor("difficulty:5");
      });
      await page.locator(".source-input").waitFor();
      await page.evaluate(() => {
        const editor = document.getElementById("workbench").editor;
        editor.workbench.setDocument({ ...editor.workbench.documentSession, duration: 30, exportValues: {exportStartSeconds: 0, exportEndSeconds: 30} });
        editor.viewState.openEditor("export");
      });
      const begin = page.getByRole("slider", { name: "开始", exact: true });
      const finish = page.getByRole("slider", { name: "结束", exact: true });
      await begin.focus();
      await page.keyboard.press("End");
      assert.equal(await begin.getAttribute("aria-valuenow"), "25");
      await page.keyboard.press("Home");
      await finish.focus();
      await page.keyboard.press("Home");
      assert.equal(await finish.getAttribute("aria-valuenow"), "5");
      const endField = page.locator('.export-range-fields input[aria-label="结束"]');
      await endField.fill("2");
      await endField.dispatchEvent("change");
      assert.equal(await endField.inputValue(), "5.000");
      await finish.focus();
      await page.keyboard.press("End");
      const thumb = await begin.boundingBox();
      await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
      await page.mouse.down();
      await page.mouse.move(thumb.x + thumb.width / 2 + 40, thumb.y + thumb.height / 2, { steps: 4 });
      await page.mouse.up();
      assert.ok(Number(await begin.getAttribute("aria-valuenow")) > 0);
      const selected = await page.locator(".export-range-selection").boundingBox();
      const lane = await page.locator(".export-range-lane").boundingBox();
      assert.ok(selected.width < lane.width - 20, `${name} range selection follows pointer`);
      await page.evaluate(() => document.getElementById("workbench").editor.viewState.openEditor("difficulty:5"));
      await page.evaluate(() => {
        const editor = document.getElementById("workbench").editor;
        editor.workbench.setDocument({ ...editor.workbench.documentSession, currentDifficultyId: 5, currentDifficultyLevel: "13+", currentDifficultyOffset: "0.125", currentDifficultyDesigner: "MiaCode",
          charts: editor.workbench.documentSession.charts.map(chart => chart.id === 5
            ? { ...chart, bookmarks: [{line: 2, title: "主歌"}, {line: 8, title: "副歌"}] } : chart) });
        editor.viewState.openEditor("difficulty:5");
      });
      const section = page.locator(".difficulty-section-toggle");
      await section.focus();
      await page.keyboard.press("Space");
      assert.equal(await section.getAttribute("aria-expanded"), "false");
      assert.equal(await section.evaluate(node => node === document.activeElement), true);
      assert.equal(await page.locator(".difficulty-row").count(), 0);
      await page.keyboard.press("Space");
      assert.equal(await section.getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator(".difficulty-bookmark").count(), 2);
      await page.locator('.difficulty-row[data-difficulty="5"]').focus();
      await page.keyboard.press("Space");
      assert.equal(await page.locator(".difficulty-bookmark").count(), 0);
      assert.equal(await page.locator('.difficulty-row[data-difficulty="5"]').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press("Space");
      assert.equal(await page.locator(".difficulty-bookmark").count(), 2);
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        const fields = await page.locator(".difficulty-header input").evaluateAll(nodes => nodes.map(node => {
          const a = node.getBoundingClientRect(), b = node.closest(".difficulty-header").getBoundingClientRect();
          return { name: node.name, left: a.left - b.left, right: a.right - b.right };
        }));
        assert.equal(fields.length, 3);
        for (const field of fields) assert.ok(field.left >= 0 && field.right <= 0, `${name}/${width}/difficulty information ${JSON.stringify(field)}`);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      for (const [width, height] of [[320, 568], [640, 360], [1366, 768]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => {
          const editor = document.getElementById("workbench").editor;
          editor.workbench.setDocument({ ...editor.workbench.documentSession, syntaxErrorCount: 1, syntaxWarningCount: 1,
            validationRows: [{severity: 'error', line: 2, column: 3, endColumn: 5, second: 1.2, title: '语法', detail: '错误说明'.repeat(35), difficultyId: 5, revision: 3}],
            muriRows: [{severity: 'warning', alert: 'warning', line: 3, column: 4, endColumn: 8, second: 2, title: '重叠', detail: '判定说明'.repeat(35), difficultyId: 5, revision: 3}], bookmarks: [{line: 2, title: '主歌'}, {line: 8, title: '副歌'}] });
          if (innerHeight <= 480) editor.workbench.command('view.bottom');
        });
        for (const key of ['validation', 'muri', 'timeline']) {
          await page.locator(`.bottom-tabs button[data-panel="${key}"]`).click();
          const bounds = await page.locator('.bottom-panel').boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, `${name}/${width}/bottom/${key}`);
          assert.equal(await page.locator(`.bottom-tabs button[data-panel="${key}"]`).getAttribute('aria-selected'), 'true');
        }
        if (height <= 480) await page.keyboard.press('Escape');
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.evaluate(() => document.getElementById("workbench").editor.viewState.openEditor("difficulty:5"));
      await page.locator(".source-input").fill("(120){4}\n1,2,3,4,\n|| 中文注释\n5h[4:1],6-2[4:1],E");
      await page.evaluate(() => document.getElementById("workbench").editor.workbench.sourceEditor.pending);
      await page.waitForFunction(() => document.querySelectorAll(".source-code-line").length === 4);
      await page.evaluate(() => document.fonts.ready);
      const fontLoaded = await page.evaluate(() => {
        const faces = [...document.fonts].filter(face => face.family.replaceAll('"', "") === "Maple Mono Normal NL CN");
        return { count: faces.length, loaded: faces.every(face => face.status === "loaded"), applied: getComputedStyle(document.querySelector(".source-input")).fontFamily.includes("Maple Mono Normal NL CN") };
      });
      assert.deepEqual(fontLoaded, { count: 2, loaded: true, applied: true }, `${name} original editor font`);
      const alignment = await page.evaluate(() => {
        const input = document.querySelector(".source-input"), paint = document.querySelector(".source-paint");
        const a = getComputedStyle(input), b = getComputedStyle(paint);
        const ra = input.getBoundingClientRect(), rb = paint.getBoundingClientRect();
        return { font: a.font === b.font, padding: a.padding === b.padding, left: Math.abs(ra.left - rb.left), top: Math.abs(ra.top - rb.top), lines: document.querySelectorAll(".source-code-line").length };
      });
      assert.equal(alignment.font, true);
      assert.equal(alignment.padding, true);
      assert.ok(alignment.left <= 1 && alignment.top <= 1);
      assert.equal(alignment.lines, 4);
      await page.locator(".source-input").focus();
      await page.keyboard.press("Control+f");
      assert.equal(await page.locator(".find-replace-bar").isVisible(), true);
      assert.equal(await page.locator(".find-replace-bar input:focus").getAttribute("placeholder"), "查找");
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        // Measure the displayed frame after resize observers apply text geometry.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await assertControlBounds(page, `${name}/${width}/find-replace`);
        const inputHeight = await page.locator(".source-input").evaluate(node => node.clientHeight);
        assert.ok(inputHeight >= 30, `${name}/${width}/${height} find editor viewport ${inputHeight}`);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.locator(".find-replace-bar input").first().focus();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".find-replace-bar").isVisible(), false);
      assert.equal(await page.locator(".source-input:focus").count(), 1);
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => {
          const editor = document.getElementById("workbench").editor.workbench.sourceEditor;
          editor.input.setSelectionRange(editor.input.value.length - 1, editor.input.value.length - 1);
          editor.focus(); editor.draw(); editor.updateCompletion({ completionActive: true, completionCandidates: ["h[4:1]", "-8[4:1]", "pp5[4:1]", "中文候选说明".repeat(20)], completionIndex: 0 });
        });
        const box = await page.locator(".completion-popup").boundingBox();
        const host = await page.locator(".source-viewport").boundingBox();
        assert.ok(host.height >= 30, `${name}/${width}/editor viewport ${host.height}`);
        assert.ok(box.x >= host.x - 1 && box.x + box.width <= host.x + host.width + 1, `${name}/${width}/completion horizontal bounds`);
        assert.ok(box.y >= host.y - 1 && box.y + box.height <= host.y + host.height + 1, `${name}/${width}/completion vertical bounds ${JSON.stringify({ box, host })}`);
      }
      await page.locator(".source-input").fill("1h[");
      await page.evaluate(async () => {
        const editor = document.getElementById("workbench").editor;
        await editor.workbench.sourceEditor.pending;
        await editor.command("edit.triggerCompletion", { glyph: "[" });
      });
      const candidates = await page.locator(".completion-candidate").allTextContents();
      assert.ok(candidates.length >= 2, `${name}: native completion candidates`);
      await page.keyboard.press("ArrowDown");
      await page.evaluate(() => document.getElementById("workbench").editor.workbench.sourceEditor.pending);
      assert.equal(await page.locator('.completion-candidate[aria-selected="true"]').textContent(), candidates[1]);
      assert.equal(await page.locator(".source-input:focus").count(), 1);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".completion-popup").isVisible(), false);
      await page.setViewportSize({ width: 1366, height: 768 });
      const frame = await page.locator(".preview-container iframe").elementHandle();
      for (const theme of ["light", "legacy", "legacy_light", "dark"]) {
        await page.evaluate(theme => {
          const state = document.getElementById("workbench").editor.viewState;
          state.setPreference("darkThemeToken", theme);
          state.setPreference("themeModeToken", "dark");
        }, theme);
        await page.waitForFunction(theme => document.querySelector(".preview-container iframe").contentDocument.documentElement.dataset.theme === theme, theme);
        assert.equal(await frame.evaluate(node => node.isConnected), true, `${name}/${theme} preview instance retained`);
      }
      await page.screenshot({ path: resolve(output, `${name}-editor.png`) });
      await page.locator(".menu-button").first().click();
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.locator("[role=menuitem]:focus").getAttribute("aria-label"), "打开谱面文件夹");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("[role=menu]").count(), 0);
      assert.equal(await page.locator(".menu-button:focus").textContent(), "文件");
      for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
        activeCase = { engine: name, phase: "inputAlignment", scale };
        await page.setViewportSize({ width: Math.floor(1366 / scale), height: Math.floor(768 / scale) });
        await page.evaluate(() => document.getElementById("workbench").editor.viewState.setPreference("editorAutoWrap", true));
        await page.locator(".source-input").fill(`${"1h[4:1],2-8[4:1],".repeat(35)}\n${"|| 中文注释".repeat(35)}\nE`);
        await page.evaluate(() => document.getElementById("workbench").editor.workbench.sourceEditor.pending);
        await page.waitForFunction(() => document.querySelectorAll(".source-code-line").length === 3);
        const wrapping = await page.evaluate(() => {
          const editor = document.getElementById("workbench").editor.workbench.sourceEditor;
          editor.draw();
          editor.input.scrollTop = editor.input.scrollHeight;
          editor.scroll();
          return { inputHeight: editor.input.scrollHeight, paintHeight: editor.paint.scrollHeight,
            inputWidth: editor.input.clientWidth, paintWidth: editor.paint.clientWidth,
            inputScroll: editor.input.scrollTop, paintScroll: editor.paint.scrollTop,
            gutterHeights: [...editor.gutter.children].map(node => node.getBoundingClientRect().height),
            paintHeights: [...editor.paint.children].map(node => node.getBoundingClientRect().height) };
        });
        assert.equal(wrapping.inputWidth, wrapping.paintWidth, `${name}/${scale} wrapping width`);
        assert.ok(Math.abs(wrapping.inputHeight - wrapping.paintHeight) <= 1, `${name}/${scale} wrapping height: ${JSON.stringify(wrapping)}`);
        assert.equal(wrapping.inputScroll, wrapping.paintScroll, `${name}/${scale} scroll synchronization`);
        assert.deepEqual(wrapping.gutterHeights, wrapping.paintHeights, `${name}/${scale} wrapped line numbers`);
        results.push({ engine: name, scale, cssViewport: [Math.floor(1366 / scale), Math.floor(768 / scale)], inputAlignment: "pass" });
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.evaluate(() => document.getElementById("workbench").editor.viewState.openEditor("preferences"));
      await page.screenshot({ path: resolve(output, `${name}-preferences.png`) });
      assert.deepEqual(errors, [], `${name} JavaScript errors`);
      console.log(`${name}: ${sizes.length * pages.length} page layouts and input alignment passed`);
      await context.close();
    } catch (error) {
      const evidence = { ...activeCase, error: error.message };
      if (page && !page.isClosed()) {
        await page.screenshot({ path: resolve(output, `${name}-failure.png`) }).catch(() => {});
        evidence.menus = await page.locator(".cover-menu summary").evaluateAll(nodes => nodes.map(node => ({
          text: node.textContent, rect: node.getBoundingClientRect().toJSON(), visible: node.checkVisibility(),
          font: getComputedStyle(node).font, parent: node.parentElement.outerHTML,
        }))).catch(() => []);
      }
      writeFileSync(resolve(output, `${name}-failure.json`), JSON.stringify(evidence, null, 2) + "\n");
      console.log(JSON.stringify(evidence));
      throw error;
    } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  writeFileSync(resolve(output, "capabilities.json"), JSON.stringify(capabilities, null, 2) + "\n");
}

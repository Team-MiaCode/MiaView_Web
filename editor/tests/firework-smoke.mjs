import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chart = readFileSync(resolve(root, "tests/fixtures/firework/maidata.txt"), "utf8");
const server = staticServer(root, { performanceOutput: () => {} });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.MIACODE_CHROMIUM,
  headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    // Observe real WebGL work, including deferred Qt renders, rather than JS tick time.
    const shaders = new WeakMap(), programs = new WeakMap(), timingLocations = new WeakMap();
    window.fireworkGpu = { mipmaps: 0, draws: 0, links: 0, angles: [] };
    const proto = WebGL2RenderingContext.prototype;
    const wrap = (name, observe) => {
      const original = proto[name];
      proto[name] = function (...args) {
        observe.apply(this, args);
        return original.apply(this, args);
      };
    };
    wrap("shaderSource", (shader, source) => shaders.set(shader, source));
    wrap("attachShader", (program, shader) => {
      const sources = programs.get(program) ?? [];
      sources.push(shader);
      programs.set(program, sources);
    });
    const isFirework = program => (programs.get(program) ?? [])
      .some(shader => shaders.get(shader)?.includes("starStates"));
    wrap("linkProgram", program => {
      if (isFirework(program)) window.fireworkGpu.links++;
    });
    wrap("generateMipmap", () => window.fireworkGpu.mipmaps++);
    for (const name of ["drawArrays", "drawElements"]) {
      wrap(name, function () {
        const program = this.getParameter(this.CURRENT_PROGRAM);
        if (!isFirework(program)) return;
        window.fireworkGpu.draws++;
        // Qt's GLES backend exposes the shared block as ordinary uniforms.
        // Find the fragment timing vector without hard-coding SPIR-V names.
        if (!timingLocations.has(program)) {
          const names = Array.from({ length: this.getProgramParameter(program, this.ACTIVE_UNIFORMS) },
            (_, index) => this.getActiveUniform(program, index).name);
          const timing = names.filter(name => /(^|\.)timing$/.test(name)).at(-1);
          if (!timing) throw new Error("Firework timing uniform missing");
          timingLocations.set(program, this.getUniformLocation(program, timing));
        }
        const timing = this.getUniform(program, timingLocations.get(program));
        window.fireworkGpu.angles.push(timing[2]);
      });
    }
  });
  await page.goto(base + "/tests/host.html");
  await page.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs");
    window.preview = createPreview(document.getElementById("one"), {
      resolution: { width: 640, height: 360 }, diagnostics: false,
    });
    await preview.ready;
  });
  const frame = page.frames().find(frame => frame.url().includes("/renderer/index.html"));
  const gpu = () => frame.evaluate(() => ({ ...window.fireworkGpu }));
  const settled = async () => {
    // Allow both the SDK seek and Qt's queued render/presentation to finish.
    await frame.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise(resolve => requestAnimationFrame(resolve));
    });
  };
  const warmed = await gpu();
  assert.ok(warmed.links > 0, "ready requires a compiled firework program");
  assert.ok(warmed.draws > 0, "ready requires a submitted transparent firework draw");
  assert.equal(warmed.mipmaps, 1, "the actual big-ball mipmap is prepared before playback");

  await page.evaluate(maidata => preview.load({
    maidata,
    difficulty: 5,
  }), chart);
  await settled();
  assert.equal((await gpu()).draws, warmed.draws, "an idle retained node must not draw");
  // Touch at 2/4 seconds; touch-hold ends at 6.5 seconds. Each burst has an idle gap.
  for (const [active, idle] of [[2.233, 3.5], [4.233, 5.5], [6.733, 8]]) {
    const before = await gpu();
    await page.evaluate(second => preview.seek(second), active);
    await settled();
    const burst = await gpu();
    assert.ok(burst.draws > before.draws, `firework must render at ${active}s`);
    assert.equal(burst.mipmaps, warmed.mipmaps, "bursts reuse the warmed big-ball texture");
    assert.equal(burst.links, warmed.links, "bursts reuse the warmed shader program");
    await page.evaluate(second => preview.seek(second), idle);
    await settled();
    const ended = await gpu();
    assert.equal(ended.draws, burst.draws, "ended firework must be blocked without an extra draw");
  }
  // Backward seeks restart animation while retaining resources.
  await page.evaluate(() => preview.seek(2.233));
  await settled();
  const restarted = await gpu();
  assert.ok(restarted.draws > warmed.draws);
  assert.equal(restarted.mipmaps, warmed.mipmaps);
  assert.equal(restarted.links, warmed.links);

  // Replaying the same burst at the same elapsed time must still choose a new
  // angle. 0.15s also exercises the equality with the synthetic warm-up lead.
  const angles = [];
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => preview.seek(3.5));
    await settled();
    const idle = await gpu();
    await page.evaluate(() => preview.seek(2.15));
    await settled();
    const replay = await gpu();
    assert.ok(replay.draws > idle.draws);
    assert.equal(replay.mipmaps, warmed.mipmaps);
    assert.equal(replay.links, warmed.links);
    const angle = replay.angles.at(-1);
    assert.ok(Number.isFinite(angle) && angle >= 0 && angle < 4096);
    angles.push(angle);
  }
  assert.notEqual(angles[0], angles[1], "independent repeated bursts retain upstream randomization");
  const { mipmaps, draws, links } = await gpu();
  await page.evaluate(() => preview.destroy());
  assert.deepEqual(errors, []);
  console.log(`Firework warm-up, idle blocking, reuse and random restart passed: ${JSON.stringify({ mipmaps, draws, links })}`);
  await page.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

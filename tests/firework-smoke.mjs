import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.MIACODE_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chart = readFileSync(resolve(root, "tests/fixtures/firework/maidata.txt"), "utf8").replace(",E", ",,E");
const server = staticServer(root, { performanceOutput: () => {} });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.MIACODE_CHROMIUM,
  headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage();
  const errors = [];
  const packs = new Set();
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith(".rcc")) packs.add(path.split("/").at(-1));
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const shaders = new WeakMap(), programs = new WeakMap(), styles = new WeakMap();
    window.fireworkGpu = { mipmaps: 0, draws: [0, 0], links: [0, 0] };
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
    wrap("linkProgram", program => {
      const sources = programs.get(program)?.map(shader => shaders.get(shader)) ?? [];
      const style = sources.some(source => source.includes("materialAndEdge")) ? 0
        : sources.some(source => source.includes("colorBallBigSource")) ? 1 : undefined;
      if (style === undefined) return;
      styles.set(program, style);
      window.fireworkGpu.links[style]++;
    });
    wrap("generateMipmap", () => window.fireworkGpu.mipmaps++);
    for (const name of ["drawArrays", "drawElements"]) {
      wrap(name, function () {
        const style = styles.get(this.getParameter(this.CURRENT_PROGRAM));
        if (style !== undefined) window.fireworkGpu.draws[style]++;
      });
    }
  });
  await page.goto(base + "/tests/host.html");
  const defaults = await page.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs");
    window.preview = createPreview(document.getElementById("one"), {
      resolution: { width: 640, height: 360 }, diagnostics: false, controls: false,
    });
    await preview.ready;
    return (await preview.getState()).settings;
  });
  assert.equal(defaults.fireworkStyle, 0);
  assert.equal(defaults.fireworkBrightness, 1);
  assert.equal(packs.size, 0, "blank startup fetches no deferred resource packs");
  const frame = page.frames().find(frame => frame.url().includes("/renderer/index.html"));
  const gpu = () => frame.evaluate(() => window.fireworkGpu);
  const settled = () => frame.evaluate(async () => {
    for (let i = 0; i < 4; i++) await new Promise(resolve => requestAnimationFrame(resolve));
  });
  const seek = async second => {
    await page.evaluate(second => preview.seek(second), second);
    await settled();
  };
  const capture = () => frame.locator(".qt-window-canvas").screenshot();
  const ready = await gpu();
  assert.ok(ready.links[0] > 0 && ready.draws[0] > 0, "Standard submitted a warm-up draw before ready");
  assert.equal(ready.draws[1], 0);

  await page.evaluate(async maidata => {
    await preview.setSettings({ showTimestamp: false, showChartInfoHud: false, showObjectStatsHud: false });
    await preview.load({ maidata, difficulty: 5 });
  }, chart);
  assert.deepEqual([...packs].sort(), ["miacode-skins.rcc", "miacode-slides.rcc"]);
  await settled();
  assert.equal((await gpu()).draws[0], ready.draws[0], "idle Standard reuses its warm-up node");

  const rendered = [];
  for (const style of [0, 1]) {
    await seek(0);
    const before = await gpu();
    const settings = await page.evaluate(fireworkStyle => preview.setSettings({ fireworkStyle }), style);
    assert.equal(settings.fireworkStyle, style);
    await settled();
    const warmed = await gpu();
    assert.ok(warmed.links[style] > 0);
    if (style === 1) {
      assert.ok(warmed.draws[1] > before.draws[1], "Modern submits a warm-up draw after switching");
      assert.equal(warmed.mipmaps, before.mipmaps + 1, "Modern warms the big-ball mipmap");
    }

    // Center and off-center Touch, then Touch Hold at its end.
    for (const [active, idle] of [[2.233, 3.65], [4.233, 5.65], [6.733, 8.15]]) {
      const previous = await gpu();
      if (active === 6.733) {
        await seek(6.2);
        assert.equal((await gpu()).draws[style], previous.draws[style], "Touch Hold waits for its end");
      }
      await seek(active);
      const burst = await gpu();
      assert.ok(burst.draws[style] > previous.draws[style], `style ${style} draws at ${active}s`);
      assert.equal(burst.mipmaps, warmed.mipmaps, "bursts reuse textures");
      assert.equal(burst.links[style], warmed.links[style], "bursts reuse shader programs");
      await seek(idle);
      assert.equal((await gpu()).draws[style], burst.draws[style], "idle frames suppress firework draws");
    }

    const beforeTail = (await gpu()).draws[style];
    await seek(3.3);
    assert.equal((await gpu()).draws[style] > beforeTail, style === 0, "each style uses its own duration");

    await seek(2.15);
    const first = await capture();
    await seek(3.65);
    await seek(2.15);
    assert.ok((await capture()).equals(first), `style ${style} replays with the same star layout`);
    await page.evaluate(() => preview.setSettings({ fireworkBrightness: .5 }));
    await settled();
    assert.ok(!(await capture()).equals(first), `brightness changes the rendered burst for style ${style}`);
    await page.evaluate(() => preview.setSettings({ fireworkBrightness: 1 }));
    rendered.push(first);
  }
  assert.ok(!rendered[0].equals(rendered[1]), "the two styles produce distinct preview frames");

  // Reload scene assets and switch styles during a burst.
  const beforeSkin = (await gpu()).draws[0];
  await page.evaluate(() => preview.setSettings({ noteSkin: "SD", fireworkStyle: 0 }));
  await seek(2.233);
  assert.ok((await gpu()).draws[0] > beforeSkin, "the active burst uses Standard after changing skin and style");

  await page.evaluate(() => preview.setSettings({ showTimestamp: false, showChartInfoHud: false, showObjectStatsHud: false }));
  const overlap = chart.slice(0, chart.indexOf("(120)")) + "(120){1},{8}Cf,B1f,{1},,,E";
  const loadChart = maidata => page.evaluate(maidata => preview.load({ maidata, difficulty: 5 }), maidata);
  for (const fireworkStyle of [0, 1]) {
    await page.evaluate(fireworkStyle => preview.setSettings({ fireworkStyle }), fireworkStyle);
    await loadChart(overlap);
    await seek(2.55);
    const overlapping = await capture();
    await loadChart(overlap.replace("Cf,", "C,"));
    await seek(2.55);
    assert.ok((await capture()).equals(overlapping), `overlapping bursts use the latest trigger for style ${fireworkStyle}`);
  }
  await loadChart(chart);

  const exportFrames = await page.evaluate(async () => {
    const backdrop = document.createElement("canvas");
    backdrop.width = 64; backdrop.height = 64;
    const paint = backdrop.getContext("2d");
    paint.fillStyle = "#b0b0b0";
    paint.fillRect(0, 0, 64, 64);
    await preview.setResources({ cover: await new Promise(resolve => backdrop.toBlob(resolve)) });
    const options = { width: 320, height: 180, fps: 30, exportStartSeconds: 1.9, exportEndSeconds: 2.45 };
    const media = await import("/renderer/vendor/mediabunny/index.mjs");
    const frames = [];
    for (const fireworkStyle of [0, 1]) {
      await preview.setSettings({ fireworkStyle, outerBrightness: 1, innerBrightness: 1 });
      const output = new Promise((resolve, reject) => {
        const release = () => { completed(); failed(); };
        const completed = preview.on("exportCompleted", event => { release(); resolve(event); });
        const failed = preview.on("exportFailed", event => { release(); reject(new Error(event.message)); });
      });
      await preview.startExport(options);
      const result = await output;
      const input = new media.Input({ source: new media.BlobSource(result.blob), formats: media.ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack(), sink = new media.VideoSampleSink(track);
        const canvas = document.createElement("canvas");
        canvas.width = options.width; canvas.height = options.height;
        const context = canvas.getContext("2d");
        const sample = await sink.getSample(result.duration - .2);
        sample.draw(context, 0, 0); sample.close();
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 40) colored++;
        }
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", pixels))].join(",");
        frames.push({ hash, colored });
      } finally { input.dispose(); }
    }
    return frames;
  });
  assert.ok(exportFrames.every(frame => frame.colored > 100), JSON.stringify(exportFrames));
  assert.notEqual(exportFrames[0].hash, exportFrames[1].hash, "encoded video respects the selected style");
  assert.ok(!packs.has("miacode-hud.rcc"), "video export with HUD off needs no HUD fonts");
  assert.ok(!packs.has("miacode-export.rcc"), "plain video export needs no intro assets");

  const covers = await page.evaluate(async maidata => {
    await preview.setCoverChart({ maidata, difficulty: 5 }, { duration: 10 });
    await preview.setCoverComposition({ outputWidth: 360, outputHeight: 360 });
    const composition = await preview.coverCommand("cover.addChartFrameLayer", {});
    const key = composition.activeLayerKey;
    await preview.coverCommand("cover.layer", { key: "card", visible: false });
    await preview.coverCommand("cover.layer", { key, sizeFraction: .9, frameSeconds: 2.233 });
    const captures = [];
    for (const fireworkStyle of [0, 1]) {
      await preview.setSettings({ fireworkStyle });
      await preview.setCoverChart({ maidata, difficulty: 5 }, { duration: 10 });
      await preview.setCoverComposition({});
      const { blob } = await preview.exportCover({ type: "image/png" });
      captures.push([...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].join(","));
    }
    return captures;
  }, chart);
  assert.notEqual(covers[0], covers[1], "cover chart frames respect the selected style");
  assert.ok(packs.has("miacode-export.rcc"), "opening the cover mounts export assets");
  assert.ok(!packs.has("miacode-hud.rcc"), "cover chart frames need no HUD fonts");
  await page.evaluate(() => preview.destroy());
  assert.deepEqual(errors, []);

  const failurePage = await browser.newPage();
  await failurePage.route("**/miacode-preview.wasm?*", route => route.fulfill({ status: 503 }));
  await failurePage.goto(base + "/tests/host.html");
  await assert.rejects(failurePage.evaluate(async () => {
    const { createPreview } = await import("/sdk/index.mjs");
    const preview = createPreview(document.getElementById("one"), { timeoutMs: 5000 });
    try { await preview.ready; }
    finally { preview.destroy(); }
  }), /播放器文件加载或校验失败/);

  console.log("Standard and Modern firework warm-up, idle, deterministic replay, brightness, SDK, video and cover passed.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

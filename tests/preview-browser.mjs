import assert from "node:assert/strict";

export async function launchPreviewBrowser(playwright, name) {
  const channel = name === "chrome" || name === "msedge" ? name : undefined;
  const type = channel ? playwright.chromium : playwright[name];
  return type.launch({
    headless: true,
    ...(channel ? { channel } : {}),
    ...(name === "firefox" ? {
      // CI runners use Mesa software rendering for Qt's WebGL2 surface.
      firefoxUserPrefs: { "webgl.force-enabled": true },
      ...(process.platform === "linux" ? {
        env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: "1" },
      } : {}),
    } : {}),
  });
}

export async function previewGraphics(page, name) {
  const graphics = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    let creationError = "";
    canvas.addEventListener("webglcontextcreationerror", event => {
      creationError = event.statusMessage;
    });
    const gl = canvas.getContext("webgl2");
    if (!gl) return { webgl2: false, creationError };
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { webgl2: true, renderer };
  });
  assert.ok(graphics.webgl2, `${name}: WebGL2 unavailable: ${graphics.creationError}`);
  console.log(`${name}: WebGL2 renderer ${graphics.renderer}`);
  return graphics;
}

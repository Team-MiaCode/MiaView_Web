import { createPreview } from "../sdk/index.mjs";

// The development website uses only the component's public SDK.
export function createDevPreviewHost({ status, onMount }) {
  const $ = (id) => document.getElementById(id);
  let preview, active = false;
  function destroy() {
    preview?.destroy();
    active = false;
  }
  async function mount() {
    destroy();
    const [width, height] = $("resolution").value.split("x").map(Number);
    $("preview").style.maxWidth = width === height ? "720px" : "960px";
    $("workspace").style.setProperty("--preview-max-width", $("preview").style.maxWidth);
    const instance = createPreview($("preview"), {
      rendererUrl: $("renderer-url").value.trim() || undefined,
      timeoutMs: Number($("sdk-timeout").value),
      pvTimeoutMs: $("pv-timeout").value.trim() === "unlimited" ? "unlimited" : Number($("pv-timeout").value) * 1000,
      resolution: { width, height },
      diagnostics: $("diagnostics-enabled").checked,
      maxFps: $("max-fps").value === "unlimited" ? "unlimited" : Number($("max-fps").value),
    });
    preview = instance;
    onMount(instance);
    instance.on("error", (event) => { if (instance === preview) status(event.message); });
    instance.on("progress", (event) => { if (instance === preview) status(event.stage); });
    status("正在创建播放器…");
    await instance.ready;
    if (instance !== preview) return;
    active = true;
    status("请选择谱面文件夹");
  }
  async function load(chart) {
    const instance = preview;
    status("正在通过 HTTP URL 加载谱面…");
    await instance.ready;
    const info = await instance.load(chart);
    if (instance !== preview) return;
    status(`已加载：${info.title || "未命名谱面"}，点击播放器内的播放按钮开始`);
  }
  return { mount, load, destroy, get preview() { return preview; }, get active() { return active; } };
}

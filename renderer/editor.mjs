import { createWorkbench } from "../app.mjs";
import { attachSdkBridge } from "./sdk-bridge.mjs";
import { previewTheme } from "./protocol.mjs";

const parameters = new URLSearchParams(location.search);
const root = document.createElement("main");
root.id = "workbench"; root.className = "workbench"; root.setAttribute("aria-label", "MiaCode 谱面编辑器");
document.body.append(root);
const editor = createWorkbench(root, { preview: {
  resolution: { width: Number(parameters.get("width") || 1080), height: Number(parameters.get("height") || 1080) },
  maxFps: parameters.get("maxFps") === "unlimited" ? "unlimited" : Number(parameters.get("maxFps") || 60),
  pvTimeoutMs: parameters.get("pvTimeoutMs") === "unlimited" ? "unlimited" : Number(parameters.get("pvTimeoutMs") || 30000),
  diagnostics: parameters.get("diagnostics") !== "0",
} });
root.editor = editor;
let identity;
const boot = Promise.all([editor.ready, fetch(new URL("build-identity.json", import.meta.url), { cache: "no-store" })
  .then(response => { if (!response.ok) throw new Error("编辑器构建身份读取失败"); return response.json(); })])
  .then(async ([, value]) => {
    identity = value;
    const theme = previewTheme(parameters.get("theme") || "dark");
    const light = theme === "light" || theme === "legacy_light";
    editor.viewState.setPreferences({ themeModeToken: light ? "light" : "dark", [light ? "lightThemeToken" : "darkThemeToken"]: theme });
    await editor.preview.setTheme(theme);
  });
void boot.catch(error => editor.workbench.status(error.message));
attachSdkBridge({ boot, identity: () => identity, state: () => editor.preview.getState(), fail: error => editor.workbench.status(error.message) }, {
  commands: new Set(["initialize", "load", "workbenchCommand", "getDocument", "getDocumentSaveText", "getState"]),
  events(listener) {
    let closed = false;
    const unsubscribe = [];
    void editor.ready.then(() => {
      if (closed) return;
      for (const type of ["progress", "playing", "paused", "ended", "error", "seeked", "settingsChanged", "playbackChanged", "timeupdate", "coverChanged", "coverPlaybackChanged", "touchPadAuthoring", "documentChanged", "shortcutInput", "exportProgress", "introAuditionChanged", "exportPreviewChanged", "exportCompleted", "exportFailed", "performance"])
        unsubscribe.push(editor.preview.on(type, payload => listener(type, payload)));
    }).catch(() => {});
    return () => { closed = true; for (const stop of unsubscribe) stop(); };
  },
  async execute(type, payload = {}) {
    await boot;
    if (type === "load") {
      await editor.load({ ...payload, maidata: typeof payload.maidata?.text === "string" ? payload.maidata.text : payload.maidata });
      return editor.getDocument();
    }
    if (type === "workbenchCommand") { await editor.command(payload.id, payload.args); return; }
    if (type === "getDocument") return editor.getDocument();
    if (type === "getDocumentSaveText") return editor.getDocumentSaveText(payload.section);
    if (type === "getState") return editor.preview.getState();
    throw new Error(`编辑器命令无效：${type}`);
  },
});
window.addEventListener("pagehide", () => editor.destroy(), { once: true });

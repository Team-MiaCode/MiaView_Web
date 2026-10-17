import { createPreview } from "./index.mjs";

export function createEditor(container, options = {}) {
  const transport = createPreview(container, { resolution: { width: 1080, height: 1080 }, ...options, layout: "fit", controls: false,
    allow: "autoplay; fullscreen; clipboard-read; clipboard-write",
    sandbox: "allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox",
    rendererUrl: options.rendererUrl ?? new URL("../renderer/editor.html", import.meta.url).href });
  transport.iframe.title = "MiaCode Web 谱面编辑器";
  const editor = {
    ready: transport.ready.then(() => editor),
    load: chart => transport.load(chart),
    command: (id, args = {}) => transport.command("workbenchCommand", { id, args }),
    getDocument: () => transport.getDocument(),
    getDocumentSaveText: (section = 0) => transport.getDocumentSaveText(section),
    getState: () => transport.getState(),
    on: (type, listener) => transport.on(type, listener),
    destroy: () => transport.destroy(),
  };
  void editor.ready.catch(() => {});
  return editor;
}

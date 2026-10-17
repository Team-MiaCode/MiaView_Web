import { createEditor } from "../sdk/editor.mjs";

const status = document.getElementById("status");
const editor = createEditor(document.getElementById("editor"), { diagnostics: false });
editor.on("error", event => { status.textContent = event.message; });
editor.on("documentChanged", document => { status.textContent = `${document.title} · 版本 ${document.revision}`; });
document.getElementById("load").addEventListener("click", () => {
  void editor.load({ maidata: "&title=Editor SDK\n&lv_5=12\n&inote_5=(120){4}1,2,3,4,5,6,7,8,E" })
    .catch(error => { status.textContent = error.message; });
});
document.getElementById("save").addEventListener("click", () => {
  void editor.getDocumentSaveText().then(result => { status.textContent = result.sourceText; })
    .catch(error => { status.textContent = error.message; });
});
void editor.ready.then(() => { status.textContent = "编辑器就绪"; }).catch(error => { status.textContent = error.message; });
window.addEventListener("pagehide", () => editor.destroy(), { once: true });

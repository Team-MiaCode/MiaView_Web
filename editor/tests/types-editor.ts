import { createEditor, type MiaCodeEditor } from "../sdk/editor.mjs";
const editor: MiaCodeEditor = createEditor(document.createElement("div"), { theme: "light", pvTimeoutMs: "unlimited" });
void editor.load({ maidata: new Blob(["&inote_5=(120)1,E"]), audio: { url: "./track.wav" } });
void editor.command("document.metadataTitle", { value: "Example" });
void editor.getDocument().then(document => document.revision);
void editor.getDocumentSaveText().then(document => document.sourceText);
void editor.getState().then(state => state.playing);
editor.on("documentChanged", document => document.activeDifficultyId);
// @ts-expect-error The event map is shared with the preview SDK.
editor.on("unknown", () => {});
// @ts-expect-error Editor layout fills its container.
createEditor(document.createElement("div"), { layout: "intrinsic" });
editor.destroy();

import { element as h } from "../components/dom.mjs";
import { translate } from "../components/translate.mjs";

export class DifficultyHeader {
  constructor(command, language) {
    this.language = language;
    this.fields = [];
    this.root = h("div", { className: "difficulty-header" });
    for (const [field, key, width, commit] of [
      ["currentDifficultyLevel", "qml.level", 48, "input"],
      ["currentDifficultyOffset", "qml.offset", 64, "change"],
      ["currentDifficultyDesigner", "net.designer", 100, "input"],
    ]) {
      const caption = h("span");
      const input = h("input", { type: "text", name: field, style: `--field-width: ${width}px` });
      input.addEventListener(commit, () => command(`document.${field}`, { value: input.value }));
      this.root.append(h("label", { className: `difficulty-header-field${field === "currentDifficultyDesigner" ? " designer" : ""}` }, caption, input));
      this.fields.push({ field, key, caption, input });
    }
  }
  update(doc) {
    for (const { field, key, caption, input } of this.fields) {
      const label = translate(key, this.language());
      caption.textContent = label;
      input.setAttribute("aria-label", label);
      if (document.activeElement !== input) input.value = doc[field] ?? "";
    }
  }
}

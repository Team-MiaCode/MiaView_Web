import { element as h, button } from "../components/dom.mjs";
import { toggle } from "../components/forms.mjs";
import { translate } from "../components/translate.mjs";

export class FindReplaceBar {
  constructor({ command, dismiss, language }) {
    const t = key => translate(key, language());
    this.query = h("input", { placeholder: t("metadata.find"), "aria-label": t("metadata.find") });
    this.replacement = h("input", { placeholder: t("metadata.replace"), "aria-label": t("metadata.replace") });
    this.caseSensitive = false;
    this.wholeWord = false;
    const action = id => command(id, {
      query: this.query.value, replacement: this.replacement.value,
      caseSensitive: this.caseSensitive, wholeWord: this.wholeWord,
    });
    this.root = h("div", { className: "find-replace-bar native-form", hidden: true, role: "search", "aria-label": t("metadata.find") },
      h("div", { className: "find-search-area" }, this.query, this.replacement,
        toggle(t("qml.match_case"), false, value => { this.caseSensitive = value; }),
        toggle(t("qml.whole_words"), false, value => { this.wholeWord = value; })),
      h("div", { className: "find-actions" },
        button(t("qml.previous"), () => action("edit.findPrevious")),
        button(t("qml.next"), () => action("edit.findNext")),
        button(t("metadata.replace"), () => action("edit.replaceAndFind"), { className: "primary" }),
        button(t("metadata.replace_all"), () => action("edit.replaceAll"), { className: "primary" }),
        button(t("action.close"), dismiss, { symbol: "close", iconOnly: true, className: "chrome find-close" })));
    this.root.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); }
      if (event.key === "Enter" && event.target === this.query) { event.preventDefault(); action(event.shiftKey ? "edit.findPrevious" : "edit.findNext"); }
      if (event.key === "Enter" && event.target === this.replacement) { event.preventDefault(); action("edit.replaceAndFind"); }
    });
  }
  show(selection) {
    if (selection) this.query.value = selection;
    this.root.hidden = false;
    this.query.focus();
    this.query.select();
  }
  hide() { this.root.hidden = true; }
}

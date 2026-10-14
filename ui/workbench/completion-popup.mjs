import { element as h, button } from "../components/dom.mjs";

export class CompletionPopup {
  constructor(host, command) {
    this.host = host;
    this.command = command;
    this.root = h("div", { className: "completion-popup", role: "listbox", "aria-label": "输入补全", hidden: true });
    host.append(this.root);
    this.root.addEventListener("pointerdown", event => event.preventDefault());
  }
  update({ completionActive, completionCandidates, completionIndex }, caret) {
    this.root.hidden = !completionActive || !completionCandidates.length;
    if (this.root.hidden) return;
    this.root.replaceChildren(...completionCandidates.map((text, index) => button(text, () => this.command("edit.acceptCompletion", { index }), {
      className: "completion-candidate", role: "option", tabIndex: -1, "aria-selected": String(index === completionIndex),
    })));
    this.root.style.left = `${Math.max(0, Math.min(caret.left, this.host.clientWidth - this.root.offsetWidth))}px`;
    const below = caret.top + caret.height;
    const top = below + this.root.offsetHeight <= this.host.clientHeight ? below : caret.top - this.root.offsetHeight;
    this.root.style.top = `${Math.max(0, Math.min(top, this.host.clientHeight - this.root.offsetHeight))}px`;
    const selected = this.root.querySelector('[aria-selected="true"]');
    if (selected) {
      if (selected.offsetTop < this.root.scrollTop) this.root.scrollTop = selected.offsetTop;
      else if (selected.offsetTop + selected.offsetHeight > this.root.scrollTop + this.root.clientHeight) this.root.scrollTop = selected.offsetTop + selected.offsetHeight - this.root.clientHeight;
    }
  }
  destroy() { this.root.remove(); }
}

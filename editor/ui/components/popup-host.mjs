import { element as h, button, icon } from "./dom.mjs";

export class PopupHost {
  constructor(root, execute) {
    this.root = root; this.execute = execute; this.document = root.ownerDocument;
    this.abort = new AbortController();
    this.document.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.menu) { event.preventDefault(); this.closeMenu(); }
    }, { signal: this.abort.signal });
  }
  showMenu(trigger, items, options = {}) {
    if (this.menuTrigger === trigger) return this.closeMenu();
    const popup = h("div", { className: "popover", role: "menu" });
    if (options.className) popup.classList.add(options.className);
    for (const item of items) {
      if (!item) { popup.append(h("hr")); continue; }
      const entry = button(item[0], () => { this.closeMenu(); this.execute(item[1], item[3]); }, { className: "nav-row", role: "menuitem" });
      if (item[4]) {
        entry.setAttribute("role", item[4].role);
        entry.setAttribute("aria-checked", String(item[4].checked));
        entry.prepend(h("span", { className: "menu-check", "aria-hidden": "true" }, item[4].checked ? icon("check", 14) : null));
      }
      if (item[1] === "document.addDifficulty") entry.prepend(h("span", { className: "difficulty-swatch", style: `background: var(--difficulty-${item[3].difficulty})`, "aria-hidden": "true" }));
      if (item[2]) entry.append(h("span", { className: "shortcut", "aria-hidden": "true" }, item[2]));
      popup.append(entry);
    }
    popup.addEventListener("keydown", event => {
      const entries = [...popup.querySelectorAll("button")];
      const index = entries.indexOf(this.document.activeElement);
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length;
        entries[next]?.focus();
      } else if (event.key === "Tab") this.closeMenu();
    });
    this.openPopup(trigger, popup, options);
  }
  openPopup(trigger, popup, { above = false, alignEnd = false } = {}) {
    if (this.menuTrigger === trigger) return this.closeMenu();
    this.closeMenu();
    const anchor = trigger.getBoundingClientRect();
    const style = this.document.defaultView.getComputedStyle(this.root);
    popup.style.fontFamily = style.fontFamily;
    popup.style.setProperty("--ui-font-family", style.fontFamily);
    popup.style.setProperty("--ui-font-size", style.getPropertyValue("--ui-font-size"));
    popup.style.fontSize = "var(--ui-font-size)";
    this.document.body.append(popup);
    popup.style.left = `${Math.max(8, Math.min(alignEnd ? anchor.right - popup.offsetWidth : anchor.left, this.document.defaultView.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(above ? anchor.top - popup.offsetHeight : anchor.bottom + 3, this.document.defaultView.innerHeight - popup.offsetHeight - 8))}px`;
    this.menu = popup;
    this.menuTrigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    popup.querySelector("button,input")?.focus();
    this.outsideMenu = event => { if (!popup.contains(event.target) && event.target !== trigger && !trigger.contains(event.target)) this.closeMenu(); };
    this.document.addEventListener("pointerdown", this.outsideMenu);
  }
  closeMenu() {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    const trigger = this.menuTrigger;
    this.menuTrigger = null;
    trigger?.setAttribute("aria-expanded", "false");
    trigger?.focus();
    this.document.removeEventListener("pointerdown", this.outsideMenu);
  }
  destroy() { this.closeMenu(); this.abort.abort(); }
}

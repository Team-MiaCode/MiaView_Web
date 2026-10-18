import { element as h, button } from "./dom.mjs";

export function settingsTabs(sections, initial, select) {
  const root = h("div", { className: "settings-form native-form" });
  const bar = h("div", { className: "settings-tabs", role: "tablist" });
  const body = h("div", { className: "settings-tab-content", role: "tabpanel" });
  let active = initial ?? sections[0].key;
  function render(key) {
    active = key;
    select?.(key);
    for (const node of bar.children) {
      const selected = node.dataset.page === key;
      node.setAttribute("aria-selected", String(selected));
      node.tabIndex = selected ? 0 : -1;
    }
    body.replaceChildren(...sections.find(section => section.key === key).render());
  }
  for (const section of sections) bar.append(button(section.label, () => render(section.key), { role: "tab", dataset: { page: section.key } }));
  bar.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = sections.findIndex(section => section.key === active);
    const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + sections.length) % sections.length;
    render(sections[next].key); bar.children[next].focus();
  });
  root.append(bar, h("hr", { className: "settings-rule" }), body);
  root.refresh = () => render(active);
  render(active);
  return root;
}

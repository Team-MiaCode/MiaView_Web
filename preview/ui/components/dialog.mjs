import { element as h, button } from "./dom.mjs";

export function openDialog(host, { title, body, actions, width = 460, height = 360, close, opener = document.activeElement }) {
  const dialog = h("dialog", { className: "workbench-dialog native-form", "aria-label": title, tabIndex: -1 });
  dialog.style.width = `${width}px`;
  dialog.style.height = `${height}px`;
  const footer = h("footer", { className: "dialog-footer" });
  for (const action of actions) footer.append(button(action.label, () => {
    action.run?.();
    if (action.close !== false) dialog.close(action.value || "");
  }, { className: action.primary ? "primary" : "" }));
  dialog.append(h("h2", { className: "dialog-heading" }, title), h("div", { className: "dialog-body" }, body), footer);
  dialog.addEventListener("close", () => { close?.(dialog.returnValue); dialog.remove(); if (opener?.isConnected) opener.focus(); }, { once: true });
  host.append(dialog);
  dialog.showModal();
  dialog.focus();
  return dialog;
}

import { element as h, field, selectControl } from "./dom.mjs";

export function select(options, value, change) {
  const node = h("select", { onChange: () => change?.(node.value) }, options.map(item => {
    const [id, label] = Array.isArray(item) ? item : [item, item];
    return h("option", { value: id, selected: String(id) === String(value) }, label);
  }));
  return selectControl(node);
}
export function number(name, value, command, options = {}) {
  const { format = String, ...attributes } = options;
  const node = h("input", { type: "number", value, step: "any", ...attributes });
  let current = Number(value);
  node.addEventListener("change", () => {
    const parsed = node.valueAsNumber;
    if (Number.isNaN(parsed)) { node.value = format(current); return; }
    current = parsed;
    if (node.min !== "") current = Math.max(Number(node.min), current);
    if (node.max !== "") current = Math.min(Number(node.max), current);
    node.value = format(current);
    command(name, { value: current });
  });
  return node;
}
export function text(name, value, command) {
  const node = h("input", { value: value ?? "" });
  node.addEventListener("change", () => command(name, { value: node.value }));
  return node;
}
export function check(label, checked, change) {
  const input = h("input", { type: "checkbox", checked });
  input.addEventListener("change", () => change(input.checked));
  return h("label", { className: "field inline" }, input, h("span", {}, label));
}
export function toggle(label, checked, change, id) {
  const node = check(label, checked, change);
  node.classList.add("switch-control");
  const input = node.querySelector("input");
  input.setAttribute("role", "switch");
  if (id) input.id = id;
  return node;
}
export function range(label, name, value, min, max, command, step = 1, suffix = "", format = value => String(value)) {
  const output = h("output", {}, `${value}${suffix}`);
  const input = h("input", { type: "range", min, max, step, value, "aria-label": label });
  const update = () => {
    output.value = `${format(Number(input.value))}${suffix}`;
    output.setAttribute("aria-label", `${label} ${output.value}`);
    input.style.setProperty("--range-value", `${(Number(input.value) - min) / (max - min) * 100}%`);
  };
  update();
  input.addEventListener("input", () => { update(); command(name, { value: Number(input.value) }); });
  const editValue = () => {
    if (output.querySelector("input")) return;
    const edit = h("input", { className: "range-readout-input", type: "number", min, max, step, value: input.value, "aria-label": label });
    const commit = () => {
      if (!edit.isConnected) return;
      if (edit.value !== "" && edit.validity.valid) input.value = edit.value;
      update();
      command(name, { value: Number(input.value) });
      output.focus();
    };
    edit.addEventListener("blur", commit, { once: true });
    edit.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      else if (event.key === "Escape") { event.preventDefault(); update(); output.focus(); }
    });
    output.replaceChildren(edit);
    edit.focus(); edit.select();
  };
  output.tabIndex = 0;
  output.addEventListener("dblclick", editValue);
  output.addEventListener("keydown", event => { if (event.target === output && event.key === "Enter") { event.preventDefault(); editValue(); } });
  return field(label, h("div", { className: "range-field" }, input, output));
}
export function formRow(label, input, action) {
  const control = input.matches("input,select,textarea") ? input : input.querySelector("input,select,textarea");
  control?.setAttribute("aria-label", label);
  return h("div", { className: `form-row${action ? " with-action" : ""}` }, h("span", { className: "form-label" }, label), input, action);
}

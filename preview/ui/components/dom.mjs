export function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "className") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && !key.startsWith("aria")) node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function icon(name, size = 16) {
  const node = element("span", { className: "icon", "aria-hidden": "true", dataset: { icon: name } });
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  node.style.maskImage = `url("${new URL(`./icons/${name}.svg`, import.meta.url).href}")`;
  return node;
}

export function button(label, action, { symbol, className = "", iconOnly = false, ...attributes } = {}) {
  return element("button", { type: "button", className, title: label, "aria-label": label, onClick: action, ...attributes }, symbol ? icon(symbol) : null, iconOnly ? null : label);
}

export function field(label, input, help) {
  return element("label", { className: "field" }, element("span", { className: "field-label" }, label), input, help ? element("span", { className: "caption" }, help) : null);
}

export function selectControl(input) {
  return element("span", { className: "select-control" }, input);
}

export function section(title, ...children) {
  return element("section", { className: "settings-section" }, element("h2", {}, title), ...children);
}

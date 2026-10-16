const modifierBits = { Shift: 0x2000000, Control: 0x4000000, Alt: 0x8000000, Meta: 0x10000000 };
const specialKeys = { Escape: 0x1000000, Tab: 0x1000001, Backspace: 0x1000003, Enter: 0x1000004,
  Insert: 0x1000006, Delete: 0x1000007, Pause: 0x1000008, PrintScreen: 0x1000009,
  Home: 0x1000010, End: 0x1000011, ArrowLeft: 0x1000012, ArrowUp: 0x1000013,
  ArrowRight: 0x1000014, ArrowDown: 0x1000015, PageUp: 0x1000016, PageDown: 0x1000017,
  Shift: 0x1000020, Control: 0x1000021, Meta: 0x1000022, Alt: 0x1000023 };
const keyLabels = { Escape: "Esc", Enter: "Return", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down",
  PageUp: "PgUp", PageDown: "PgDown", Control: "Ctrl", " ": "Space" };

export function shortcutInput(event) {
  let modifiers = (event.shiftKey ? modifierBits.Shift : 0) | (event.ctrlKey ? modifierBits.Control : 0)
    | (event.altKey ? modifierBits.Alt : 0) | (event.metaKey ? modifierBits.Meta : 0);
  const wheel = event.type === "wheel" ? Math.sign(event.deltaY || event.deltaX) : 0;
  let keyName = event.key || "";
  if (event.code === "Equal") keyName = "=";
  if (event.code === "Minus") keyName = "-";
  const key = specialKeys[keyName] || (/^F([1-9]|[12]\d|3[0-5])$/.test(keyName) ? 0x100002f + Number(keyName.slice(1))
    : keyName.length === 1 ? keyName.toUpperCase().codePointAt(0) : 0);
  if (modifierBits[keyName]) modifiers &= ~modifierBits[keyName];
  const parts = Object.entries(modifierBits).filter(([, bit]) => modifiers & bit).map(([name]) => name === "Control" ? "Ctrl" : name);
  if (wheel) parts.push(wheel < 0 ? "WheelUp" : "WheelDown");
  else if (key) parts.push(keyLabels[keyName] || (keyName.length === 1 ? keyName.toUpperCase() : keyName));
  return { key, modifiers, wheelDirection: wheel, text: parts.join("+"), modifierOnly: Boolean(modifierBits[keyName]) };
}

export function matchesShortcut(binding, input) {
  if (!binding?.canonicalText) return false;
  if (binding.wheelDirection) return binding.wheelDirection === input.wheelDirection && binding.modifiers === input.modifiers;
  if (input.wheelDirection) return false;
  if (binding.key === 43 && input.key === 61 && input.modifiers & modifierBits.Shift)
    return binding.modifiers === (input.modifiers & ~modifierBits.Shift);
  return binding.key === input.key && binding.modifiers === input.modifiers;
}

import { shortcutDefinitions } from "../ui/components/shortcut-definitions.mjs";

import { shortcutInput, matchesShortcut } from "../renderer/input-shortcut.mjs";
export { shortcutInput, matchesShortcut };

const fileShortcuts = { "file.new": "Ctrl+Alt+N", "file.open": "Ctrl+Shift+O", "file.save": "Ctrl+S", "file.saveAll": "Ctrl+Shift+S" };

export class WorkbenchShortcuts {
  constructor({ root, normalize, execute, enabled, changed, error, signal }) {
    Object.assign(this, { root, normalize, execute, enabled, changed, error });
    this.bindings = {}; this.overrides = {}; this.held = false; this.pending = Promise.resolve();
    const document = root.ownerDocument;
    document.addEventListener("keydown", event => this.input(event), { capture: true, signal });
    document.addEventListener("keyup", event => this.input(event), { capture: true, signal });
    document.addEventListener("wheel", event => this.input(event), { capture: true, passive: false, signal });
    document.defaultView.addEventListener("blur", () => this.releaseHeld(), { signal });
    signal.addEventListener("abort", () => this.releaseHeld(), { once: true });
  }
  configure(overrides = {}) { return this.update(() => overrides); }
  update(change) {
    const operation = this.pending.then(() => this.applyConfiguration(change(this.overrides)));
    this.pending = operation.catch(() => {});
    return operation;
  }
  async applyConfiguration(overrides) {
    const sequences = { ...fileShortcuts, ...Object.fromEntries(shortcutDefinitions.map(row => [row.id, overrides[row.id] ?? row.defaultText])) };
    const bindings = await this.normalize(sequences);
    this.bindings = bindings;
    this.overrides = Object.fromEntries(shortcutDefinitions.filter(row => Object.hasOwn(overrides,row.id)).map(row => [row.id,bindings[row.id].canonicalText]));
    this.changed(shortcutDefinitions.map(row => ({ ...row, shortcutText: bindings[row.id].displayText,
      isDefault: bindings[row.id].canonicalText === row.defaultText })));
    return bindings;
  }
  async set(id, text) {
    if (!shortcutDefinitions.some(row => row.id === id)) throw new Error("快捷键标识无效");
    return this.update(values => ({ ...values, [id]: text }));
  }
  reset(id) {
    return this.update(current => { const values = { ...current }; delete values[id]; return values; });
  }
  run(id, args) { void Promise.resolve(this.execute(id, args)).catch(this.error); }
  releaseHeld() {
    if (!this.held) return;
    this.held = false; this.run("preview.pause_display_hold", { active: false });
  }
  remoteInput({ id, phase }, target) {
    if (id === "preview.pause_display_hold" && phase === "keyup") { this.releaseHeld(); return; }
    if (this.capture || !this.enabled(id,{type:"keydown",target})) return;
    if (id === "preview.pause_display_hold") {
      if (this.held) return;
      this.held = true; this.holdKey = this.bindings[id].key; this.run(id,{active:true});
    } else this.run(id,{});
  }
  input(event, root = this.root, allowed = () => true) {
    if (event.type === "keyup" && this.held && shortcutInput(event).key === this.holdKey) this.releaseHeld();
    if (!root.contains(event.target) || event.isComposing) return;
    const input = shortcutInput(event);
    if (this.capture) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === "Escape") { this.capture(null); return; }
      if (event.type === "keydown" && input.modifierOnly) this.captureHasKey = false;
      if (!event.repeat && (event.type === "wheel" || event.type === "keydown" && !input.modifierOnly || event.type === "keyup" && input.modifierOnly && !this.captureHasKey)) {
        this.captureHasKey = true;
        this.capture(input.text);
      }
      return;
    }
    if (event.type === "keyup" || event.defaultPrevented || event.target.closest("dialog") || !input.key && !input.wheelDirection) return;
    const candidates = Object.entries(this.bindings).filter(([id,binding]) => allowed(id) && matchesShortcut(binding,input) && this.enabled(id,event));
    if (!candidates.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (candidates.length > 1) { this.error(new Error("组合键对应多个快捷键，请调整绑定")); return; }
    const id = candidates[0][0];
    if (id === "preview.play_pause_global" && event.repeat) return;
    if (id === "preview.pause_display_hold") {
      if (this.held) return;
      this.held = true; this.holdKey = input.key; this.run(id,{ active: true });
    } else this.run(id,{});
  }
}

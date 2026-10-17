import { createPreview } from "../sdk/index.mjs";

// The SDK and postMessage sender share the window that owns the iframe.
const resourceMethods = new Set(["load", "setResources", "importFont", "importSkin", "importJudgeLine", "setIntroAudition"]);
window.miacodePreviewWindow = { createPreview(container, options) {
  const preview = createPreview(container, options);
  return new Proxy(preview, { get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== "function") return value;
    return (...args) => value.apply(target, resourceMethods.has(key) ? structuredClone(args) : args);
  } });
} };

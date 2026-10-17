import { fetchVerified } from "./runtime.mjs";

let module;
async function initialize(resources) {
  const [script, wasm] = await Promise.all(resources.map(resource => fetchVerified(resource)));
  const url = URL.createObjectURL(new Blob([script], { type: "application/javascript" }));
  try {
    const { default: entry } = await import(url);
    module = await entry({ wasmBinary: wasm, locateFile: path => new URL(path, resources[0].url).href });
  } finally { URL.revokeObjectURL(url); }
}
self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    let value;
    if (type === "initialize") await initialize(payload);
    else if (type === "analyze") value = JSON.parse(module.ccall("miacode_analysis", "string", ["string"], [JSON.stringify(payload)]));
    else throw new Error("谱面分析命令无效");
    self.postMessage({ id, value });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};

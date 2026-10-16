import { element as h, button, field } from "../components/dom.mjs";
import { openDialog } from "../components/dialog.mjs";

export async function openCoverPresets(host, assets, snapshot) {
  const list = h("select", { size: 6, "aria-label": "封面布局预设" });
  const name = h("input", { "aria-label": "预设名称" });
  const status = h("output", { role: "status" });
  let presets;
  async function refresh(selected) {
    presets = await assets.coverPresets();
    list.replaceChildren(...presets.map(preset => h("option", { value: preset.id, selected: preset.id === selected }, preset.name)));
    if (list.selectedIndex < 0 && presets.length) list.selectedIndex = 0;
    name.value = presets.find(preset => preset.id === list.value)?.name || "";
  }
  await refresh();
  list.addEventListener("change", () => { name.value = presets.find(preset => preset.id === list.value)?.name || ""; });
  const act = action => async () => {
    try { await action(); status.textContent = "预设保存完成"; }
    catch (error) { status.textContent = error.message; }
  };
  return new Promise(resolve => {
    const body = h("div", {}, field("布局预设", list), field("预设名称", name), h("div", { className: "action-row" },
      button("保存当前布局", act(async () => {
        const value = name.value.trim(); if (!value) throw new Error("请输入预设名称");
        const id = `cover-preset:${value}`;
        await assets.put({ id, kind: "cover-preset", name: value, composition: await snapshot() }); await refresh(id);
      })),
      button("重命名", act(async () => {
        const preset = presets.find(item => item.id === list.value), value = name.value.trim();
        if (!preset || !value) throw new Error("请选择预设并填写名称");
        const id = `cover-preset:${value}`;
        if (id !== preset.id && presets.some(item => item.id === id)) throw new Error("预设名称已占用");
        await assets.put({ ...preset, id, name: value }); if (id !== preset.id) await assets.delete(preset.id); await refresh(id);
      })),
      button("删除", act(async () => { if (list.value) await assets.delete(list.value); await refresh(); }))), status);
    const dialog = openDialog(host, { title: "管理封面布局预设", height: 430, body,
      actions: [{ label: "关闭", value: "close" }, { label: "应用预设", value: "apply", primary: true }],
      close: value => resolve(value === "apply" ? presets.find(preset => preset.id === list.value)?.composition : null) });
    dialog.querySelector("select").focus();
  });
}

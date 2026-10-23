import { element as h, button, field } from "../components/dom.mjs";
import { select, toggle, range, formRow } from "../components/forms.mjs";
import { translate } from "../components/translate.mjs";
import { shortcutDefinitions } from "../components/shortcut-definitions.mjs";

const palettes = [["dark", "深色"], ["light", "浅色"], ["legacy", "经典深色"], ["legacy_light", "经典浅色"]];
const tabs = [["interface", "界面"], ["background", "背景"], ["editor", "编辑器"], ["normalization", "谱面整理"], ["performance", "性能"], ["shortcuts", "快捷键"]];

function layoutCard(onLeft, selected, action) {
  const label = onLeft ? "预览 | 编辑器" : "编辑器 | 预览";
  return button(label, action, { className: `layout-card${onLeft ? " preview-left" : ""}`, "aria-pressed": String(selected), role: "radio", "aria-checked": String(selected) });
}
function decorateCard(node, label) {
  node.replaceChildren(h("div", { className: "layout-miniature", "aria-hidden": "true" },
    h("div", { className: "mini-toolbar" }), h("div", { className: "mini-sidebar" }),
    h("div", { className: "mini-preview" }, h("div", { className: "mini-stage" }, h("div", { className: "mini-circle" })), h("div", { className: "mini-controls" })),
    h("div", { className: "mini-editor" }, ...[85, 60, 75, 50].map(width => h("div", { className: "mini-code-line", style: `width:${width}%` })), h("div", { className: "mini-timeline" }))),
    h("span", {}, label));
  return node;
}

export function createPreferences({ viewState, documentSession, command }) {
  const root = h("div", { className: "preferences-content native-form" });
  const bar = h("div", { className: "settings-tabs", role: "tablist", "aria-label": "偏好设置分类" });
  const body = h("div", { className: "settings-tab-content", role: "tabpanel" });
  const prefs = viewState.preferences;
  const set = (key, value) => viewState.setPreferences({ [key]: value, ...(key === "chart_normalize_section_measure_count" ? { chart_normalize_split_every_four_measures: value === 4 } : {}) });
  const pick = (label, key, options, fallback) => formRow(label, select(options, prefs[key] ?? fallback, value => set(key, typeof fallback === "number" ? Number(value) : typeof fallback === "boolean" ? value === "true" : value)));
  const slider = (label, key, fallback, min, max, step = 1, suffix = "") => range(label, key, prefs[key] ?? fallback, min, max, (_, args) => set(key, args.value), step, suffix);
  let active = viewState.preferencesPage || "interface";
  function render() {
    root.refreshBackground=null;
    root.refreshPerformance=null;
    viewState.preferencesPage = active;
    for (const node of bar.children) {
      const selected = node.dataset.page === active;
      node.setAttribute("aria-selected", String(selected)); node.tabIndex = selected ? 0 : -1;
    }
    body.replaceChildren();
    body.classList.toggle("shortcut-content", active === "shortcuts");
    if (active === "interface") {
      const light = pick("浅色主题", "lightThemeToken", palettes, "light");
      const dark = pick("深色主题", "darkThemeToken", palettes, "dark");
      const visibility = () => { light.hidden = prefs.themeModeToken === "dark"; dark.hidden = prefs.themeModeToken === "light"; };
      const mode = select([["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]], prefs.themeModeToken, value => { set("themeModeToken", value); visibility(); });
      body.append(pick("语言", "languageToken", [["system", "跟随系统"], ["en", "English"], ["zh", "简体中文"], ["ja", "日本語"]], "zh"),
        formRow("外观模式", mode), light, dark);
      const cards = h("div", { className: "layout-cards", role: "radiogroup", "aria-label": "界面布局" });
      for (const left of [false, true]) {
        const node = layoutCard(left, prefs.previewOnLeft === left, () => {
          set("previewOnLeft", left);
          for (const card of cards.children) { const selected = card === node; card.setAttribute("aria-pressed", String(selected)); card.setAttribute("aria-checked", String(selected)); }
        });
        cards.append(decorateCard(node, left ? "预览 | 编辑器" : "编辑器 | 预览"));
      }
      body.append(formRow("界面布局", cards), toggle("模糊材质", prefs.blurMaterialsEnabled ?? true, value => set("blurMaterialsEnabled", value), "preferencesBlurMaterialsSwitch"));
      visibility();
    } else if (active === "background") {
      const background = prefs.appBackground || {};
      const update = (key, value) => command("preferences.background",{[key]:value});
      const imagePath=h("span",{className:"caption"});
      const clear=button("清除",()=>command("background.clear"));
      const refresh=()=>{
        imagePath.textContent=prefs.appBackground?.imagePath || translate("qml.no_background_image_selected",prefs.languageToken || "zh");
        clear.disabled=!prefs.appBackground?.imagePath;
      };
      refresh();root.refreshBackground=refresh;
      body.append(toggle("启用应用背景", background.enabled ?? false, value => update("enabled", value)),
        h("div", { className: "background-actions action-row" },imagePath,button("选择图片", () => command("background.choose")),clear),
        range("图片不透明度", "opacity", background.opacity ?? .2, .1, .8, (key, args) => update(key, args.value), .01, "%", value => String(Math.round(value * 100))),
        range(translate("qml.background_mask_opacity", prefs.languageToken || "zh"), "panelAlpha", background.panelAlpha ?? 200, 0, 255, (_, args) => update("panelAlpha", args.value), 1, "%", value => String(Math.round(value / 255 * 100))),
        range("模糊半径", "blur", background.blur ?? 0, 0, 64, (key, args) => update(key, args.value)),
        formRow("缩放模式", select([["cover", "覆盖"], ["contain", "完整显示"], ["stretch", "拉伸"], ["center", "居中"], ["repeat", "平铺"]], background.sizeMode || "cover", value => update("sizeMode", value))),
        formRow("位置", select([["center", "居中"], ["left", "左侧"], ["right", "右侧"], ["top", "顶部"], ["bottom", "底部"], ["left_top", "左上"], ["right_top", "右上"], ["left_bottom", "左下"], ["right_bottom", "右下"]], background.position || "center", value => update("position", value))));
    } else if (active === "editor") {
      body.append(toggle("启动时恢复上次打开的谱面", prefs.autoRestoreLastSessionFile ?? true, value => set("autoRestoreLastSessionFile", value)),
        slider("字号", "editorFontSize", 14, 8, 28, 1, " pt"),
        pick("行距", "editorLineSpacing", [1, 1.5, 2, 3, 5].map(value => [value, `${value} 倍`]), 1),
        pick("输入法与字符更正", "editorInputHandlingMode", [[0, "仅全角字符更正"], [1, "拉丁键盘提示+全角字符更正"], [2, "保留输入字符"]], 1),
        ...[["自动换行", "editorAutoWrap", true], ["自动补全", "editorAutoCompletion", true], ["允许滚动到行顶部", "editorScrollPastEnd", true], ["显示选区拍数", "editorSelectionBeatDisplay", true], ["概览标尺", "editorOverviewRulerEnabled", true]].map(([label, key, fallback]) => toggle(label, prefs[key] ?? fallback, value => set(key, value))));
    } else if (active === "normalization") {
      body.append(...[["从新小节开始", "chart_normalize_start_at_new_measure"], ["约分到 384 网格", "chart_normalize_reduce_to_384_grid"]]
        .map(([label, key]) => toggle(label, prefs[key] ?? true, value => set(key, value))),
        pick("语法格式", "chart_normalize_syntax", [["segment_preserving", "保留分段"], ["compact_single_line", "紧凑格式"]], "segment_preserving"),
        slider("分段小节数（0 为连续）", "chart_normalize_section_measure_count", 4, 0, 32));
    } else if (active === "performance") {
      const rates = [[3, "显示器刷新率"], [0, "30 FPS"], [1, "60 FPS"], [2, "120 FPS"]];
      const controls = new Map();
      const performancePick = (label, key, options, fallback) => {
        const node = select(options, prefs[key] ?? fallback, value => {
          const setting = typeof fallback === "boolean" ? value === "true" : Number(value);
          void Promise.resolve(command("preferences.performance", { [key]: setting })).catch(() => { node.querySelector("select").value = String(prefs[key] ?? fallback); });
        });
        controls.set(key, node.querySelector("select"));
        return formRow(label, node);
      };
      body.append(performancePick("视频解码", "videoDecodePrefersSoftware", [[false, "硬件解码"], [true, "软件解码"]], false),
        performancePick("画布帧率", "canvasFrameRateMode", rates, 1), performancePick("PV 帧率", "stageMediaFrameRateMode", rates, 1), performancePick("时间轴帧率", "timelineFrameRateMode", rates, 1));
      root.refreshPerformance = () => { for (const [key, node] of controls) node.value = String(prefs[key] ?? (key === "videoDecodePrefersSoftware" ? false : 1)); };
    } else {
      const shortcuts = documentSession.shortcutRows || shortcutDefinitions;
      body.append(h("p", { className: "caption" }, translate("qml.click_a_row_to_record_a_new_shortcut", prefs.languageToken || "zh")),
        h("div", { className: "shortcut-list", id: "shortcutList" }, ...shortcuts.map(row => h("div", { className: "shortcut-row" },
          button(row.label || (row.labelKey ? translate(row.labelKey, prefs.languageToken || "zh") : row.labelFallback), () => command("shortcut.capture", { id: row.id }), { className: "shortcut-capture", dataset: { shortcutId: row.id } }), h("span", { className: "caption" }, row.shortcutText),
          button("恢复默认", () => command("shortcut.reset", { id: row.id }), { disabled: row.isDefault !== false })))),
        button(translate("qml.restore_all_defaults", prefs.languageToken || "zh"), () => command("shortcut.resetAll"), { id: "preferencesResetShortcutsButton" }));
    }
  }
  for (const [key, label] of tabs) bar.append(button(label, () => { active = key; render(); }, { dataset: { page: key }, role: "tab" }));
  bar.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex(([key]) => key === active);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    active = tabs[next][0]; render(); bar.children[next].focus();
  });
  root.append(bar, h("hr", { className: "settings-rule" }), body);
  render();
  const changed=()=>{root.refreshBackground?.();root.refreshPerformance?.();};viewState.addEventListener("change",changed);
  root.destroy=()=>viewState.removeEventListener("change",changed);
  return root;
}

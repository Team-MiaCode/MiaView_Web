import { element as h, button, section } from "../components/dom.mjs";
import { select, range, check, toggle, formRow } from "../components/forms.mjs";
import { settingsTabs } from "../components/settings-tabs.mjs";
import { translate } from "../components/translate.mjs";

export function previewAppearanceSections({ viewState, documentSession, command }) {
  const values = documentSession.previewValues ||= {};
  const settings = documentSession.previewSettings || {};
  const t = key => translate(key, viewState.preferences.languageToken || "zh");
  const label = key => t(`dialog.render_settings.${key}`);
  const put = (key, value) => { values[key] = value; command("preview.values", { [key]: value }); };
  const slider = (key, name, fallback, min, max, step = 1, suffix = "%") => range(name, key, values[key] ?? fallback, min, max, (_, args) => put(key, args.value), step, suffix,
    value => suffix === "" ? value.toFixed(Math.abs(value - Math.round(value * 10) / 10) < .001 ? 1 : 2) : String(value));
  const choice = (key, name, options, fallback, action) => formRow(name, select(options, values[key] ?? fallback, value => put(key, typeof fallback === "boolean" ? value === "true" : typeof fallback === "number" ? Number(value) : value)), action);
  const switchRow = (key, name, fallback) => toggle(name, values[key] ?? fallback, value => put(key, value));
  const appearanceChoice = kind => {
    const skin = kind === "skin", records = skin ? documentSession.userSkins || [] : documentSession.userOutlines || [];
    const key = skin ? "skinDirectoryName" : "customOutlineFileName";
    const builtins = skin ? [["skinSD", "SD"], ["skinDX", "DX"]] : ["point", "line", "area", "area_labeled"].map(name => [name, label(`gameplay.judge_line.${name}`)]);
    const options = [...builtins, ...records.map(record => [record[key], record.name])];
    const selected = values[key] ? options.findIndex(item => item[0] === values[key]) : skin ? values.skinIndex ?? (settings.noteSkin === "SD" ? 0 : 1) : values.outlineIndex ?? 1;
    return formRow(skin ? label("video.skin") : label("gameplay.judge_line"), select(options.map((item, index) => [index, item[1]]), selected, value => {
      const index = Number(value), patch = skin ? { skinIndex: index, skinDirectoryName: options[index][0] }
        : { outlineIndex: index < 4 ? index : 1, customOutlineFileName: index < 4 ? "" : options[index][0] };
      Object.assign(values, patch); command("preview.values", patch);
    }), button(t("dialog.render_settings.video.skin.import"), () => command(skin ? "skin.import" : "preview.importJudgeLine")));
  };
  return [
    { key: "video", label: label("visual_group"), render: () => [
      slider("brightnessOuter", label("video.brightness_outer"), (settings.outerBrightness ?? .5) * 100, 0, 100),
      slider("brightnessInner", label("video.brightness_inner"), (settings.innerBrightness ?? .2) * 100, 0, 100),
      slider("layoutSquareScale", label("video.layout_square_scale"), 95, 50, 100, 5),
      choice("scaleMode", label("video.scale_mode"), [[0, label("video.scale.fill")], [1, label("video.scale.fit")], [2, label("video.scale.square_fit")], [3, label("video.scale.inner_circle_fit_outer_fill")]], 0),
      switchRow("smoothBrightness", label("video.smooth_brightness"), true),
      switchRow("showTimestamp", t("dialog.video_export.option.show_timestamp"), true),
      switchRow("touchPadAuthoringShortcut", label("video.touch_pad_authoring_shortcut"), false),
      switchRow("forceLabeledJudgeLineWhenPaused", label("gameplay.force_labeled_judge_line_when_paused"), false),
      switchRow("showDebugInfo", label("preview.debug"), false),
    ] },
    { key: "gameplay", label: label("gameplay_group"), render: () => [
      slider("tapFlowSpeed", label("video.tap_flow_speed"), settings.tapFlowSpeed ?? 7.5, 1, 10, .25, ""),
      slider("touchFlowSpeed", label("video.touch_flow_speed"), settings.touchFlowSpeed ?? 8, 1, 10, .25, ""),
      choice("slideEarlierOnTop", label("gameplay.slide_stack_order"), [[true, label("gameplay.slide_stack_order.dx_style")], [false, label("gameplay.slide_stack_order.finale_style")]], settings.earlierSlideOnTop ?? true),
      choice("centerDisplay", label("gameplay.center_display"), ["off", "combo", "achievement_dx_plus", "achievement_dx_minus_100", "achievement_dx_minus_101", "dx_score_plus", "dx_score_minus", "achievement_finale_plus"].map((key, index) => [index, label(`gameplay.center_display.${key}`)]), 0),
      choice("tapJudgeTextDistance", label("gameplay.tap_judge_text_distance"), ["inner", "middle", "outer"].map((key, index) => [index, label(`gameplay.tap_judge_text_distance.${key}`)]), 1),
      h("div", { className: "form-row judge-effects" }, h("span", { className: "form-label" }, label("gameplay.judge_effect")),
        h("div", { className: "action-row" }, ...[["Slide", "slide"], ["Tap", "tap"], ["Break", "break"], ["Touch", "touch"]].map(([kind, token]) => check(label(`gameplay.judge_effect.${token}`), values[`judgeEffect${kind}`] ?? true, value => put(`judgeEffect${kind}`, value))))),
    ] },
    { key: "skin", label: label("skin_group"), render: () => [
      appearanceChoice("skin"),
      choice("skinJudgeEffectIndex", t("dialog.skin_settings.chart_effect"), ["standard", "starry"].map((key, index) => [index, t(`dialog.skin_settings.chart_effect.${key}`)]), 0),
      appearanceChoice("outline"),
      section(t("dialog.video_export.option.hud_font"),
        choice("hudFontAreaIndex", t("dialog.video_export.option.hud_font_area"), ["chart_info", "timestamp", "center_display", "object_stats", "debug"].map((key, index) => [index, t(`dialog.video_export.option.hud_font_area.${key}`)]), 0),
        choice("hudFontPath", t("cover.font"), [["", t("card_font.default")], ...(documentSession.userFonts || []).map(font => [font.path, font.family])], ""),
        h("p", { className: "font-sample", style:`font-family:"${(documentSession.userFonts || []).find(font=>font.path===values.hudFontPath)?.cssFamily || ""}"` }, "MiaCode · 0123456789 · 谱面预览"),
        h("div", { className: "action-row" }, button(t("card_font.import"), () => command("preview.importHudFont")), button(t("action.reset"), () => command("preview.resetHudFont")))),
    ] },
  ];
}

export function createPreviewSettings(context) {
  return settingsTabs(previewAppearanceSections(context), context.viewState.previewSettingsPage, key => { context.viewState.previewSettingsPage = key; });
}

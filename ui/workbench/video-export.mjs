import { element as h, button, field, section } from "../components/dom.mjs";
import { select, text, number, toggle, check, formRow, range } from "../components/forms.mjs";
import { settingsTabs } from "../components/settings-tabs.mjs";
import { translate } from "../components/translate.mjs";
import { previewAppearanceSections } from "./preview-settings.mjs";
import { ExportRange } from "./export-range.mjs";

const resolutions = ["720x720 (1:1)", "960x720 (4:3)", "1280x720 (16:9)", "1080x1080 (1:1)", "1440x1080 (4:3)", "1920x1080 (16:9)", "1440x1440 (1:1)", "1920x1440 (4:3)", "2560x1440 (16:9)"];

export function createVideoExport(context) {
  const { viewState, documentSession, command } = context;
  const values = documentSession.exportValues ||= {};
  const t = key => translate(key, viewState.preferences.languageToken || "zh");
  const root = h("div", { className: "video-export-content" });
  const put = (key, value) => { values[key] = value; command("export.settings", { [key]: value }); };
  const input = (key, fallback = "") => text(key, values[key] ?? fallback, (_, args) => put(key, args.value));
  const numeric = (key, fallback, options) => number(key, values[key] ?? fallback, (_, args) => put(key, args.value), options);
  const choice = (key, options, fallback) => select(options, values[key] ?? fallback, value => put(key, typeof fallback === "number" ? Number(value) : value));
  const switchControl = (key, label, fallback, refresh = false) => toggle(t(label), values[key] ?? fallback, value => { put(key, value); if (refresh) render(); });
  const duration = documentSession.duration ?? 0;
  const folders = documentSession.batchChartDirectories || [];
  const fontOptions = (documentSession.userFonts || []).map(font => [font.path, font.family]);
  const fontChoice = key => {
    const node = choice(key, [["", t("card_font.default")], ...fontOptions], "");
    const input = node.querySelector("select");
    const update = () => {
      input.style.fontFamily = documentSession.userFonts?.find(font => font.path === input.value)?.family || '"Resource Han Rounded CN Bold"';
      input.style.fontWeight = "700";
    };
    input.addEventListener("change", update);
    update();
    return node;
  };
  const output = () => {
    const applyRange = (begin, finish) => {
      values.exportStartSeconds = begin; values.exportEndSeconds = finish;
      start.value = begin.toFixed(3); end.value = finish.toFixed(3);
      command("export.setExportRangeSeconds", { start: begin, end: finish });
    };
    const editRange = (key, { value }) => {
      rangeView.setRange(key === "exportStartSeconds" ? value : rangeView.start, key === "exportEndSeconds" ? value : rangeView.end);
      applyRange(rangeView.start, rangeView.end);
    };
    const options = { min: 0, max: duration, step: .001, format: value => value.toFixed(3) };
    const start = number("exportStartSeconds", (values.exportStartSeconds ?? 0).toFixed(3), editRange, options);
    const end = number("exportEndSeconds", (values.exportEndSeconds ?? duration).toFixed(3), editRange, options);
    const rangeView = new ExportRange({ totalSeconds: duration, startSeconds: values.exportStartSeconds ?? 0, endSeconds: values.exportEndSeconds ?? duration,
      playheadSeconds: documentSession.positionSeconds ?? 0,
      labels: [t("dialog.video_export.range.start"), t("dialog.video_export.range.end")],
      onRangeChanged: applyRange,
    });
    return [
    values.activeTab === "batch" ? null : field(t("video_export.filename"), h("div", { className: "form-input-action" }, input("outputPath", "MiaCode.mp4"), button(t("action.browse"), () => command("export.browseOutputPath")))),
    h("div", { className: "export-output-triple" },
      field(t("dialog.video_export.resolution"), choice("resolutionIndex", resolutions.map((label, id) => [id, label]), 3)),
      field(t("dialog.video_export.fps"), choice("fps", [30, 60, 120].map(value => [value, `${value} FPS`]), 60)),
      field(t("dialog.video_export.audio_bitrate"), choice("audioBitrateKbps", [128, 160, 192, 256, 320].map(value => [value, `${value} kbps`]), 192))),
    h("div", { className: "export-output-pair" },
      field(t("dialog.video_export.preset"), choice("presetIndex", ["fast", "high_quality"].map((key, id) => [id, t(`dialog.video_export.preset.${key}`)]), 1)),
      field(t("dialog.video_export.size_preset"), choice("sizePresetIndex", ["standard", "compact", "ultra_compact_with_pv", "ultra_compact"].map((key, id) => [id, t(`dialog.video_export.size_preset.${key}`)]), 0))),
    values.activeTab === "batch" ? null : section(t("video_export.export_range"),
      rangeView.root,
      h("div", { className: "export-range-fields" }, formRow(t("dialog.video_export.range.start"), start), formRow(t("dialog.video_export.range.end"), end))),
    h("hr", { className: "settings-rule" }),
    switchControl("showObjectStatsHud", "dialog.video_export.option.show_object_stats", false),
    switchControl("showChartInfoHud", "qml.show_chart_information", false),
    switchControl("clockCountEnabled", "qml.enable_clock_count", false),
  ].filter(Boolean);
  };
  const intro = () => {
    const body = h("fieldset", { className: "intro-settings", disabled: !values.introEnabled },
      section(t("qml.visuals"),
        formRow(t("video_export.intro_style"), select([[false, t("video_export.intro_style_classic")], [true, t("video_export.intro_style_pv_preview")]], values.introPvPreview ?? false, value => { put("introPvPreview", value === "true"); render(); })),
        formRow(t("dialog.preferences.background_group"), select([[0, t("cover.jacket")], [1, t("qml.custom")]], values.introBackgroundModeIndex ?? 0, value => { put("introBackgroundModeIndex", Number(value)); render(); })),
        values.introBackgroundModeIndex === 1 ? h("div", { className: "form-input-action" }, input("introCustomBackgroundPath"), button(t("action.browse"), () => command("export.browseIntroBackground"))) : null,
        formRow(t("cover.chart_type"), choice("introModeIndex", [[0, t("qml.automatic")], [1, "DX"], [2, "SD"]], 0)),
        values.introPvPreview ? null : switchControl("introBlurBackground", "cover.blur_background", true),
        switchControl("introCardShadow", "cover.card_drop_shadow", false),
        switchControl("introLevelTextRender", "qml.render_level_as_text", false)),
      values.introPvPreview ? section(t(documentSession.videoAvailable ? "video_export.intro_pv_segment" : "video_export.intro_music_segment"),
        range(t("video_export.intro_pv_start"), "introPvStartSeconds", values.introPvStartSeconds ?? 0, 0, duration || 1, (_, args) => put("introPvStartSeconds", args.value), .001, "s"),
        h("div", { className: "action-row" }, button(t("video_export.intro_audition"), () => command("export.toggleIntroAudition"), { symbol: "play", iconOnly: true }),
          button(t("video_export.intro_audition_loop"), () => { put("introAuditionLoop", !values.introAuditionLoop); render(); }, { symbol: "repeat", iconOnly: true, "aria-pressed": String(values.introAuditionLoop ?? false) })),
        formRow(t("video_export.intro_pv_start"), numeric("introPvStartSeconds", "0.000", { min: 0, step: .001 }))) : null,
      section(t("qml.difficulty_card_fonts"),
        formRow(t("card_font.title"), fontChoice("introFontDisplayPath")),
        formRow(t("card_font.body"), fontChoice("introFontBodyPath")),
        h("div", { className: "intro-font-sample" }, h("strong", {}, t("qml.title_font_preview")), h("span", {}, t("qml.body_font_preview"))),
        h("div", { className: "action-row" }, button(t("card_font.import"), () => command("export.importIntroFonts")), button(t("card_font.reset"), () => command("export.resetIntroFonts")))));
    return [switchControl("introEnabled", "video_export.add_intro", false, true), body];
  };
  const batch = () => [
    formRow(t("dialog.batch_export.difficulty"), h("div", { className: "action-row" }, ...["EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER", "UTAGE"].map((name, index) => check(name, (values.batchDifficultyChecks || [5]).includes(index + 1), value => {
      const checked = new Set(values.batchDifficultyChecks || [5]); value ? checked.add(index + 1) : checked.delete(index + 1); put("batchDifficultyChecks", [...checked]);
    })))),
    formRow(t("qml.output_folder"), input("batchOutputDirectory"), button(t("action.browse"), () => command("export.browseBatchOutputDirectory"))),
    section(t("dialog.batch_export.chart_folders"),
      h("div", { className: "action-row" }, button(t("qml.add"), () => command("export.addBatchChartDirectories")), button(t("dialog.batch_export.clear"), () => command("export.clearBatchChartDirectories"), { disabled: folders.length === 0 })),
      h("div", { className: "batch-chart-directories" }, folders.length ? folders.map(path => h("div", { className: "batch-chart-directory" }, h("span", {}, path), button(t("metadata.remove"), () => command("export.removeBatchChartDirectory", { path }), { symbol: "remove", iconOnly: true }))) : h("p", { className: "caption batch-empty" }, t("dialog.batch_export.no_chart_folders")))),
  ];
  function render() {
    const sections = [
      ...(values.activeTab === "batch" ? [{ key: "batch", label: t("qml.batch"), render: batch }] : []),
      { key: "output", label: t("video_export.output"), render: output },
      ...previewAppearanceSections(context),
      { key: "intro", label: t("video_export.intro"), render: intro },
    ];
    const active = sections.some(section => section.key === values.settingsTab) ? values.settingsTab : "output";
    const tabs = settingsTabs(sections, active, key => { values.settingsTab = key; });
    const difficulties = h("div", { className: "export-difficulties", role: "group", "aria-label": t("dialog.batch_export.difficulty") },
      ...(documentSession.charts || []).map(chart => {
        const node = button(chart.name || ["EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER", "UTAGE"][chart.id - 1], () => { put("selectedDifficultyId", chart.id); render(); }, { "aria-pressed": String((values.selectedDifficultyId ?? documentSession.activeDifficultyId) === chart.id) });
        node.prepend(h("span", { className: "difficulty-swatch", style: `background: var(--difficulty-${chart.id})`, "aria-hidden": "true" }));
        return node;
      }));
    tabs.querySelector(".settings-tabs").after(difficulties);
    root.replaceChildren(h("div", { className: "export-heading" }, h("h1", {}, t("export_page.export_video")), button(t("action.batch_export"), () => { put("activeTab", values.activeTab === "batch" ? "export" : "batch"); render(); }, { "aria-pressed": String(values.activeTab === "batch") })), tabs,
      h("div", { className: "export-footer native-form" }, documentSession.exportRunning ? h("progress", { id: "export-progress", max: 1, value: documentSession.exportProgress ?? 0, "aria-label": "视频导出进度" }) : null,
        documentSession.exportMessage ? h("output", { id: "export-result", role: "status" }, documentSession.exportMessage) : null,
        button(t(documentSession.exportRunning ? "video_export.cancel_export" : "video_export.start_export"), () => command(documentSession.exportRunning ? "job.cancel" : "export.video"), { className: "primary" })));
  }
  render();
  return root;
}

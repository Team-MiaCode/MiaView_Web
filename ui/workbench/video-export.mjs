import { element as h, button, field, section, icon } from "../components/dom.mjs";
import { select, text, number, range, toggle, formRow } from "../components/forms.mjs";
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
  const footer=session=>h("div",{className:"export-footer native-form"},
    session.exportRunning?h("progress",{id:"export-progress",max:1,value:session.exportProgress??0,"aria-label":"视频导出进度"}):null,
    session.exportMessage?h("output",{id:"export-result",role:"status"},session.exportMessage):null,
    button(t(session.exportRunning?"video_export.cancel_export":"video_export.start_export"),()=>command(session.exportRunning?"job.cancel":"export.video"),{className:"primary",disabled:!session.exportRunning&&session.duration===0}));
  root.updateProgress=session=>root.querySelector(".export-footer")?.replaceWith(footer(session));
  root.updateAudition=state=>{
    const node=root.querySelector("[data-intro-audition]");
    if(node&&node.getAttribute("aria-pressed")!==String(state.playing)){node.setAttribute("aria-pressed",String(state.playing));node.replaceChildren(icon(state.playing?"pause":"play"));}
  };
  let outputRange, pvRange;
  root.updatePreview = state => {
    outputRange?.setPlayhead(Math.max(0, state.currentTime));
    if (pvRange) pvRange.setPlayhead((values.introPvStartSeconds ?? 0) + Math.max(0, (state.currentTime ?? 0) - (state.minimum ?? 0)));
    root.updateAudition({ playing: state.auditionPlaying ?? state.exportPreview?.auditionPlaying ?? documentSession.introAuditionPlaying ?? false });
  };
  const put = (key, value) => { values[key] = value; command("export.settings", { [key]: value }); };
  const input = (key, fallback = "") => {
    const node=text(key,values[key]??fallback,(_,args)=>put(key,args.value));
    node.readOnly=key === "introCustomBackgroundPath";return node;
  };
  const numeric = (key, fallback, options) => number(key, values[key] ?? fallback, (_, args) => put(key, args.value), options);
  const choice = (key, options, fallback) => select(options, values[key] ?? fallback, value => put(key, typeof fallback === "number" ? Number(value) : value));
  const switchControl = (key, label, fallback, refresh = false) => toggle(t(label), values[key] ?? fallback, value => { put(key, value); if (refresh) render(); });
  const duration = documentSession.duration ?? 0;
  const fontOptions = (documentSession.userFonts || []).map(font => [font.path, font.family]);
  const fontChoice = key => {
    const node = choice(key, [["", t("card_font.default")], ...fontOptions], "");
    const input = node.querySelector("select");
    const update = () => {
      const font=documentSession.userFonts?.find(font => font.path === input.value);
      input.style.fontFamily = font?.cssFamily || font?.family || '"Resource Han Rounded CN Bold"';
      input.style.fontWeight = "700";
      updateFontSamples();
    };
    input.addEventListener("change", update);
    update();
    return node;
  };
  const output = () => {
    const applyRange = (begin, finish, edge = "start") => {
      values.exportStartSeconds = begin; values.exportEndSeconds = finish;
      start.value = begin.toFixed(3); end.value = finish.toFixed(3);
      command("export.setExportRangeSeconds", { start: begin, end: finish, second: edge === "end" ? finish : begin });
    };
    const editRange = (key, { value }) => {
      rangeView.setRange(key === "exportStartSeconds" ? value : rangeView.start, key === "exportEndSeconds" ? value : rangeView.end);
      applyRange(rangeView.start, rangeView.end, key === "exportEndSeconds" ? "end" : "start");
    };
    const options = { min: 0, max: duration, step: .001, format: value => value.toFixed(3) };
    const start = number("exportStartSeconds", (values.exportStartSeconds ?? 0).toFixed(3), editRange, options);
    const end = number("exportEndSeconds", (values.exportEndSeconds ?? duration).toFixed(3), editRange, options);
    const rangeView = new ExportRange({ totalSeconds: duration, startSeconds: values.exportStartSeconds ?? 0, endSeconds: values.exportEndSeconds ?? duration,
      playheadSeconds: documentSession.positionSeconds ?? 0,
      labels: [t("dialog.video_export.range.start"), t("dialog.video_export.range.end")],
      onRangeChanged: applyRange,
    });
    outputRange = rangeView;
    return [
    formRow("输出模式", choice("outputMode", [["mp4", "视频"], ["wav", "WAV 音频"], ["mp4_and_wav", "视频与 WAV 音频"]], "mp4")),
    field(t("video_export.filename"), h("div", { className: "form-input-action" }, input("outputPath", "MiaCode.mp4"), button(t("action.browse"), () => command("export.browseOutputPath")))),
    h("div", { className: "export-output-triple" },
      field(t("dialog.video_export.resolution"), choice("resolutionIndex", resolutions.map((label, id) => [id, label]), 3)),
      field(t("dialog.video_export.fps"), choice("fps", [30, 60, 120].map(value => [value, `${value} FPS`]), 60)),
      field(t("dialog.video_export.audio_bitrate"), choice("audioBitrateKbps", [128, 160, 192, 256, 320].map(value => [value, `${value} kbps`]), 192))),
    h("div", { className: "export-output-pair" },
      field(t("dialog.video_export.preset"), choice("presetIndex", ["fast", "high_quality"].map((key, id) => [id, t(`dialog.video_export.preset.${key}`)]), 1)),
      field(t("dialog.video_export.size_preset"), choice("sizePresetIndex", ["standard", "compact", "ultra_compact_with_pv", "ultra_compact"].map((key, id) => [id, t(`dialog.video_export.size_preset.${key}`)]), 0))),
    section(t("video_export.export_range"),
      rangeView.root,
      h("div", { className: "export-range-fields" }, formRow(t("dialog.video_export.range.start"), start), formRow(t("dialog.video_export.range.end"), end))),
    h("hr", { className: "settings-rule" }),
    switchControl("showObjectStatsHud", "dialog.video_export.option.show_object_stats", false),
    switchControl("showChartInfoHud", "qml.show_chart_information", false),
    switchControl("clockCountEnabled", "qml.enable_clock_count", true),
  ].filter(Boolean);
  };
  const intro = () => {
    pvRange = values.introPvPreview ? new ExportRange({ totalSeconds: duration, startSeconds: values.introPvStartSeconds ?? 0,
      endSeconds: Math.min(duration, (values.introPvStartSeconds ?? 0) + 8.5), fixedRangeSeconds: 8.5,
      labels: [t("video_export.intro_pv_start"), t("dialog.video_export.range.end")],
      onRangeChanged: start => put("introPvStartSeconds", start),
      onDragChanged: active => command("export.introScrubbing", { active }),
      onSeek: second => command("preview.seek", { second: (documentSession.exportPreviewMinimum ?? 0) + second - (values.introPvStartSeconds ?? 0) }) }) : null;
    const body = h("fieldset", { className: "intro-settings", disabled: !values.introEnabled },
      section(t("qml.visuals"),
        values.introPvPreview ? range("PV 片头亮度", "introPvBrightness", (values.introPvBrightness ?? 1)*100, 0, 100, (_, args) => put("introPvBrightness", args.value/100), 1, "%") : null,
        formRow("片头音效", h("div", { className: "action-row" }, h("span", { className: "caption" }, documentSession.introSoundFileName || "track_start.wav"),
          button("选择音效", () => command("export.browseIntroSound")), button("恢复默认", () => command("export.resetIntroSound")))),
        formRow(t("video_export.intro_style"), select([[false, t("video_export.intro_style_classic")], [true, t("video_export.intro_style_pv_preview")]], values.introPvPreview ?? false, value => { put("introPvPreview", value === "true"); render(); })),
        formRow(t("dialog.preferences.background_group"), select([[0, t("cover.jacket")], [1, t("qml.custom")]], values.introBackgroundModeIndex ?? 0, value => { put("introBackgroundModeIndex", Number(value)); render(); })),
        values.introBackgroundModeIndex === 1 ? h("div", { className: "form-input-action" }, input("introCustomBackgroundPath"), button(t("action.browse"), () => command("export.browseIntroBackground"))) : null,
        formRow(t("cover.chart_type"), choice("introModeIndex", [[0, t("qml.automatic")], [1, "DX"], [2, "SD"]], 0)),
        values.introPvPreview ? null : switchControl("introBlurBackground", "cover.blur_background", true),
        switchControl("introCardShadow", "cover.card_drop_shadow", false),
        switchControl("introLevelTextRender", "qml.render_level_as_text", false)),
      values.introPvPreview ? section(t(documentSession.videoAvailable ? "video_export.intro_pv_segment" : "video_export.intro_music_segment"),
        pvRange.root,
        h("div", { className: "action-row" }, button(t("video_export.intro_audition"), () => command("export.toggleIntroAudition"), { symbol: documentSession.introAuditionPlaying?"pause":"play", iconOnly: true, "data-intro-audition":"", "aria-pressed":String(documentSession.introAuditionPlaying??false) }),
          button(t("video_export.intro_audition_loop"), () => { put("introAuditionLoop", !values.introAuditionLoop); render(); }, { symbol: "repeat", iconOnly: true, "aria-pressed": String(values.introAuditionLoop ?? false) })),
        formRow(t("video_export.intro_pv_start"), numeric("introPvStartSeconds", "0.000", { min: 0, max: Math.max(0, duration - 8.5), step: .001 }))) : null,
      section(t("qml.difficulty_card_fonts"),
        formRow(t("card_font.title"), fontChoice("introFontDisplayPath")),
        formRow(t("card_font.body"), fontChoice("introFontBodyPath")),
        h("div", { className: "intro-font-sample" }, h("strong", {}, t("qml.title_font_preview")), h("span", {}, t("qml.body_font_preview"))),
        h("div", { className: "action-row" }, button(t("card_font.import"), () => command("export.importIntroFonts")), button(t("card_font.reset"), () => command("export.resetIntroFonts")))));
    return [switchControl("introEnabled", "video_export.add_intro", false, true), body];
  };
  function updateFontSamples() {
    for(const [selector,key] of [["strong","introFontDisplayPath"],["span","introFontBodyPath"]]) {
      const node=root.querySelector(`.intro-font-sample ${selector}`),font=documentSession.userFonts?.find(font=>font.path===values[key]);
      if(node)node.style.fontFamily=font?.cssFamily||font?.family||"";
    }
  }
  function render() {
    const sections = [
      { key: "output", label: t("video_export.output"), render: output },
      ...previewAppearanceSections(context),
      { key: "intro", label: t("video_export.intro"), render: intro },
    ];
    const active = sections.some(section => section.key === values.settingsTab) ? values.settingsTab : "output";
    const tabs = settingsTabs(sections, active, key => { values.settingsTab = key; });
    const difficulties = h("div", { className: "export-difficulties", role: "group", "aria-label": t("workbench.difficulty") },
      ...(documentSession.charts || []).map(chart => {
        const node = button(chart.name || ["EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER", "UTAGE"][chart.id - 1], () => { put("selectedDifficultyId", chart.id); render(); }, { "aria-pressed": String((values.selectedDifficultyId ?? documentSession.activeDifficultyId) === chart.id) });
        node.prepend(h("span", { className: "difficulty-swatch", style: `background: var(--difficulty-${chart.id})`, "aria-hidden": "true" }));
        return node;
      }));
    tabs.querySelector(".settings-tabs").after(difficulties);
    root.replaceChildren(h("div", { className: "export-heading" }, h("h1", {}, t("export_page.export_video"))), tabs,
      footer(documentSession));
    updateFontSamples();
  }
  render();
  return root;
}

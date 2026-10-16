import { element as h, button } from "../components/dom.mjs";
import { openDialog } from "../components/dialog.mjs";
import { translate, formatMessage } from "../components/translate.mjs";

export const DIFFICULTY_NAMES = Object.freeze(["EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER", "UTAGE"]);

export function createChartSidebar({ viewState: state, documentSession: doc, command, menu, dialogHost }) {
  const t = key => translate(key, state.preferences.languageToken || "zh");
  const charts = doc.difficulties || (doc.charts || []).map(chart => ({ ...chart, label: chart.label || DIFFICULTY_NAMES[chart.id - 1] }));
  const available = doc.availableDifficulties || DIFFICULTY_NAMES.map((label, index) => ({ id: index + 1, label })).filter(item => !charts.some(chart => chart.id === item.id));
  const body = h("div", { className: "chart-sidebar-body" },
    button(t("dialog.unsaved_field_changes.field.metadata"), () => state.openEditor("metadata"), { symbol: "metadata", className: "nav-row", "aria-selected": String(state.activeEditorKey === "metadata") }),
    button(t("qml.latency_calibration"), () => state.openEditor("latency"), { symbol: "metronome", className: "nav-row", "aria-selected": String(state.activeEditorKey === "latency") }));
  const fold = button(t("workbench.difficulty"), () => { state.difficultySectionExpanded = !state.difficultySectionExpanded; state.changed(); }, {
    className: "difficulty-section-toggle", "aria-expanded": String(state.difficultySectionExpanded),
  });
  fold.prepend(h("span", { className: "difficulty-fold", "aria-hidden": "true" }, state.difficultySectionExpanded ? "▾" : "▸"));
  const add = button(t("sidebar.add_difficulty"), event => menu(event.currentTarget, available.map(item => [item.label, "document.addDifficulty", null, { difficulty: item.id }])), {
    symbol: "add", iconOnly: true, className: "chrome", disabled: !doc.hasDocument || available.length === 0,
  });
  const remove = button(t("qml.delete_current_difficulty"), event => openDialog(dialogHost, {
    title: t("qml.delete_current_difficulty"), width: 420, height: 280, opener: event.currentTarget,
    body: h("p", {}, t("qml.the_current_difficulty_and_its_source_will_be_removed_from_the_d")),
    actions: [{ label: t("action.cancel") }, { label: t("action.ok"), primary: true, run: () => command("document.removeDifficulty", { difficulty: doc.currentDifficultyId ?? doc.activeDifficultyId }) }],
  }), { symbol: "remove", iconOnly: true, className: "chrome", disabled: !(doc.currentDifficultyId ?? doc.activeDifficultyId) });
  const list = h("div", { className: "difficulty-list" });
  const section = h("section", { className: "difficulty-section" }, h("div", { className: "difficulty-section-heading" }, fold, h("div", { className: "difficulty-section-actions" }, add, remove)), list);
  if (state.difficultySectionExpanded) for (const chart of charts) {
    const active = state.activeEditorKey === `difficulty:${chart.id}`;
    const bookmarks = chart.bookmarks || (chart.id === (doc.currentDifficultyId ?? doc.activeDifficultyId) ? doc.bookmarks || [] : []);
    const expanded = active && state.bookmarkGroupExpanded(chart.id);
    const row = button(chart.label, () => {
      if (active && bookmarks.length) state.setBookmarkGroupExpanded(chart.id, !expanded);
      else command("document.selectDifficulty", { difficulty: chart.id });
    }, { className: "nav-row difficulty-row", "aria-selected": String(active), dataset: { difficulty: chart.id } });
    row.prepend(h("span", { className: "difficulty-fold", "aria-hidden": "true" }, bookmarks.length ? expanded ? "▾" : "▸" : ""),
      h("span", { className: "difficulty-swatch", style: `background: var(--difficulty-${chart.id})`, "aria-hidden": "true" }));
    list.append(row);
    if (expanded) for (const bookmark of bookmarks) {
      const label = formatMessage(t("qml.1_line_2"), bookmark.title, bookmark.line);
      const jump = button(label, () => command("document.navigateToBookmark", { difficulty: chart.id, line: bookmark.line }), { className: "nav-row difficulty-bookmark", dataset: { line: bookmark.line } });
      jump.replaceChildren(h("span", { className: "bookmark-line-badge" }, bookmark.line), h("span", { className: "bookmark-title" }, bookmark.title));
      list.append(jump);
    }
  }
  body.append(section);
  return [h("h2", { className: "panel-heading chart-sidebar-heading" }, t("qml.chart")), body];
}

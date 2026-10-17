import { element as h, button } from "../components/dom.mjs";
import { translate, formatMessage } from "../components/translate.mjs";

export function createAnalysisPanel(kind, { documentSession: doc, command, language }) {
  const t = key => translate(key, language);
  const rows = doc[kind === "validation" ? "validationRows" : "muriRows"] || [];
  const pending = doc.pending ?? false;
  const summary = pending ? t("qml.analyzing") : kind === "validation"
    ? formatMessage(t("qml.1_errors_2_warnings"), doc.syntaxErrorCount ?? 0, doc.syntaxWarningCount ?? 0)
    : formatMessage(t("validation.muri.summary"), rows.filter(row => row.alert === "muri").length, rows.filter(row => row.alert === "warning").length);
  const root = h("div", { className: "analysis-panel", dataset: { analysis: kind } }, h("div", { className: "analysis-summary", role: "status" }, summary));
  const list = h("div", { className: "analysis-list", role: "list" });
  for (const row of rows) {
    const severity = row.severity === "error" ? t("qml.errors") : t("validation.muri.alert.warning");
    const leading = kind === "validation" ? row.code === "missing_difficulty_level" ? t("validation.difficulty_header") : `${severity} · L${row.line}:C${row.column}`
      : `${t(row.alert === "warning" ? "validation.muri.alert.warning" : "validation.muri.alert.muri")} · ${row.title} · L${row.line}:C${row.column}`;
    list.append(h("div", { role: "listitem" }, button(leading, () => command("analysis.activateRow", row), { className: "analysis-issue", dataset: { severity: row.severity } })));
    list.lastChild.firstChild.replaceChildren(h("span", { className: "analysis-leading" }, leading), h("span", { className: "analysis-detail" }, row.detail));
  }
  if (!rows.length) root.append(h("div", { className: "analysis-empty" }, pending ? t("qml.analyzing") : t(kind === "validation" ? "validation.no_syntax_errors_detected" : "validation.no_muri_issues_detected")));
  root.append(list);
  return root;
}

export function analysisCount(rows) {
  const errors = rows.filter(row => row.severity === "error").length;
  return { count: errors || rows.filter(row => row.severity === "warning").length, error: errors > 0 };
}

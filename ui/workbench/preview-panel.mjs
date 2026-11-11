import { element as h, button } from "../components/dom.mjs";
import { NoteStatistics } from "./note-statistics.mjs";
import { PreviewTransport } from "./preview-transport.mjs";

export function createPreviewPanel({ viewState, command, menu, openSettings, transportActions }) {
  const settingsButton = button("预览设置", openSettings, { symbol: "preview-settings", className: "chrome", iconOnly: true });
  const header = h("h2", { className: "panel-heading" }, "预览", h("span", { className: "spacer" }),
    transportActions ? null : settingsButton);
  const container = h("div", { className: "preview-container" }, h("div", { className: "preview-empty" }, "选择谱面查看预览"));
  const transport = new PreviewTransport(command, menu, viewState, transportActions && [settingsButton, ...transportActions]);
  transport.setDocument({ hasDocument: false });
  const statistics = new NoteStatistics(() => viewState.preferences.languageToken || "zh");
  const root = h("section", { className: "preview-host", "aria-label": "谱面预览" }, header, container, transport.root, statistics.root);
  return { root, container, transport, statistics, settingsButton };
}

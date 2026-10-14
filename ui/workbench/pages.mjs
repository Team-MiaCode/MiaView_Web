import { element as h, button, field, section } from "../components/dom.mjs";
import { number, range, formRow } from "../components/forms.mjs";
import { createPreferences } from "./preferences.mjs";
import { createPreviewSettings } from "./preview-settings.mjs";
import { createAudioSettings } from "./audio-settings.mjs";
import { createMetadata } from "./metadata.mjs";
import { createVideoExport } from "./video-export.mjs";
import { createCoverEditor } from "./cover-editor.mjs";
import { createAbout } from "./about.mjs";

export const PAGE_NAMES = Object.freeze({
  welcome: "欢迎", metadata: "谱面信息", preferences: "偏好设置", latency: "BPM 与延迟",
  export: "视频导出", cover: "封面编辑",
  "preview-settings": "预览设置", "audio-settings": "音频设置", about: "关于 MiaCode",
});

export function createPage(key, { viewState, documentSession, command, nativeCover = false }) {
  const prefs = viewState.preferences;
  const page = h("div", { className: "page", dataset: { page: key } });
  const action = (id, args) => command(id, args);
  if (key === "welcome") {
    page.className = "welcome";
    const recent = documentSession.recentDocuments || [];
    page.append(h("div", { className: "welcome-column" },
      h("h1", { className: "welcome-title" }, "MiaCode"),
      h("div", { className: "action-row welcome-actions" },
        button("新建", () => action("file.new"), { className: "primary" }),
        button("打开", () => action("file.open"), { title: "打开谱面文件夹", "aria-label": "打开谱面文件夹" })),
      h("hr"), h("h2", {}, "最近打开"),
      h("div", { className: "recent-documents" }, recent.length
        ? recent.slice(0, 8).map(item => h("div", { className: "recent-document" },
          button(item.label, () => action("file.openRecent", { path: item.path }), { className: "recent-open" }),
          h("span", { className: "recent-path" }, item.path),
          button("删除", () => action("file.removeRecent", { path: item.path }), { symbol: "remove", className: "chrome recent-remove", iconOnly: true })))
        : h("p", { className: "recent-empty" }, "暂无最近文档"))));
    return page;
  }
  page.append(h("h1", {}, PAGE_NAMES[key] || key));
  if (key === "metadata") {
    page.classList.add("metadata-page");
    page.replaceChildren(createMetadata({ viewState, documentSession, command }));
  } else if (key === "preferences") {
    page.classList.add("preferences-page");
    page.append(createPreferences({ viewState, documentSession, command }));
  } else if (key === "preview-settings") {
    page.classList.add("settings-page");
    page.append(createPreviewSettings({ viewState, documentSession, command }));
  } else if (key === "audio-settings") {
    page.classList.add("audio-settings-page");
    page.append(createAudioSettings({ viewState, command }));
  } else if (key === "latency") {
    page.classList.add("native-form", "latency-page");
    page.replaceChildren(
      formRow("BPM", number("latency.bpm", (documentSession.bpm ?? 120).toFixed(3), action, { min: 1, step: .001, id: "latencyBpmField" }),
        button("自动检测", () => action("latency.detectBpm"), { id: "latencyDetectBpmButton", disabled: !documentSession.trackAvailable })),
      formRow("计数拍", number("latency.clockCount", documentSession.clockCount ?? 4, action, { min: 1, step: 1, id: "latencyClockCountField" })),
      formRow("偏移", number("latency.offsetSeconds", (documentSession.offsetSeconds ?? 0).toFixed(3), action, { step: .001, id: "latencyOffsetField" }),
        button("自动检测", () => action("latency.detectOffset"), { id: "latencyDetectOffsetButton", disabled: !documentSession.trackAvailable })),
      section("试听", h("div", { className: "form-row audition-row" }, h("span", { className: "form-label" }, "细分"),
        h("div", { className: "choice-row", role: "group", "aria-label": "细分" }, ...[4, 8].map(value => button(`1/${value}`, () => action("latency.subdivision", { value }), { "aria-pressed": String((documentSession.subdivision ?? 4) === value) }))),
        button(documentSession.auditionRunning ? "暂停" : "开始试听", () => action("latency.toggleAudition"), { id: "latencyAuditionButton", className: documentSession.auditionRunning ? "" : "primary" })),
        range("音效音量", "latency.sfxVolumePercent", documentSession.sfxVolumePercent ?? 100, 0, 100, action, 1, "%")),
      h("output", { id: "latency-result", role: "status" }));
  } else if (key === "export") {
    page.classList.add("video-export-page");
    page.replaceChildren(createVideoExport({ viewState, documentSession, command }));
  } else if (key === "cover") {
    page.classList.add("cover-page");
    const editor = createCoverEditor({ viewState, documentSession, command, nativeCover });
    page.replaceChildren(editor);
    page.destroy = () => editor.destroy?.();
  } else if (key === "about") {
    page.classList.add("about-page");
    page.append(createAbout({ viewState, documentSession }));
  }
  return page;
}

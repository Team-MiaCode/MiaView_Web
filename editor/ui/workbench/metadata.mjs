import { element as h, button, field, section } from "../components/dom.mjs";
import { text } from "../components/forms.mjs";
import { translate } from "../components/translate.mjs";
import { uiFontFamily } from "../components/font-family.mjs";

export function createMetadata({ viewState, documentSession: doc, command }) {
  const t = key => translate(key, viewState.preferences.languageToken || "zh");
  const edit = (key, value) => text(`document.${key}`, value, command);
  const metrics = document.createElement("canvas").getContext("2d");
  metrics.font = `${viewState.preferences.fontSize || 13}px ${uiFontFamily(viewState.preferences.languageToken || "zh")}`;
  const actionWidth = Math.ceil(Math.max(...["metadata.import", "metadata.load_audio_info", "metadata.remove", "document.manage_designer_names"].map(key => metrics.measureText(t(key)).width)) + 24);
  const fields = h("div", { className: "metadata-fields" },
    field(t("net.title"), edit("metadataTitle", doc.metadataTitle ?? doc.title)),
    field(t("metadata.field.artist"), edit("metadataArtist", doc.metadataArtist ?? doc.artist)),
    field(t("net.designer"), h("div", { className: "metadata-designer" }, edit("metadataDesigner", doc.metadataDesigner ?? doc.designer),
      button(t("document.manage_designer_names"), event => command("document.designerSlots", { opener: event.currentTarget })))),
    h("div", { className: "metadata-offsets" }, field(t("metadata.field.first"), edit("metadataFirst", doc.metadataFirst ?? doc.first ?? "0")),
      field(t("media_tools.beats"), edit("metadataClockCount", doc.metadataClockCount ?? doc.clockCount ?? "4"))));
  const cover = h("aside", { className: "metadata-cover" }, h("span", { className: "form-label" }, t("metadata.field.cover")),
    h("div", { className: "metadata-cover-view" }, doc.metadataCoverSource
      ? h("img", { src: doc.metadataCoverSource, alt: t("metadata.field.cover") })
      : h("span", { className: "caption" }, t("metadata.no_cover"))),
    h("div", { className: "action-row" }, button(t("metadata.import"), () => command("media.cover")), button(t("metadata.load_audio_info"), () => command("media.audioInfo"))));
  const extra = h("textarea", { value: doc.metadataExtraText ?? doc.extraFields ?? "", placeholder: t("qml.one_field_equals_value_per_line"), "aria-label": t("qml.other_fields"),
    onChange: event => command("document.metadataExtraText", { value: event.target.value }) });
  return h("div", { className: "metadata-content native-form", style: `--metadata-action-width: ${actionWidth}px` }, h("div", { className: "metadata-columns" }, fields, cover),
    section(t("metadata.field.background_video"), h("div", { className: "metadata-video action-row" }, h("div", { className: "metadata-video-path" },
      h("span", {}, doc.metadataHasVideo ? doc.metadataResolvedVideoPath?.split(/[/\\]/).at(-1) : t("metadata.no_pv")),
      doc.metadataHasVideo ? h("p", { className: "caption" }, doc.metadataResolvedVideoPath) : null),
      button(t("metadata.import"), () => command("media.video")), button(t("metadata.remove"), () => command("media.removeVideo"), { disabled: !doc.metadataHasVideo }))),
    section(t("qml.other_fields"), extra));
}

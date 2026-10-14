import { element as h } from "../components/dom.mjs";
import { translate } from "../components/translate.mjs";
import { buildInfo } from "../components/build-info.mjs";

export function createAbout({ viewState, documentSession }) {
  const t = key => translate(key, viewState.preferences.languageToken || "zh");
  const info = documentSession.aboutInfo || buildInfo;
  return h("div", { className: "about-content native-form" },
    h("div", { className: "about-brand" }, h("img", { src: new URL("../components/icons/app.png", import.meta.url).href, width: 48, height: 48, alt: "" }),
      h("div", {}, h("h2", {}, "MiaCode"), h("p", { id: "aboutVersion" }, `v${info.version}`))),
    h("dl", { className: "about-properties" }, h("dt", {}, t("about.platform")), h("dd", {}, info.platform), h("dt", {}, t("about.build_type")), h("dd", {}, info.buildType)));
}

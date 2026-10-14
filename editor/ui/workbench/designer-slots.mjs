import { element as h } from "../components/dom.mjs";
import { check, select } from "../components/forms.mjs";
import { openDialog } from "../components/dialog.mjs";
import { translate, formatMessage } from "../components/translate.mjs";

export function openDesignerSlots(host, { documentSession: doc, command, language = "zh", opener }) {
  const t = key => translate(key, language);
  const names = ["EASY", "BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER", "UTAGE"];
  const slots = (doc.designerSlots || names.map((name, index) => {
    const chart = doc.charts?.find(item => item.id === index + 1);
    return { id: index + 1, name, designer: chart?.designer || "", hasChart: Boolean(chart) };
  })).map(slot => ({ ...slot }));
  let unified = Boolean(doc.unifiedDesignerEnabled);
  let canonicalName = unified ? doc.metadataDesigner || "" : "";
  const inputs = [];
  const commit = () => command("document.applyDesignerSlots", {
    slots: slots.map(({ id, designer }) => ({ id, designer })), unified, canonicalName,
  });
  const body = h("div", { className: "designer-slots" });
  for (const slot of slots) {
    const input = h("input", { value: slot.designer || "", placeholder: `&des_${slot.id}=`, disabled: unified, "aria-label": slot.name });
    input.addEventListener("input", () => { slot.designer = input.value; });
    input.addEventListener("change", commit);
    inputs.push(input);
    body.append(h("label", { className: "designer-slot" }, h("span", {
      className: slot.hasChart ? "" : "designer-slot-empty",
      title: slot.hasChart ? "" : formatMessage(t("document.no_chart_yet_records_des"), slot.id),
    }, slot.name), input));
  }
  const applyName = name => {
    unified = true;
    canonicalName = name;
    for (const [index, slot] of slots.entries()) {
      slot.designer = slot.hasChart || slot.designer ? name : "";
      inputs[index].value = slot.designer;
      inputs[index].disabled = true;
    }
    checkbox.checked = true;
    commit();
  };
  const mode = check(t("document.all_difficulties_share_this_designer"), unified, checked => {
    if (!checked) {
      unified = false;
      inputs.forEach(input => { input.disabled = false; });
      commit();
      return;
    }
    const names = [...new Set([doc.metadataDesigner, ...slots.map(slot => slot.designer)].map(name => (name || "").trim()).filter(Boolean))];
    if (names.length <= 1) { applyName(names[0] || ""); return; }
    checkbox.checked = false;
    let selected = 0;
    openDialog(body, { title: t("document.pick_the_canonical_designer"), width: 420, height: 260, opener: checkbox,
      body: h("div", { className: "designer-choice" }, h("p", {}, t("document.multiple_distinct_designer_names_were_detected")),
        select([...names, t("document.clear_all")].map((name, index) => [index, name]), selected, value => { selected = Number(value); })),
      actions: [{ label: t("action.cancel") }, { label: t("action.ok"), primary: true, run: () => applyName(names[selected] || "") }],
    });
  });
  const checkbox = mode.querySelector("input");
  body.append(mode);
  return openDialog(host, { title: t("document.designer_management"), body, width: 460, height: 426, opener,
    actions: [{ label: t("action.cancel") }, { label: t("action.ok"), primary: true, run: commit }],
  });
}

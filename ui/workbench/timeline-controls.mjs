import { element as h, button, icon } from "../components/dom.mjs";
import { check } from "../components/forms.mjs";
import { translate } from "../components/translate.mjs";

export const TIMELINE_ZOOM_PRESETS = Object.freeze([.25, .5, .75, 1, 1.5, 2, 3]);

export class TimelineControls {
  constructor(command, menu, popup, language) {
    this.command = command;
    this.popup = popup;
    this.language = language;
    this.state = { zoomScale: .5, waveformBrightness: .5, measureLineBrightness: 1, followPreviewEnabled: false };
    const t = key => translate(key, language());
    this.zoom = button(t("qml.timeline_zoom"), () => menu(this.zoom, TIMELINE_ZOOM_PRESETS.map(zoomScale =>
      [`${Math.round(zoomScale * 100)}%`, "timeline.settings", "", { zoomScale }, { role: "menuitemradio", checked: Math.abs(zoomScale - this.state.zoomScale) < 1e-6 }]), { above: true, className: "timeline-zoom-popup" }),
      { className: "chrome timeline-zoom", "aria-haspopup": "menu" });
    this.zoom.replaceChildren(h("span", {}, "50%"), icon("chevron-down", 12));
    this.brightness = button(t("qml.timeline_brightness"), () => this.showBrightness(),
      { className: "chrome timeline-brightness", symbol: "sliders-horizontal", iconOnly: true, "aria-haspopup": "dialog" });
    this.brightness.querySelector(".icon").style.width = "14px";
    this.brightness.querySelector(".icon").style.height = "14px";
    this.follow = check(t("shell.follow_code"), false, followPreviewEnabled => command("timeline.settings", { followPreviewEnabled }));
    this.follow.classList.add("timeline-follow");
    this.root = h("div", { className: "timeline-controls" }, this.zoom, this.brightness);
    this.measure = document.createElement("canvas").getContext("2d");
  }
  update(state) {
    Object.assign(this.state, state);
    this.zoom.firstChild.textContent = `${Math.round(this.state.zoomScale * 100)}%`;
    this.follow.querySelector("input").checked = this.state.followPreviewEnabled;
    const style = getComputedStyle(this.zoom);
    this.measure.font = `${style.fontSize} ${style.fontFamily}`;
    const widest = Math.max(...TIMELINE_ZOOM_PRESETS.map(value => this.measure.measureText(`${Math.round(value * 100)}%`).width));
    this.zoom.style.width = `${Math.ceil(widest) + 30}px`;
  }
  showBrightness() {
    const content = h("div", { className: "timeline-brightness-content" });
    for (const [key, label] of [["waveformBrightness", "shell.timeline_waveform_brightness"], ["measureLineBrightness", "shell.timeline_measure_line_brightness"]]) {
      const title = translate(label, this.language());
      const value = Math.round(this.state[key] * 100 / 5) * 5;
      const output = h("output", {}, `${value}%`);
      const input = h("input", { type: "range", min: 20, max: 200, step: 5, value, "aria-label": title });
      const paint = () => {
        output.value = `${input.value}%`;
        input.style.setProperty("--range-value", `${(Number(input.value) - 20) / 180 * 100}%`);
      };
      paint();
      input.addEventListener("input", () => { paint(); this.command("timeline.settings", { [key]: Number(input.value) / 100 }); });
      content.append(h("div", { className: "timeline-brightness-row" }, h("div", { className: "timeline-brightness-label" }, h("strong", {}, title), output), input));
    }
    this.popup(this.brightness, h("div", { className: "popover timeline-brightness-popup", role: "dialog", "aria-label": translate("qml.timeline_brightness", this.language()) }, content), { above: true, alignEnd: true });
  }
  headerLimits(viewport) {
    if (!this.root.checkVisibility()) return { headerLeftLimit: 0, headerRightLimit: Math.round(viewport.width) };
    const zoom = this.zoom.getBoundingClientRect(), brightness = this.brightness.getBoundingClientRect();
    return { headerLeftLimit: Math.round(zoom.right - viewport.left + 8), headerRightLimit: Math.round(brightness.left - viewport.left - 8) };
  }
}

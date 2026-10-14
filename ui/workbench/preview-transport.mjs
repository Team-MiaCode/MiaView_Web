import { element as h, button, icon } from "../components/dom.mjs";
import { translate } from "../components/translate.mjs";
import { PLAYBACK_RATES } from "../../renderer/playback.mjs";

export class PreviewTransport {
  constructor(command, menu, viewState) {
    this.state = { currentTime: 0, duration: 0, playing: false, rate: 1 };
    this.viewState = viewState;
    this.loaded = false;
    const t = key => translate(key, viewState.preferences.languageToken || "zh");
    this.seek = h("input", { type: "range", min: 0, max: 0, step: .001, value: 0, "aria-label": "播放位置" });
    let scrubbing = false;
    this.seek.addEventListener("pointerdown", () => { scrubbing = true; });
    this.seek.addEventListener("input", () => {
      this.paintTime(Number(this.seek.value), this.state.duration);
      command("preview.seek", { second: Number(this.seek.value) });
    });
    this.seek.addEventListener("change", () => { scrubbing = false; });
    this.seek.addEventListener("pointercancel", () => { scrubbing = false; });
    this.scrubbing = () => scrubbing;
    this.stop = button(t("preview.stop"), () => command("preview.stop"), { symbol: "stop", iconOnly: true, className: "chrome" });
    this.play = button(t("preview.play"), () => command("preview.toggle"), { symbol: "play", iconOnly: true, className: "chrome" });
    this.time = h("output", { className: "preview-time", "aria-live": "off" });
    this.positionText = h("span");
    this.durationText = h("span", { className: "preview-time-duration" });
    this.time.append(this.positionText, this.durationText);
    this.range = button(t("preview.range_mode"), () => command("preview.rangeMode", { enabled: !this.rangeEnabled }), { symbol: "range-play", iconOnly: true, className: "chrome", "aria-pressed": "false", hidden: true });
    this.rate = button("1x", () => menu(this.rate, PLAYBACK_RATES.map(rate => [`${rate}x`, "preview.rate", "", { rate }, { role: "menuitemradio", checked: rate === this.state.rate }])), { className: "chrome preview-rate", "aria-label": t("qml.playback_speed"), "aria-haspopup": "menu" });
    this.rate.replaceChildren(h("span", { className: "preview-rate-label" }, "1x"), icon("chevron-down", 12));
    this.canvas = button(t("preview.canvas.menu_tooltip"), () => menu(this.canvas, [
      [t("preview.canvas.free_aspect"), "preview.toggleFreeAspect", "", {}, { role: "menuitemcheckbox", checked: Boolean(viewState.preferences.previewCanvasFreeAspect) }],
      [t("preview.canvas.hide_pv"), "preview.toggleHidePv", "", {}, { role: "menuitemcheckbox", checked: Boolean(viewState.preferences.previewHidePv) }],
    ]), { symbol: "preview-settings", iconOnly: true, className: "chrome", "aria-haspopup": "menu" });
    this.detach = button(t("preview.window.detach"), () => command("preview.detach"), { symbol: "preview-detach", iconOnly: true, className: "chrome" });
    this.row = h("div", { className: "preview-control-row" }, this.stop, this.play, this.time, this.range, this.rate, this.canvas, this.detach);
    this.root = h("div", { className: "preview-transport", "aria-label": "播放控制", role: "group" }, this.seek, this.row);
    this.update(this.state);
  }
  setDocument(doc) {
    this.loaded = Boolean(doc.hasDocument);
    for (const node of this.root.querySelectorAll("button,input")) node.disabled = !this.loaded;
    this.range.hidden = !this.loaded || !doc.exportValues?.introEnabled && !doc.exportValues?.exportEndSeconds;
  }
  paintTime(second, duration) {
    const format = value => `${value < 0 ? "-" : ""}${String(Math.floor(Math.abs(value) / 60)).padStart(2, "0")}:${String(Math.floor(Math.abs(value) % 60)).padStart(2, "0")}`;
    this.positionText.textContent = format(second);
    this.durationText.textContent = ` / ${format(duration)}`;
  }
  update(state) {
    Object.assign(this.state, state, state.playback);
    this.seek.max = String(this.state.duration);
    if (!this.scrubbing()) this.seek.value = String(this.state.currentTime);
    const fraction = this.state.duration ? this.state.currentTime / this.state.duration : 0;
    this.seek.style.setProperty("--range-value", `${fraction * 100}%`);
    this.paintTime(this.state.currentTime, this.state.duration);
    const text = translate(this.state.playing ? "preview.pause" : "preview.play", this.viewState.preferences.languageToken || "zh");
    this.play.setAttribute("aria-label", text);
    this.play.title = text;
    this.play.replaceChildren(icon(this.state.playing ? "pause" : "play", 16));
    this.rate.firstChild.textContent = `${this.state.rate}x`;
    this.rangeEnabled = this.state.rangePlaybackEnabled ?? false;
    this.range.setAttribute("aria-pressed", String(this.rangeEnabled));
    this.range.replaceChildren(icon(this.rangeEnabled ? "range-play-active" : "range-play", 16));
  }
}

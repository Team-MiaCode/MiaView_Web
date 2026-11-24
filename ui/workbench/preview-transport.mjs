import { element as h, button, icon } from "../components/dom.mjs";
import { translate } from "../components/translate.mjs";
import { PLAYBACK_RATES } from "../../renderer/playback.mjs";

export class PreviewTransport {
  constructor(command, menu, viewState, transportActions) {
    this.state = { currentTime: 0, duration: 0, playing: false, rate: 1 };
    this.viewState = viewState;
    this.loaded = false;
    const t = key => translate(key, viewState.preferences.languageToken || "zh");
    this.seek = h("input", { type: "range", min: 0, max: 0, step: .001, value: 0, "aria-label": "播放位置" });
    this.rangeMarkers = h("div", { className: "preview-range-markers", "aria-hidden": "true", hidden: true },
      h("span", { className: "preview-range-start" }), h("span", { className: "preview-range-end" }));
    this.progress = h("div", { className: "preview-progress" }, this.seek, this.rangeMarkers);
    let scrubbing = false;
    this.seek.addEventListener("pointerdown", () => { scrubbing = true; command("preview.pause"); });
    this.seek.addEventListener("input", () => {
      const second = this.boundedSecond(Number(this.seek.value));
      this.seek.value = second;
      this.paintProgress(second);
      this.paintTime(second, this.state.duration);
      command("preview.seek", { second });
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
    this.documentControls = [this.seek, this.stop, this.play, this.range, this.rate];
    if (!transportActions) {
      const canvas = button(t("preview.canvas.menu_tooltip"), () => menu(canvas, [
        [t("preview.canvas.free_aspect"), "preview.toggleFreeAspect", "", {}, { role: "menuitemcheckbox", checked: Boolean(viewState.preferences.previewCanvasFreeAspect) }],
        [t("preview.canvas.hide_pv"), "preview.toggleHidePv", "", {}, { role: "menuitemcheckbox", checked: Boolean(viewState.preferences.previewHidePv) }],
      ]), { symbol: "preview-settings", iconOnly: true, className: "chrome", "aria-haspopup": "menu" });
      this.trailingAction = button(t("preview.window.detach"), () => command("preview.detach"),
        { symbol: "preview-detach", iconOnly: true, className: "chrome" });
      transportActions = [canvas, this.trailingAction];
      this.documentControls.push(...transportActions);
    }
    this.row = h("div", { className: "preview-control-row" }, this.stop, this.play, this.time, this.range, this.rate, ...transportActions);
    this.root = h("div", { className: "preview-transport", "aria-label": "播放控制", role: "group" }, this.progress, this.row);
    this.update(this.state);
  }
  setDocument(doc) {
    this.loaded = Boolean(doc.hasDocument);
    for (const node of this.documentControls) node.disabled = !this.loaded;
    this.setExportMode(this.viewState.activeEditorKey === "export");
  }
  setExportMode(enabled) {
    this.exportMode = enabled;
    this.range.hidden = !this.loaded || !enabled;
    this.rangeMarkers.hidden = !this.loaded || !enabled;
    this.paintProgress(Number(this.seek.value));
  }
  setDetached(detached) {
    this.trailingAction.setAttribute("aria-pressed", String(detached));
    const text = detached ? "嵌回预览" : translate("preview.window.detach", this.viewState.preferences.languageToken || "zh");
    this.trailingAction.setAttribute("aria-label", text); this.trailingAction.title = text;
  }
  paintTime(second, duration) {
    const format = value => `${value < 0 ? "-" : ""}${String(Math.floor(Math.abs(value) / 60)).padStart(2, "0")}:${String(Math.floor(Math.abs(value) % 60)).padStart(2, "0")}`;
    const positionText = format(second), durationText = ` / ${format(duration)}`;
    if (this.positionText.textContent !== positionText) this.positionText.textContent = positionText;
    if (this.durationText.textContent !== durationText) this.durationText.textContent = durationText;
  }
  boundedSecond(second) {
    if (!this.exportMode || !this.rangeEnabled) return second;
    const start = this.state.exportStartSeconds <= .01 ? this.state.minimum ?? 0 : this.state.exportStartSeconds;
    return Math.max(start, Math.min(this.state.exportEndSeconds, second));
  }
  paintProgress(second) {
    const minimum = this.state.minimum ?? 0, duration = this.state.duration;
    const fraction = value => duration > minimum ? Math.max(0, Math.min(1, (value - minimum) / (duration - minimum))) : 0;
    const rangeStart = this.state.exportStartSeconds <= .01 ? minimum : this.state.exportStartSeconds ?? 0;
    const rangeEnd = this.state.exportEndSeconds ?? duration;
    this.seek.style.setProperty("--range-value", `${fraction(second) * 100}%`);
    const position = value => `calc(6px + (100% - 12px) * ${fraction(value)})`;
    this.progress.style.setProperty("--range-start", fraction(rangeStart));
    this.progress.style.setProperty("--range-end", fraction(rangeEnd));
    this.seek.style.setProperty("--range-highlight-start", rangeStart <= minimum ? "0%" : position(rangeStart));
    this.seek.style.setProperty("--range-highlight-end", rangeEnd >= duration ? "100%" : position(rangeEnd));
    const playedSecond = Math.max(rangeStart, Math.min(rangeEnd, second));
    const playedPosition = playedSecond <= minimum ? "0%" : playedSecond >= duration ? "100%" : position(playedSecond);
    this.seek.style.setProperty("--range-playhead", playedPosition);
    this.seek.classList.toggle("range-playback", Boolean(this.loaded && this.exportMode && this.rangeEnabled));
  }
  update(state) {
    Object.assign(this.state, state, state.playback);
    const duration = String(this.state.duration), currentTime = String(this.state.currentTime);
    const minimum = this.state.minimum ?? 0;
    if (this.seek.min !== String(minimum)) this.seek.min = String(minimum);
    if (this.seek.max !== duration) this.seek.max = duration;
    if (!this.scrubbing() && this.seek.value !== currentTime) this.seek.value = currentTime;
    this.paintTime(this.state.currentTime, this.state.duration);
    const text = translate(this.state.playing ? "preview.pause" : "preview.play", this.viewState.preferences.languageToken || "zh");
    if (this.play.getAttribute("aria-label") !== text) { this.play.setAttribute("aria-label", text); this.play.title = text; }
    const playIcon = this.state.playing ? "pause" : "play";
    if (this.play.firstChild?.dataset.icon !== playIcon) this.play.replaceChildren(icon(playIcon, 16));
    const rate = `${this.state.rate}x`;
    if (this.rate.firstChild.textContent !== rate) this.rate.firstChild.textContent = rate;
    this.rangeEnabled = this.state.rangePlaybackEnabled ?? false;
    this.paintProgress(Number(this.seek.value));
    this.range.setAttribute("aria-pressed", String(this.rangeEnabled));
    const rangeIcon = this.rangeEnabled ? "range-play-active" : "range-play";
    if (this.range.firstChild?.dataset.icon !== rangeIcon) this.range.replaceChildren(icon(rangeIcon, 16));
  }
}

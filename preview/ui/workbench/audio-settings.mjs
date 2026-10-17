import { element as h, button, icon } from "../components/dom.mjs";
import { range, toggle } from "../components/forms.mjs";
import { translate } from "../components/translate.mjs";

const channels = [["global", "global"], ["track", "track"], ["answer", "answer"], ["tap", "tap"], ["ex", "ex"], ["break", "break"], ["breakSlide", "break_slide"], ["slide", "slide"], ["touch", "touch"], ["firework", "firework"], ["intro", "intro"]];

export function createAudioSettings({ viewState, documentSession, command }) {
  const values = documentSession.audio?.channels || {};
  const t = key => translate(key, viewState.preferences.languageToken || "zh");
  const root = h("div", { className: "audio-settings native-form" });
  const mixer = h("div", { className: "audio-mixer", "aria-label": t("action.audio_settings") });
  for (const [key, token] of channels) {
    const state = values[key] || { percent: 100, muted: false };
    const label = t(`dialog.render_settings.audio.${token}`);
    const level = range(label, key, state.percent, 0, 100, (_, args) => {
      command("audio.channelPercent", { key, percent: args.value });
    }, 1, "%");
    const control = level.querySelector(".range-field");
    const mute = button(t(state.muted ? "qml.unmute" : "qml.mute"), () => {
      command("audio.channelMuted", { key, muted: mute.getAttribute("aria-pressed") !== "true" });
    }, { symbol: state.muted ? "volume-x" : "volume-2", iconOnly: true, className: "chrome", "aria-pressed": String(state.muted) });
    mixer.append(h("div", { className: "audio-channel", dataset: { channel: key } }, h("span", { className: "form-label" }, label), mute, control));
  }
  root.append(mixer, toggle(t("qml.mute_break_star_tail_judgement_sound"), documentSession.audio?.breakSlideTailCheerMuted ?? false, value => command("audio.breakSlideTailCheerMuted", { value }), "audio-tail-cheer"),
    h("div", { className: "action-row" }, button(t("qml.set_as_local_default"), () => command("audio.saveAsSoftwareDefault")), button(t("qml.restore_local_defaults"), () => command("audio.restoreSoftwareDefault")), button(t("action.close"), () => command("editor.close", { key: "audio-settings" }))));
  return root;
}

export function updateAudioSettings(root, audio, language) {
  for (const channel of root.querySelectorAll("[data-channel]")) {
    const state = audio.channels[channel.dataset.channel];
    const input = channel.querySelector('input[type="range"]');
    input.value = state.percent;
    input.style.setProperty("--range-value", `${state.percent}%`);
    const output = channel.querySelector("output");
    if (!output.querySelector("input")) output.value = `${state.percent}%`;
    output.setAttribute("aria-label", `${input.getAttribute("aria-label")} ${state.percent}%`);
    const mute = channel.querySelector("button");
    if (mute.getAttribute("aria-pressed") !== String(state.muted)) mute.querySelector(".icon").replaceWith(icon(state.muted ? "volume-x" : "volume-2", 18));
    mute.setAttribute("aria-pressed", String(state.muted));
    mute.title = translate(state.muted ? "qml.unmute" : "qml.mute", language);
    mute.setAttribute("aria-label", mute.title);
  }
  root.querySelector("#audio-tail-cheer").checked = audio.breakSlideTailCheerMuted;
}

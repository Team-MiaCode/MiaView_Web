import { element as h, button, icon } from "../components/dom.mjs";
import { range, toggle } from "../components/forms.mjs";
import { translate } from "../components/translate.mjs";

const channels = [["global", "global"], ["track", "track"], ["answer", "answer"], ["tap", "tap"], ["ex", "ex"], ["break", "break"], ["breakSlide", "break_slide"], ["slide", "slide"], ["touch", "touch"], ["firework", "firework"], ["intro", "intro"]];

export function createAudioSettings({ viewState, command }) {
  const values = viewState.preferences.audioChannels ||= {};
  const t = key => translate(key, viewState.preferences.languageToken || "zh");
  const root = h("div", { className: "audio-settings native-form" });
  const mixer = h("div", { className: "audio-mixer", "aria-label": t("action.audio_settings") });
  for (const [key, token] of channels) {
    const state = values[key] ||= { percent: 100, muted: false };
    const label = t(`dialog.render_settings.audio.${token}`);
    const level = range(label, key, state.percent, 0, 100, (_, args) => {
      state.percent = args.value; command("audio.channelPercent", { key, percent: args.value });
    }, 1, "%");
    const control = level.querySelector(".range-field");
    const mute = button(t(state.muted ? "qml.unmute" : "qml.mute"), () => {
      state.muted = !state.muted;
      command("audio.channelMuted", { key, muted: state.muted });
      const replacement = icon(state.muted ? "volume-x" : "volume-2", 18);
      mute.querySelector(".icon").replaceWith(replacement);
      mute.setAttribute("aria-pressed", String(state.muted));
      mute.setAttribute("aria-label", t(state.muted ? "qml.unmute" : "qml.mute"));
      mute.title = t(state.muted ? "qml.unmute" : "qml.mute");
    }, { symbol: state.muted ? "volume-x" : "volume-2", iconOnly: true, className: "chrome", "aria-pressed": String(state.muted) });
    mixer.append(h("div", { className: "audio-channel", dataset: { channel: key } }, h("span", { className: "form-label" }, label), mute, control));
  }
  root.append(mixer, toggle(t("qml.mute_break_star_tail_judgement_sound"), viewState.preferences.breakSlideTailCheerMuted ?? false, value => command("audio.breakSlideTailCheerMuted", { value })),
    h("div", { className: "action-row" }, button(t("qml.set_as_local_default"), () => command("audio.saveAsSoftwareDefault")), button(t("qml.restore_local_defaults"), () => command("audio.restoreSoftwareDefault")), button(t("action.close"), () => command("editor.close", { key: "audio-settings" }))));
  return root;
}

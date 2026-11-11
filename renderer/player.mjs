import { createPlayerEngine } from "./player-engine.mjs";
import { createPlayerController } from "./player-controller.mjs";
import { attachPlayerControls } from "./player-controls.mjs";
import { attachSdkBridge } from "./sdk-bridge.mjs";
import { previewTheme } from "./protocol.mjs";

const parameters = new URLSearchParams(location.search);
document.documentElement.dataset.theme = previewTheme(parameters.get("theme") || "dark");
let controls;
const engine = createPlayerEngine({
  chart: chart => controls?.chart(chart),
  theme: theme => controls?.theme(theme),
  audio: audio => controls?.audio(audio),
  destroy: () => controls?.destroy(),
});
const controller = createPlayerController(engine);
if (parameters.get("controls") !== "0") controls = attachPlayerControls(controller, engine, parameters);
const boot = controls?.boot ?? engine.boot;
void boot.catch(engine.fail);
attachSdkBridge({ ...engine, boot }, controller);

window.addEventListener("pagehide", event => { if (!event.persisted) engine.clear(); });

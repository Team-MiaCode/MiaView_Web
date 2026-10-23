import { createPlayerEngine } from "./player-engine.mjs";
import { createPlayerController } from "./player-controller.mjs";
import { attachPlayerControls } from "./player-controls.mjs";
import { attachSdkBridge } from "./sdk-bridge.mjs";

let controls;
const engine = createPlayerEngine({
  settings: (settings) => controls?.settings(settings),
  chart: (chart) => controls?.chart(chart),
  transport: (currentTime, duration, minimum) => controls?.transport(currentTime, duration, minimum),
  theme: theme => controls?.theme(theme),
});
const controller = createPlayerController(engine);
controls = attachPlayerControls(controller, engine);
attachSdkBridge(engine, controller);

window.addEventListener("pagehide", () => engine.clear(), { once: true });

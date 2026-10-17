import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TRANSPORT_HEIGHT } from "../sdk/layout.mjs";
import { readUiTheme } from "./sync-ui.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function syncTheme(source = join(root, "vendor/MiaCode"), revision = "working tree") {
  const qml = readFileSync(join(source, "src/app/ui/theme/Theme.qml"), "utf8");
  const extracted = readUiTheme(qml);
  const tokens = { surface: "background.surface", panel: "background.panel",
    elevated: "background.elevated", control: "background.control", border: "border.normal",
    "control-border": "border.control", text: "text.active", muted: "text.secondary",
    disabled: "text.disabled", accent: "accent.primary", hover: "state.hover",
    pressed: "state.pressed", "slider-rail": "slider.rail", "slider-fill": "slider.fill" };
  const palettes = Object.entries(extracted.themes).map(([theme, colors]) => {
    const values = Object.entries(tokens).map(([name, path]) => {
      const color = colors[path.replace(".", "-").replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)];
      if (!color) throw new Error(`MiaCode theme token ${path} changed; update the adapter`);
      return `  --${name}: ${color};`;
    });
    const scheme = theme === "light" || theme === "legacy_light" ? "light" : "dark";
    return `${theme === "dark" ? ":root" : `:root[data-theme="${theme}"]`} {\n  color-scheme: ${scheme};\n${values.join("\n")}\n}`;
  });
  const fontSize = qml.match(/readonly property int uiFontSize:[^\n]*: (\d+)/)?.[1];
  if (!fontSize) throw new Error("MiaCode default font size changed; review the theme adapter");
  writeFileSync(join(root, "renderer/theme.css"),
    `/* Generated from MiaCode Theme.qml (${revision}); run scripts/sync-theme.mjs. */\n` +
    `:root { --transport-height: ${TRANSPORT_HEIGHT}px; --ui-font-size: ${fontSize}px; }\n` + palettes.join("\n") + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncTheme(process.env.MIACODE_SOURCE_DIR);

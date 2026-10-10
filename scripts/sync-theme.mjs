import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TRANSPORT_HEIGHT } from "../sdk/layout.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function syncTheme(source = join(root, "vendor/MiaCode"), revision = "working tree") {
  const qml = readFileSync(join(source, "src/app/ui/theme/Theme.qml"), "utf8");
  const tokens = { surface: "background.surface", panel: "background.panel",
    elevated: "background.elevated", control: "background.control", border: "border.normal",
    "control-border": "border.control", text: "text.active", muted: "text.secondary",
    disabled: "text.disabled", accent: "accent.primary", hover: "state.hover",
    pressed: "state.pressed", "slider-rail": "slider.rail", "slider-fill": "slider.fill" };
  const palettes = ["dark", "light"].map(theme => {
    const block = qml.match(new RegExp(`readonly property var ${theme}Colors: \\(([\\s\\S]*?)\\n    \\}\\)`))?.[1];
    if (!block) throw new Error(`MiaCode ${theme} palette changed; review the theme adapter`);
    const values = Object.entries(tokens).map(([name, path]) => {
      const [group, key] = path.split(".");
      const fields = block.match(new RegExp(`\\b${group}: \\{([^}]+)\\}`))?.[1];
      const color = fields?.match(new RegExp(`\\b${key}: "(#[a-fA-F0-9]{6})"`))?.[1];
      if (!color) throw new Error(`MiaCode theme token ${path} changed; update the adapter`);
      return `  --${name}: ${color};`;
    });
    return `${theme === "dark" ? ":root" : ':root[data-theme="light"]'} {\n  color-scheme: ${theme};\n${values.join("\n")}\n}`;
  });
  const fontSize = qml.match(/readonly property int uiFontSize:[^\n]*: (\d+)/)?.[1];
  if (!fontSize) throw new Error("MiaCode default font size changed; review the theme adapter");
  writeFileSync(join(root, "renderer/theme.css"),
    `/* Generated from MiaCode Theme.qml (${revision}); run scripts/sync-theme.mjs. */\n` +
    `:root { --transport-height: ${TRANSPORT_HEIGHT}px; --ui-font-size: ${fontSize}px; }\n` + palettes.join("\n") + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncTheme(process.env.MIACODE_SOURCE_DIR);

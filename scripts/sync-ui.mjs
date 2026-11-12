import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssName = value => value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
export function readUiTheme(qml, palettes) {
  const themes = {};
  for (const token of ["dark", "light", "legacy", "legacy_light"]) {
    const palette = palettes.themes[token]?.colors;
    if (!palette) throw new Error(`Missing theme palette: ${token}`);
    const colors = {};
    for (const [group, fields] of Object.entries(palette)) {
      for (const [field, value] of Object.entries(fields)) {
        // Qt puts alpha first in eight-digit colors. CSS puts it last.
        colors[`${cssName(group)}-${cssName(field)}`] =
          /^#[a-f0-9]{8}$/i.test(value) ? `#${value.slice(3)}${value.slice(1, 3)}` : value;
      }
    }
    themes[token] = colors;
  }
  const metrics = {};
  for (const match of qml.matchAll(/readonly property (?:int|real) (\w+): (\d+(?:\.\d+)?)\s*$/gm)) metrics[match[1]] = Number(match[2]);
  const difficultyColors = qml.match(/readonly property var difficultyColors:\s*\[([\s\S]*?)\]/)?.[1].match(/#[A-Fa-f0-9]{6}/g);
  return { themes, metrics, difficultyColors, uiFontSize: Number(qml.match(/readonly property int uiFontSize:[^\n]*: (\d+)/)?.[1]) };
}

export function syncUi(source = resolve(root, "vendor/MiaCode")) {
  const qml = readFileSync(join(source, "src/app/ui/theme/Theme.qml"), "utf8");
  const palettes = JSON.parse(readFileSync(join(source, "resources/themes/palettes.json"), "utf8"));
  const data = readUiTheme(qml, palettes);
  const output = resolve(root, "ui/components");
  mkdirSync(join(output, "icons"), { recursive: true });
  const blocks = Object.entries(data.themes).map(([name, colors]) => {
    const scheme = name === "light" || name === "legacy_light" ? "light" : "dark";
    return `:root${name === "dark" ? "" : `[data-theme="${name}"]`} {\n  color-scheme: ${scheme};\n` +
      Object.entries(colors).map(([key, value]) => `  --${key}: ${value};`).join("\n") + "\n}";
  });
  blocks.push(`:root {\n  --ui-font-size: ${data.uiFontSize}px;\n  --heading-font-size: calc(var(--ui-font-size) + 2px);\n  --section-title-font-size: var(--ui-font-size);\n  --secondary-font-size: calc(var(--ui-font-size) - 1px);\n  --caption-font-size: calc(var(--ui-font-size) - 3px);\n` +
    Object.entries(data.metrics).map(([key, value]) => `  --${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${value}px;`).join("\n") +
    "\n" + data.difficultyColors.map((color, index) => `  --difficulty-${index + 1}: ${color};`).join("\n") + "\n}\n");
  writeFileSync(join(output, "theme.css"), '@import url("./fonts.css");\n\n' + blocks.join("\n").trimEnd() + "\n");
  writeFileSync(join(output, "theme.json"), JSON.stringify(data, null, 2) + "\n");
  const icons = join(source, "src/app/ui/resources/icons");
  for (const name of readdirSync(icons).filter(name => name.endsWith(".svg"))) copyFileSync(join(icons, name), join(output, "icons", name));
  for (const name of ["app-titlebar.png", "app-titlebar@2x.png"]) copyFileSync(join(icons, name), join(output, "icons", name));
  copyFileSync(join(source, "resources/icons/app.png"), join(output, "icons/app.png"));
  const packageInfo = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const toolchain = JSON.parse(readFileSync(join(root, "native/toolchain.json"), "utf8"));
  const buildInfo = { version: packageInfo.version, platform: `WebAssembly / ${toolchain.wasmArch} / Qt ${toolchain.qtVersion}`, buildType: "Release" };
  writeFileSync(join(output, "build-info.mjs"), `export const buildInfo = Object.freeze(${JSON.stringify(buildInfo, null, 2)});\n`);
  const shortcutSource = JSON.parse(readFileSync(join(source, "resources/shortcuts.json"), "utf8"));
  // The browser owns page zoom. These gestures resize the chart editor font.
  const editorFontActions = {
    "ui.zoom_out": ["editor.font_decrease", "Decrease Editor Font"],
    "ui.zoom_in": ["editor.font_increase", "Increase Editor Font"],
  };
  const shortcutDefinitions = shortcutSource.editable.filter(id => id !== "ui.zoom_reset").map(id => {
    const item = shortcutSource.actions[id];
    const fontAction = editorFontActions[id];
    if (fontAction) return { id: fontAction[0], labelKey: `shortcut.${fontAction[0]}`, labelFallback: fontAction[1], shortcutText: item.default, defaultText: item.default, isDefault: true };
    return { id, labelKey: item.label_key || "", labelFallback: item.label_en || id, shortcutText: item.default || "", defaultText: item.default || "", isDefault: true };
  });
  writeFileSync(join(output, "shortcut-definitions.mjs"), `export const shortcutDefinitions = Object.freeze(${JSON.stringify(shortcutDefinitions, null, 2)});\n`);
  for (const skin of ["SD", "DX"]) {
    const target = join(output, "notes", skin);
    mkdirSync(target, { recursive: true });
    for (const kind of ["tap", "hold", "slide", "touch", "tap_break"]) copyFileSync(join(source, "assets/skin", `skin${skin}`, `${kind}.png`), join(target, `${kind}.png`));
  }
  console.log(`Synchronized ${Object.keys(data.themes).length} themes and ${Object.keys(data.metrics).length} UI metrics`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncUi(process.env.MIACODE_UI_SOURCE_DIR);

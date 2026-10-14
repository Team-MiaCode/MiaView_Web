import { element as h, button, section } from "../components/dom.mjs";
import { select, text, range, toggle, formRow } from "../components/forms.mjs";
import { settingsTabs } from "../components/settings-tabs.mjs";
import { translate } from "../components/translate.mjs";
import { DIFFICULTY_NAMES } from "./chart-sidebar.mjs";
import { CoverCanvas, COVER_RESOLUTIONS as sizes } from "./cover-canvas.mjs";


export function createCoverEditor({ viewState, documentSession: doc, command, nativeCover = false }) {
  const dispatch = command;
  let renderer;
  const t = key => translate(key, viewState.preferences.languageToken || "zh");
  const values = doc.coverValues ||= {};
  const layers = doc.coverLayers || [];
  const root = h("div", { className: "cover-editor" });
  const acceptComposition = (value, refresh = true) => {
    doc.coverLayers = value.layout.layers;
    values.activeLayerKey = value.activeLayerKey;
    dispatch("cover.canvasChanged", value);
    if (!refresh) return;
    const controls = createCoverEditor({ viewState, documentSession: doc, command, nativeCover: false });
    root.querySelector(".cover-layer-list").replaceWith(controls.querySelector(".cover-layer-list"));
    root.querySelector(".cover-layer-actions").replaceWith(controls.querySelector(".cover-layer-actions"));
    root.querySelector(".cover-inspector").replaceWith(controls.querySelector(".cover-inspector"));
  };
  if (nativeCover) command = (id, args = {}) => {
    if (!renderer) return dispatch(id, args);
    if (id === "cover.selectLayerKey") {
      values.activeLayerKey = args.key;
      return renderer.preview.setCoverComposition({ activeLayerKey: args.key }).then(value => acceptComposition(value));
    }
    if (id === "cover.layer" || ["cover.setLayerVisible", "cover.setLayerLocked"].includes(id)) {
      const layer = doc.coverLayers?.find(layer => layer.key === args.key);
      if (layer) {
        const { key, ...fields } = args;
        Object.assign(layer, fields);
      }
      const refresh = "visible" in args || "locked" in args;
      return renderer.update().then(value => acceptComposition(value, refresh));
    }
    if (id === "cover.settings") return renderer.update().then(value => acceptComposition(value, false));
    return dispatch(id, args);
  };
  const activeLayer = () => layers.find(layer => layer.key === values.activeLayerKey);
  const name = layer => t({ card: "cover.difficulty_card", chartFrame: "cover.chart_frame", image: "cover.image_layer", text: "cover.text_layer_default" }[layer.kind]) || layer.label;
  const put = (key, value) => { values[key] = value; command("cover.settings", { [key]: value }); };
  const setLayer = (key, value) => command("cover.layer", { key: values.activeLayerKey, [key]: value });
  const input = (key, fallback = "") => text(key, values[key] ?? fallback, (_, args) => put(key, args.value));
  const choice = (key, label, options, fallback, action) => formRow(t(label), select(options, values[key] ?? fallback, value => put(key, typeof fallback === "number" ? Number(value) : value)), action);
  const slider = (key, label, fallback, min = 0, max = 100, factor = 1) => range(t(label), key, (values[key] ?? fallback) * factor, min, max, (_, args) => put(key, args.value / factor), 1, "%");
  const switchControl = (key, label, fallback) => toggle(t(label), values[key] ?? fallback, value => put(key, value));
  const fontOptions = [["", t("card_font.default")], ...(doc.userFonts || []).map(font => [font.path, font.family])];
  const canvasForm = () => [
    choice("resolutionIndex", "cover.size", sizes.map(([width, height], index) => [index, `${width}×${height} (${width === height ? "1:1" : width * 3 === height * 4 ? "4:3" : "16:9"})`]), 3),
    formRow(t("cover.output"), input("outputFile", "card.jpg"), button(t("cover.browse"), () => command("cover.browseOutputFile"), { symbol: "folder-open", iconOnly: true, className: "chrome" })),
    section(t("cover.background"),
      choice("backgroundMode", "cover.background", [[0, t("cover.jacket")], [1, t("cover.custom_image")], [2, t("cover.transparent")]], 0, button(t("cover.choose_background_image"), () => command("cover.browseBackgroundImage"), { symbol: "folder-open", iconOnly: true, className: "chrome" })),
      slider("backgroundBrightness", "cover.brightness", .45, 0, 100, 100), switchControl("blurBackground", "cover.blur_background", true)),
  ];
  const layerForm = () => {
    const layer = activeLayer();
    if (!layer) return [h("p", { className: "caption" }, t("cover.select_a_chart_frame_layer"))];
    const layerSlider = (key, label, fallback, min = 0, max = 100, factor = 100, suffix = "%") => range(t(label), key, (layer[key] ?? fallback) * factor, min, max, (_, args) => setLayer(key, args.value / factor), factor === 1 ? .01 : 1, suffix);
    const layerText = (key, label, fallback) => formRow(t(label), text(key, layer[key] ?? fallback, (_, args) => setLayer(key, args.value)));
    const body = [h("div", { className: "cover-layer-heading" }, h("h2", {}, name(layer)),
      button(t(layer.visible ? "cover.hide" : "cover.show"), () => setLayer("visible", !layer.visible), { symbol: layer.visible ? "eye" : "eye-off", iconOnly: true, className: "chrome", "aria-pressed": String(layer.visible) }),
      button(t(layer.locked ? "cover.unlock" : "cover.lock"), () => setLayer("locked", !layer.locked), { symbol: layer.locked ? "lock" : "lock-open", iconOnly: true, className: "chrome", "aria-pressed": String(layer.locked) })),
      layerSlider("opacity", "cover.opacity", 1), layerSlider("sizeFraction", "cover.size", .85, 5, 150)];
    if (layer.kind === "image") body.push(section(t("cover.image_options"), formRow(t("cover.image_file"), button(t("cover.choose_image"), () => command("cover.browseActiveLayerImage")))));
    if (layer.kind === "text") {
      const swatch = h("span", { className: "cover-color-swatch", "aria-hidden": "true" });
      swatch.style.backgroundColor = layer.textColor ?? "#FFFFFF";
      const colorRow = formRow(t("cover.text_color"), text("textColor", layer.textColor ?? "#FFFFFF", (_, args) => {
        swatch.style.backgroundColor = args.value;
        setLayer("textColor", args.value);
      }), swatch);
      colorRow.classList.add("cover-color-row");
      body.push(section(t("cover.text_options"), layerText("text", "cover.text_content", ""), colorRow,
        h("div", { className: "action-row" }, toggle(t("cover.bold"), layer.textBold ?? false, value => setLayer("textBold", value)), button(t("card_font.import"), () => command("cover.importActiveLayerFont")))));
    }
    if (layer.kind === "chartFrame") body.push(section(t("cover.chart_frame"),
      layerSlider("frameSeconds", "cover.frame_time", 0, 0, doc.duration ?? 0, 1, "s"),
      button(t("cover.play_pause_space"), () => command("cover.toggleActiveLayerPlayback"), { symbol: doc.chartFramePlaying ? "pause" : "play", iconOnly: true, className: "chrome" }),
      formRow(t("cover.inner"), select([["transparent", t("cover.transparent")], ["image", t("cover.inner_bg")], ...(doc.metadataHasVideo ? [["pv", t("cover.inner_pv_fill")], ["pvFit", t("cover.inner_pv_fit")]] : [])], layer.frameBgMode ?? "image", value => setLayer("frameBgMode", value))),
      layerSlider("frameBgBrightness", "cover.brightness", .8), layerSlider("frameBgTransparency", "cover.transparency", .5)));
    if (layer.kind === "card") body.push(section(t("cover.difficulty_card_options"),
      choice("cardMode", "cover.chart_type", [["auto", t("qml.automatic")], ["DX", "DX"], ["Standard", "SD"]], "auto"),
      choice("longTextMode", "cover.long_text_label", [["shrink", t("cover.shrink_to_fit")], ["ellipsis", t("cover.keep_size_ellipsis")]], "shrink"),
      h("div", { className: "action-row" }, switchControl("cardShadow", "cover.shadow", false), switchControl("levelTextRender", "cover.level_as_text", false))),
      section(t("cover.font"), choice("cardFontDisplayPath", "cover.title_font", fontOptions, "", button(t("card_font.import"), () => command("cover.importCardDisplayFont"), { symbol: "folder-open", iconOnly: true, className: "chrome" })),
        choice("cardFontBodyPath", "cover.body_font", fontOptions, "", button(t("card_font.import"), () => command("cover.importCardBodyFont"), { symbol: "folder-open", iconOnly: true, className: "chrome" }))));
    return body;
  };
  const canvas = h(nativeCover ? "div" : "canvas", { id: "cover-canvas", "aria-label": t("cover.canvas") });
  const [width, height] = sizes[values.resolutionIndex ?? 3];
  canvas.width = width; canvas.height = height;
  if (!nativeCover) canvas.style.aspectRatio = `${width}/${height}`;
  const canvasPane = h("div", { className: "cover-canvas-pane" }, canvas);
  function setZoom(value) {
    values.canvasZoom = Math.max(.5, Math.min(2, value));
    canvas.style.transform = `scale(${values.canvasZoom})`;
  }
  root.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === "0") setZoom(1);
    else if (["+", "="].includes(event.key)) setZoom((values.canvasZoom ?? 1) * 1.25);
    else if (event.key === "-") setZoom((values.canvasZoom ?? 1) / 1.25);
    else return;
    event.preventDefault();
  });
  const inspector = settingsTabs([{ key: "canvas", label: t("cover.canvas"), render: canvasForm }, { key: "layer", label: t("cover.layer"), render: layerForm }], values.inspectorTab, key => { values.inspectorTab = key; });
  inspector.classList.add("cover-inspector");
  const layerList = h("div", { id: "cover-layers", className: "cover-layer-list", role: "listbox", "aria-label": t("cover.layers") });
  const orderedLayers = [...layers].sort((a, b) => b.z - a.z);
  function selectLayer(layer) {
    values.activeLayerKey = layer.key;
    command("cover.selectLayerKey", { key: layer.key });
    for (const node of layerList.children) {
      const selected = node.dataset.key === layer.key;
      node.setAttribute("aria-selected", String(selected));
      node.tabIndex = selected ? 0 : -1;
    }
    for (const node of layerActions.children) node.disabled = !activeLayer() || node.dataset.mutable === "true" && layer.key === "card";
    inspector.querySelector('[data-page="layer"]').click();
  }
  function layerDetail(layer) {
    const value = layer.kind === "text" ? layer.text?.replace(/\s+/g, " ") : layer.kind === "image" ? layer.imagePath?.split(/[\\/]/).at(-1)
      : layer.kind === "chartFrame" ? `${(layer.frameSeconds ?? 0).toFixed(2)} s` : "";
    const state = layer.visible ? `${Math.round((layer.opacity ?? 1) * 100)}%` : t("cover.layer_hidden");
    return value ? `${value} · ${state}` : state;
  }
  for (const [index, layer] of orderedLayers.entries()) {
    const thumbnail = h("div", { className: "cover-layer-thumbnail", "aria-hidden": "true" });
    if (doc.coverLayerPreviews?.[layer.key]) thumbnail.append(h("img", { src: doc.coverLayerPreviews[layer.key], alt: "" }));
    const row = h("div", { className: "cover-layer-row", role: "option", tabIndex: values.activeLayerKey === layer.key || !values.activeLayerKey && index === 0 ? 0 : -1,
      "aria-selected": String(values.activeLayerKey === layer.key), "aria-label": name(layer), "aria-description": layerDetail(layer), dataset: { key: layer.key, visible: layer.visible }, draggable: true,
      onClick: () => selectLayer(layer) }, thumbnail,
      h("div", { className: "cover-layer-caption" }, h("span", { className: "cover-layer-name" }, name(layer)), h("span", { className: "cover-layer-detail" }, layerDetail(layer))),
      h("div", { className: "cover-layer-controls" },
        button(t(layer.visible ? "cover.hide" : "cover.show"), event => { event.stopPropagation(); command("cover.setLayerVisible", { key: layer.key, visible: !layer.visible }); }, { symbol: layer.visible ? "eye" : "eye-off", iconOnly: true, className: "chrome" }),
        button(t(layer.locked ? "cover.unlock" : "cover.lock"), event => { event.stopPropagation(); command("cover.setLayerLocked", { key: layer.key, locked: !layer.locked }); }, { symbol: layer.locked ? "lock" : "lock-open", iconOnly: true, className: "chrome" })));
    row.addEventListener("keydown", event => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.target !== row) return;
      if (["ArrowUp", "ArrowDown"].includes(event.key)) {
        const target = Math.max(0, Math.min(orderedLayers.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
        selectLayer(orderedLayers[target]); layerList.children[target].focus();
      } else if (["Enter", " "].includes(event.key)) selectLayer(layer);
      else if (["Delete", "Backspace"].includes(event.key) && layer.key !== "card") command("cover.removeActiveLayer");
      else if (event.key.toLowerCase() === "v") command("cover.setLayerVisible", { key: layer.key, visible: !layer.visible });
      else if (event.key.toLowerCase() === "l") command("cover.setLayerLocked", { key: layer.key, locked: !layer.locked });
      else return;
      event.preventDefault();
    });
    row.addEventListener("dragstart", event => { selectLayer(layer); event.dataTransfer.setData("application/x-miacode-cover-layer", layer.key); event.dataTransfer.effectAllowed = "move"; });
    row.addEventListener("dragover", event => { if (event.dataTransfer.types.includes("application/x-miacode-cover-layer")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } });
    row.addEventListener("drop", event => { const key = event.dataTransfer.getData("application/x-miacode-cover-layer"); if (key) { event.preventDefault(); command("cover.moveLayer", { key, viewRow: index }); } });
    layerList.append(row);
  }
  const addMenu = h("details", { className: "cover-menu" }, h("summary", { "aria-label": t("cover.add_layer") }, t("cover.add_layer")), h("div", { className: "cover-menu-items" },
    ...[["cover.add_chart_frame", "cover.addChartFrameLayer"], ["cover.add_image", "cover.addImageLayer"], ["cover.add_text", "cover.addTextLayer"]].map(([key, id]) => button(t(key), () => { addMenu.open = false; command(id); }))));
  const layerActions = h("div", { className: "cover-layer-actions" }, ...[["cover.move_up", "cover.raiseActiveLayer", "arrow-up"], ["cover.move_down", "cover.lowerActiveLayer", "arrow-down"], ["cover.duplicate_layer", "cover.duplicateActiveLayer", "copy"], ["cover.delete_layer", "cover.removeActiveLayer", "trash"]].map(([key, id, symbol]) => button(t(key), () => command(id), { symbol, iconOnly: true, className: "chrome", dataset: { mutable: ["copy", "trash"].includes(symbol) }, disabled: !activeLayer() || ["copy", "trash"].includes(symbol) && values.activeLayerKey === "card" })));
  const layerPane = h("aside", { className: "cover-layers-pane" }, h("header", { className: "panel-heading" }, t("cover.layers"), h("span", { className: "spacer" }), addMenu), layerList, layerActions);
  const layoutMenu = h("details", { className: "cover-menu" }, h("summary", {}, t("cover.layout")), h("div", { className: "cover-menu-items" },
    ...[["cover.reset_to_default", "cover.resetLayout"], ["cover.save_layout_to_file", "cover.saveLayout"], ["cover.import_layout_file", "cover.importLayout"], ["cover.manage_presets", "cover.managePresets"]].map(([key, id]) => button(t(key), () => { layoutMenu.open = false; command(id); }))));
  root.append(h("div", { className: "cover-topbar" },
    h("div", { className: "export-difficulties" }, ...(doc.charts || []).map(chart => {
      const node = button(chart.name || DIFFICULTY_NAMES[chart.id - 1], () => command("cover.selectDifficulty", { difficultyId: chart.id }), { "aria-pressed": String((values.selectedDifficultyId ?? doc.activeDifficultyId) === chart.id) });
      node.prepend(h("span", { className: "difficulty-swatch", style: `background: var(--difficulty-${chart.id})`, "aria-hidden": "true" }));
      return node;
    })),
    layoutMenu, button(t("cover.export"), () => command("cover.export"), { className: "primary" })),
    h("div", { className: "cover-rule", "aria-hidden": "true" }),
    h("div", { className: "cover-panes" }, layerPane, canvasPane, inspector));
  if (nativeCover) {
    renderer = new CoverCanvas(canvas, doc, value => acceptComposition(value), message => dispatch("cover.error", { message }), viewState.activeThemeToken);
    renderer.ready.then(value => acceptComposition(value)).catch(() => {});
    root.coverRenderer = renderer;
    root.destroy = () => renderer.destroy();
  }
  setZoom(values.canvasZoom ?? 1);
  return root;
}

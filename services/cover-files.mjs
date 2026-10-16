export const COVER_RESOLUTIONS = [[720, 720], [960, 720], [1280, 720], [1080, 1080], [1440, 1080], [1920, 1080], [1440, 1440], [1920, 1440], [2560, 1440]];

export function coverResolution(values = {}) {
  return COVER_RESOLUTIONS[values.resolutionIndex ?? 3] || [values.outputWidth, values.outputHeight];
}

export function coverValuesFromComposition(composition) {
  const { size, background, card } = composition;
  return { resolutionIndex: COVER_RESOLUTIONS.findIndex(([w, h]) => w === size.w && h === size.h), outputWidth: size.w, outputHeight: size.h,
    backgroundMode: ["jacket", "custom", "transparent"].indexOf(background.mode), backgroundPath: background.customPath,
    backgroundBrightness: background.brightness, blurBackground: background.blur,
    cardMode: card.mode, cardShadow: card.shadow, levelTextRender: card.levelTextRender, longTextMode: card.longText,
    cardFontDisplayPath: card.fontDisplay, cardFontBodyPath: card.fontBody,
    ...(composition.outputFile ? { outputFile: composition.outputFile } : {}) };
}

export function coverAssetPaths(composition) {
  return [...new Set([composition.background?.customPath, composition.card?.fontDisplay, composition.card?.fontBody,
    ...(composition.layout?.layers || []).flatMap(layer => [layer.imagePath, layer.fontPath])].filter(Boolean))];
}

export function remapCoverAssets(composition, mapping) {
  const result = structuredClone(composition);
  const map = path => mapping.get(path) || path;
  if (result.background?.customPath) result.background.customPath = map(result.background.customPath);
  for (const key of ["fontDisplay", "fontBody"]) if (result.card?.[key]) result.card[key] = map(result.card[key]);
  for (const layer of result.layout?.layers || []) for (const key of ["imagePath", "fontPath"]) if (layer[key]) layer[key] = map(layer[key]);
  delete result.assets;
  return result;
}

export async function portableCoverLayout(composition, files) {
  const assets = {};
  for (const path of coverAssetPaths(composition)) {
    const file = files.get(path);
    if (!file) throw new Error(`请导入布局素材：${path}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let start = 0; start < bytes.length; start += 32768) binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
    assets[path] = { name: file.name, type: file.type, data: btoa(binary) };
  }
  return { ...composition, assets };
}

export function coverFileName(value = "card.jpg") {
  const name = value.trim().split(/[\\/]/).at(-1) || "card.jpg";
  return /\.(png|jpe?g)$/i.test(name) ? name : `${name}.jpg`;
}

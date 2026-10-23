// v2 shares composition settings; output and custom backgrounds belong to a project.
export function coverPreferences(values, layers, files) {
  const { outputFile, backgroundPath, selectedDifficultyId, activeLayerKey, ...shared } = values || {};
  if (shared.backgroundMode === 1) shared.backgroundMode = 0;
  const paths = new Set([shared.cardFontDisplayPath, shared.cardFontBodyPath,
    ...(layers || []).flatMap(layer => [layer.imagePath, layer.fontPath])].filter(Boolean));
  return { coverValues: shared, coverLayers: layers,
    coverFiles: (files || []).filter(asset => paths.has(asset.path)) };
}

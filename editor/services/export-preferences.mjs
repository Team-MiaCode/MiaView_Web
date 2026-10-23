const keys = new Set([
  "resolutionIndex", "fps", "audioBitrateKbps", "presetIndex", "sizePresetIndex", "clockCountEnabled",
  "showObjectStatsHud", "showChartInfoHud", "introEnabled", "introPvPreview", "introBackgroundModeIndex",
  "introCustomBackgroundPath", "introModeIndex", "introBlurBackground", "introCardShadow", "introLevelTextRender",
  "introFontDisplayPath", "introFontBodyPath",
]);

// Range, source clip, output handle and audition state belong to the open session.
export function exportPreferences(values) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => keys.has(key)));
}

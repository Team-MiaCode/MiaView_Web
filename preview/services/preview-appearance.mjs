const names = new Set([
  "tapFlowSpeed", "touchFlowSpeed", "scaleMode", "smoothBrightness", "showTimestamp", "showDebugInfo",
  "forceLabeledJudgeLineWhenPaused", "touchPadAuthoringShortcut", "centerDisplay", "tapJudgeTextDistance",
  "judgeEffectSlide", "judgeEffectTap", "judgeEffectBreak", "judgeEffectTouch", "outlineIndex", "skinJudgeEffectIndex",
  "skinDirectoryName", "customOutlineFileName",
]);

export function previewSettingsFromValues(values) {
  const settings = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "brightnessOuter") settings.outerBrightness = value / 100;
    else if (key === "brightnessInner") settings.innerBrightness = value / 100;
    else if (key === "layoutSquareScale") settings.layoutSquareScale = value / 100;
    else if (key === "slideEarlierOnTop") settings.earlierSlideOnTop = value;
    else if (key === "skinIndex") settings.noteSkin = value === 0 ? "SD" : "DX";
    else if (names.has(key) || key === "hudFontPaths") settings[key] = value;
    else if (!["hudFontAreaIndex","hudFontPath"].includes(key)) throw new Error(`Unknown preview appearance value: ${key}`);
  }
  return settings;
}

export function previewValuesFromSettings(settings) {
  const values = {
    brightnessOuter: settings.outerBrightness * 100, brightnessInner: settings.innerBrightness * 100,
    layoutSquareScale: (settings.layoutSquareScale ?? .95) * 100,
    slideEarlierOnTop: settings.earlierSlideOnTop, skinIndex: settings.noteSkin === "SD" ? 0 : 1,
  };
  for (const name of names) if (name in settings) values[name] = settings[name];
  return values;
}

export const SDK_PROTOCOL = 1;
export const HOST_SOURCE = "MiaCodePreviewHost";
export const FRAME_SOURCE = "MiaCodePreview";
const immediateWorkbenchCommands = new Set(["preview.toggle", "preview.pause", "preview.stop", "timeline.pause"]);
export function isImmediateCommand(type, payload) {
  return type === "pause" || type === "workbenchCommand" && immediateWorkbenchCommands.has(payload?.id);
}
export const commands = new Set([
  "initialize",
  "load",
  "play",
  "pause",
  "seek",
  "setSettings",
  "setPlayback",
  "setPerformance",
  "setMediaSettings",
  "setResources",
  "readAudioInfo",
  "normalizeShortcuts",
  "setInputShortcuts",
  "normalizeBackground",
  "importFont",
  "importSkin",
  "importJudgeLine",
  "getExportCapabilities",
  "startExport",
  "setIntroAudition",
  "setExportPreview",
  "cancelExport",
  "getExportStatus",
  "setCanvasSize",
  "getTimeline",
  "navigateTimeline",
  "getTimelineFollow",
  "getDocument",
  "getAnalysis",
  "documentCommand",
  "editorCommand",
  "audioCommand",
  "setLatency",
  "detectLatency",
  "getDocumentSaveText",
  "setTheme",
  "setCoverComposition",
  "setCoverChart",
  "getCoverComposition",
  "coverCommand",
  "importCoverImage",
  "exportCover",
  "getState",
  "getDiagnostics",
  "setDiagnostics",
  "resetDiagnostics",
  "selectDifficulty",
  "restart",
  "destroy",
]);
export const THEME_TOKENS = Object.freeze(["dark", "light", "legacy", "legacy_light"]);
export function previewTheme(value = "dark") {
  if (!THEME_TOKENS.includes(value)) throw new Error("Unknown MiaCode theme");
  return value;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function httpUrl(value, base) {
  const url = new URL(value, base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Resource URLs must use HTTP(S) without embedded credentials",
    );
  return url.href;
}
export function validIdentity(value) {
  return (
    value?.upstream === "MiaCodeWebGL" &&
    typeof value.version === "string" &&
    value.version.length > 0 &&
    /^[a-f0-9]{64}$/.test(value.sourceRevision ?? "")
  );
}
export function trustedRequest(event, parent, origin, sessionId, allowedCommands = commands) {
  const message = event.data;
  if (
    event.source !== parent ||
    event.origin !== origin ||
    message?.source !== HOST_SOURCE ||
    message.protocolVersion !== SDK_PROTOCOL ||
    !uuid.test(message.sessionId ?? "") ||
    !uuid.test(message.requestId ?? "") ||
    !allowedCommands.has(message.type) ||
    (sessionId && message.sessionId !== sessionId)
  )
    return null;
  return message;
}
export function trustedResponse(event, frame, origin, sessionId) {
  const message = event.data;
  if (
    event.source !== frame ||
    event.origin !== origin ||
    message?.source !== FRAME_SOURCE ||
    message.protocolVersion !== SDK_PROTOCOL ||
    message.sessionId !== sessionId ||
    typeof message.playerVersion !== "string" ||
    !/^[a-f0-9]{64}$/.test(message.sourceRevision ?? "")
  )
    return null;
  if (message.type === "response") {
    if (!uuid.test(message.requestId ?? "") || typeof message.ok !== "boolean")
      return null;
  } else if (
    ![
      "ready",
      "progress",
      "playing",
      "paused",
      "ended",
      "error",
      "seeked",
      "settingsChanged",
      "playbackChanged",
      "timeupdate",
      "coverChanged",
      "coverPlaybackChanged",
      "touchPadAuthoring",
      "documentChanged",
      "shortcutInput",
      "exportProgress",
      "introAuditionChanged",
      "exportCompleted",
      "exportFailed",
      "performance",
    ].includes(message.type) ||
    !message.payload ||
    typeof message.payload !== "object"
  )
    return null;
  return message;
}
export function normalizeSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error("Settings must be an object");
  const result = {};
  for (const [name, value] of Object.entries(settings)) {
    if (name === "hudFontPaths") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HUD font paths must be an object");
      for (const [area, path] of Object.entries(value)) {
        if (!["chart_info", "timestamp", "center_display", "object_stats", "debug_info"].includes(area) || typeof path !== "string")
          throw new Error("Unknown HUD font area or path");
      }
    } else if (name === "fireworkBrightness") {
      if (!Number.isFinite(value) || value < .5 || value > 1.2) throw new Error("fireworkBrightness must be between 0.5 and 1.2");
    } else if (name === "handRadiusPx" || name === "staticTapOnSlideThresholdMs") {
      const [min, max] = name === "handRadiusPx" ? [0, 60] : [150, 250];
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
    } else if (["showSlideTracks", "showJudgeMarkers", "showTouchTrail", "wifiNeedC"].includes(name)) {
      if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
    } else if (name === "outerBrightness" || name === "innerBrightness") {
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error(`${name} must be between 0 and 1`);
    } else if (name === "tapFlowSpeed" || name === "touchFlowSpeed") {
      if (!Number.isFinite(value) || value < 1 || value > 10)
        throw new Error(`${name} must be between 1 and 10`);
    } else if (["earlierSlideOnTop", "smoothBrightness", "showTimestamp", "showDebugInfo", "showChartInfoHud", "showObjectStatsHud", "touchPadAuthoringShortcut", "touchPadAuthoringContext", "forceLabeledJudgeLineWhenPaused", "pauseDisplayAltHoldActive", "judgeEffectSlide", "judgeEffectTap", "judgeEffectBreak", "judgeEffectTouch"].includes(name)) {
      if (typeof value !== "boolean")
        throw new Error(`${name} must be a boolean`);
    } else if (name === "layoutSquareScale") {
      if (!Number.isFinite(value) || value < .5 || value > 1) throw new Error(`${name} must be between 0.5 and 1`);
    } else if (["scaleMode", "outlineIndex", "centerDisplay", "tapJudgeTextDistance", "skinJudgeEffectIndex"].includes(name)) {
      const maximum = { scaleMode: 3, outlineIndex: 3, centerDisplay: 7, tapJudgeTextDistance: 2, skinJudgeEffectIndex: 1 }[name];
      if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${name} must be an integer from 0 to ${maximum}`);
    } else if (name === "skinDirectoryName") {
      if (typeof value !== "string" || !/^(skinSD|skinDX|skin-[a-f0-9]{64})$/.test(value)) throw new Error("Invalid skin directory name");
    } else if (name === "customOutlineFileName") {
      if (typeof value !== "string" || value !== "" && !/^outline-[a-f0-9]{64}\.png$/.test(value)) throw new Error("Invalid custom outline filename");
    } else if (name === "noteSkin") {
      if (value !== "SD" && value !== "DX")
        throw new Error("noteSkin must be SD or DX");
    } else if (name === "previewMode") {
      if (!["native", "maimuri_dx_style", "erase_by_area"].includes(value))
        throw new Error(
          "previewMode must be native, maimuri_dx_style or erase_by_area",
        );
    } else throw new Error(`Unsupported setting: ${name}`);
    result[name] = value;
  }
  return result;
}
export function difficultyId(value) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 7)
    throw new Error("Difficulty must be an integer from 1 to 7");
  return value;
}
export function normalizedSource(value, base, maidata = false) {
  if (maidata && typeof value === "string") return { text: value };
  if (value instanceof Blob) return value;
  if (typeof value === "string") return { url: httpUrl(value, base) };
  if (!value || typeof value !== "object" || typeof value.url !== "string")
    throw new Error("Resource must be a Blob or an HTTP(S) URL");
  const result = { url: httpUrl(value.url, base) };
  if (value.byteSize !== undefined || value.sha256 !== undefined) {
    if (
      !Number.isSafeInteger(value.byteSize) ||
      value.byteSize <= 0 ||
      !/^[a-f0-9]{64}$/.test(value.sha256 ?? "")
    )
      throw new Error("Verified resources require both byteSize and sha256");
    result.byteSize = value.byteSize;
    result.sha256 = value.sha256;
  }
  if (value.contentType !== undefined) {
    if (typeof value.contentType !== "string")
      throw new Error("contentType must be a string");
    result.contentType = value.contentType;
  }
  return result;
}
export function normalizeChart(chart, base) {
  if (!chart || typeof chart !== "object" || chart.maidata === undefined)
    throw new Error("maidata is required");
  const result = {
    maidata: normalizedSource(chart.maidata, base, true),
    difficulty: difficultyId(chart.difficulty),
  };
  if (chart.filePath !== undefined) {
    if (typeof chart.filePath !== "string") throw new Error("Chart filePath must be a string");
    result.filePath = chart.filePath;
  }
  for (const name of ["audio", "cover", "video"])
    if (chart[name] != null) result[name] = normalizedSource(chart[name], base);
  return result;
}

export function normalizeResources(resources, base) {
  if (!resources || typeof resources !== "object" || Array.isArray(resources) || !Object.keys(resources).length)
    throw new Error("Specify audio, cover or video resources");
  const result = {};
  for (const [kind, resource] of Object.entries(resources)) {
    if (!["audio", "cover", "video"].includes(kind)) throw new Error(`Unknown chart resource: ${kind}`);
    result[kind] = resource === null ? null : normalizedSource(resource, base);
  }
  return result;
}

export function normalizeSkinFiles(files, base) {
  if (!Array.isArray(files) || !files.length) throw new Error("请选择皮肤 PNG 素材");
  const paths = new Set();
  const result = files.map(file => {
    const path = file?.path;
    if (typeof path !== "string" || /[\x00-\x1f\\]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")
        || !path.endsWith(".png") || paths.has(path.toLowerCase())) throw new Error("皮肤素材路径无效");
    paths.add(path.toLowerCase());
    return { path, image: normalizedSource(file.image, base) };
  });
  if (!paths.has("tap.png")) throw new Error("皮肤目录需要 tap.png");
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

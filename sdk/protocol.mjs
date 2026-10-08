export const SDK_PROTOCOL = 1;
export const HOST_SOURCE = "MiaCodePreviewHost";
export const FRAME_SOURCE = "MiaCodePreview";
export const commands = new Set([
  "initialize",
  "load",
  "play",
  "pause",
  "seek",
  "setSettings",
  "getState",
  "selectDifficulty",
  "restart",
  "destroy",
]);
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
export function trustedRequest(event, parent, origin, sessionId) {
  const message = event.data;
  if (
    event.source !== parent ||
    event.origin !== origin ||
    message?.source !== HOST_SOURCE ||
    message.protocolVersion !== SDK_PROTOCOL ||
    !uuid.test(message.sessionId ?? "") ||
    !uuid.test(message.requestId ?? "") ||
    !commands.has(message.type) ||
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
    if (name === "outerBrightness" || name === "innerBrightness") {
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error(`${name} must be between 0 and 1`);
    } else if (name === "tapFlowSpeed" || name === "touchFlowSpeed") {
      if (!Number.isFinite(value) || value < 1 || value > 10)
        throw new Error(`${name} must be between 1 and 10`);
    } else if (name === "earlierSlideOnTop") {
      if (typeof value !== "boolean")
        throw new Error(`${name} must be a boolean`);
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
  for (const name of ["audio", "cover", "video"])
    if (chart[name] != null) result[name] = normalizedSource(chart[name], base);
  return result;
}

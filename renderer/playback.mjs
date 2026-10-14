export const PLAYBACK_RATES = Object.freeze([.25, .5, .75, 1, 1.25, 1.5, 2]);
export const DEFAULT_PLAYBACK = Object.freeze({ rate: 1, rangePlaybackEnabled: false, exportStartSeconds: 0, exportEndSeconds: 0 });

export function playbackSettings(current, changes, duration) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("Playback settings must be an object");
  for (const [key, value] of Object.entries(changes)) {
    if (key === "rate") {
      if (!Number.isFinite(value) || value < .25 || value > 2) throw new Error("Playback rate must be between 0.25 and 2");
    } else if (key === "rangePlaybackEnabled") {
      if (typeof value !== "boolean") throw new Error("rangePlaybackEnabled must be a boolean");
    } else if (key === "exportStartSeconds" || key === "exportEndSeconds") {
      if (!Number.isFinite(value) || value < 0) throw new Error("Playback range must use finite non-negative seconds");
    } else throw new Error(`Unknown playback setting: ${key}`);
  }
  const result = { ...current, ...changes };
  if (result.exportEndSeconds < result.exportStartSeconds || result.exportEndSeconds > duration)
    throw new Error("Playback range must lie inside the loaded chart");
  if (result.rangePlaybackEnabled && result.exportEndSeconds <= result.exportStartSeconds)
    throw new Error("Playback range requires a positive duration");
  return result;
}

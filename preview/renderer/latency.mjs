export const DEFAULT_LATENCY = Object.freeze({ onPage: false, bpm: 120, offsetSeconds: 0, subdivision: 4, sfxVolumePercent: 60 });
export function latencySettings(current, changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("Latency settings must be an object");
  for (const [key, value] of Object.entries(changes)) {
    if (key === "onPage") { if (typeof value !== "boolean") throw new Error("onPage must be a boolean"); }
    else if (key === "bpm") { if (!Number.isFinite(value) || value <= 0) throw new Error("BPM must be positive"); }
    else if (key === "offsetSeconds") { if (!Number.isFinite(value)) throw new Error("Offset must be finite"); }
    else if (key === "subdivision") { if (![4, 8, 16].includes(value)) throw new Error("Subdivision must be 4, 8 or 16"); }
    else if (key === "sfxVolumePercent") { if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error("Audition volume must be an integer from 0 to 100"); }
    else throw new Error(`Unknown latency setting: ${key}`);
  }
  return { ...current, ...changes };
}

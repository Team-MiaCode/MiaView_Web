import test from "node:test";
import assert from "node:assert/strict";
import { ViewState } from "../services/view-state.mjs";

test("Theme mode selects the original light and dark palette fields and follows system changes", () => {
  const media = new EventTarget(); media.matches = false;
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const state = new ViewState(storage, media);
  state.setPreference("lightThemeToken", "legacy_light");
  state.setPreference("darkThemeToken", "legacy");
  assert.equal(state.activeThemeToken, "legacy");
  state.setPreference("themeModeToken", "light");
  assert.equal(state.activeThemeToken, "legacy_light");
  state.setPreference("themeModeToken", "system");
  assert.equal(state.activeThemeToken, "legacy_light");
  let changes = 0;
  state.addEventListener("change", () => changes++);
  media.matches = true; media.dispatchEvent(new Event("change"));
  assert.equal(state.activeThemeToken, "legacy");
  assert.equal(changes, 1);
  const restored = new ViewState(storage, media);
  assert.equal(restored.activeThemeToken, "legacy");
  state.destroy(); restored.destroy();
  media.dispatchEvent(new Event("change"));
  assert.equal(changes, 1);
});

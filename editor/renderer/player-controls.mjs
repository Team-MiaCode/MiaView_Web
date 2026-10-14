import { THEME_TOKENS, previewTheme } from "./protocol.mjs";

// Shared player controls.
export function attachPlayerControls(controller, engine) {
  const $ = (id) => document.getElementById(id);
  const themeButton = $("theme-toggle");
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const labels = { dark: "浅色", light: "经典深色", legacy: "经典浅色", legacy_light: "深色" };
    themeButton.textContent = labels[theme];
    themeButton.setAttribute("aria-label", `切换到${labels[theme]}主题`);
  }
  setTheme(previewTheme(new URLSearchParams(location.search).get("theme") || "dark"));
  themeButton.addEventListener("click", () => setTheme(THEME_TOKENS[(THEME_TOKENS.indexOf(document.documentElement.dataset.theme) + 1) % THEME_TOKENS.length]));
  $("fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      $("transport-error").hidden = true;
    } catch {
      $("transport-error").textContent = "当前页面未允许全屏";
      $("transport-error").hidden = false;
    }
  });
  document.addEventListener("fullscreenchange", () => {
    $("fullscreen").textContent = document.fullscreenElement ? "退出全屏" : "全屏";
    $("fullscreen").setAttribute("aria-label", document.fullscreenElement ? "退出全屏" : "进入全屏");
  });
  function updateTransport(currentTime, duration) {
    const format = second => `${Math.floor(second / 60)}:${String(Math.floor(second % 60)).padStart(2, "0")}`;
    const text = `${format(currentTime)} / ${format(duration)}`;
    if ($("time").textContent !== text) $("time").textContent = text;
  }
  function updateChart(chart) {
    $("chart-title").textContent = chart ? chart.title || "未命名谱面" : "未加载谱面";
    $("chart-title").title = chart ? [chart.title, chart.artist].filter(Boolean).join(" · ") : "";
  }
  function updateSettingsControls(settings) {
    $("preview-mode").value = settings.previewMode;
    $("outer-brightness").value = String(
      Math.round(settings.outerBrightness * 100),
    );
    $("inner-brightness").value = String(
      Math.round(settings.innerBrightness * 100),
    );
    $("outer-value").textContent = `${$("outer-brightness").value}%`;
    $("inner-value").textContent = `${$("inner-brightness").value}%`;
    $("tap-speed").value = String(settings.tapFlowSpeed);
    $("touch-speed").value = String(settings.touchFlowSpeed);
    $("tap-speed-value").textContent = $("tap-speed").value;
    $("touch-speed-value").textContent = $("touch-speed").value;
    $("slide-order").value = settings.earlierSlideOnTop ? "earlier" : "later";
    $("note-skin").value = settings.noteSkin;
  }
  function applySettings() {
    void controller.execute("setSettings", {
      outerBrightness: Number($("outer-brightness").value) / 100,
      innerBrightness: Number($("inner-brightness").value) / 100,
      earlierSlideOnTop: $("slide-order").value === "earlier",
      noteSkin: $("note-skin").value,
      tapFlowSpeed: Number($("tap-speed").value),
      touchFlowSpeed: Number($("touch-speed").value),
      previewMode: $("preview-mode").value,
    }).then(() => { $("settings-error").hidden = true; }).catch((error) => {
      updateSettingsControls(engine.state().settings);
      $("settings-error").textContent = error.message;
      $("settings-error").hidden = false;
    });
  }
  function toggleSettings(open) {
    $("settings-panel").hidden = !open;
    document.body.classList.toggle("settings-open", open);
    $("settings-toggle").setAttribute("aria-expanded", String(open));
    (open ? $("settings-close") : $("settings-toggle")).focus();
    if (open && matchMedia("(max-width: 640px)").matches)
      window.scrollTo({ top: $("settings-panel").offsetTop, behavior: "smooth" });
    if (!open) window.scrollTo({ top: 0 });
  }
  $("settings-toggle").addEventListener("click", () =>
    toggleSettings($("settings-panel").hidden),
  );
  $("settings-close").addEventListener("click", () => toggleSettings(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("settings-panel").hidden) {
      event.preventDefault();
      toggleSettings(false);
    }
  });
  for (const id of [
    "preview-mode",
    "outer-brightness",
    "inner-brightness",
    "tap-speed",
    "touch-speed",
    "slide-order",
    "note-skin",
  ])
    $(id).addEventListener("input", applySettings);
  $("settings-reset").addEventListener("click", () => {
    updateSettingsControls(engine.defaultSettings());
    applySettings();
  });

  const run = (type, payload) => {
    void controller.execute(type, payload).catch(engine.fail);
  };
  $("play").addEventListener("click", () => run(engine.state().playing ? "pause" : "play"));
  $("restart").addEventListener("click", () => run("restart"));
  $("seek").addEventListener("input", () => run("seek", { second: Number($("seek").value) }));
  return { settings: updateSettingsControls, chart: updateChart, transport: updateTransport, theme: setTheme };
}

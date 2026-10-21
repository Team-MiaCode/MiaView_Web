import { createDevPreviewHost } from "./preview-host.mjs";
import { uploadChartFolder } from "./resources.mjs";
import { createBackendLogPanel } from "./log-panel.mjs";

export function startDevApp({
  document = globalThis.document,
  window = globalThis.window,
  createHost = createDevPreviewHost,
  upload = uploadChartFolder,
  createLogPanel = createBackendLogPanel,
} = {}) {
  const $ = (id) => document.getElementById(id);
  const status = (text) => { $("status").textContent = text; };
  const controls = [...document.querySelectorAll("#controls input, #controls select")];
  const difficulty = $("difficulty");
  let lastChart, loadedInfo;
  const host = createHost({ status, onMount: (instance) => logPanel.attach(instance) });
  const logPanel = createLogPanel(() => host.preview);

  function showDifficulties(info) {
    loadedInfo = info;
    difficulty.replaceChildren(...(info?.charts ?? [{ id: "", label: "请先上传谱面" }]).map((chart) => {
      const option = document.createElement("option");
      option.value = String(chart.id);
      option.textContent = chart.label;
      return option;
    }));
    difficulty.value = String(info?.difficultyId ?? "");
    if (info) lastChart = { ...lastChart, difficulty: info.difficultyId };
  }

  async function run(action) {
    for (const control of controls) control.disabled = true;
    try {
      await action();
    } catch (error) {
      status(error.message);
    } finally {
      for (const control of controls) control.disabled = control === difficulty && !loadedInfo;
      // A failed switch must not leave the selector claiming a new difficulty.
      difficulty.value = String(loadedInfo?.difficultyId ?? "");
    }
  }

  async function loadChart(chart) {
    showDifficulties(null);
    const info = await host.load(chart);
    if (info) showDifficulties(info);
  }

  $("files").addEventListener("change", (event) => {
    const files = [...event.target.files];
    if (!files.length) return;
    return run(async () => {
      try {
        void host.preview?.pause().catch(() => {});
        const chart = await upload(files, status);
        if (!chart) return;
        lastChart = chart;
        if (!host.active) await host.mount();
        await loadChart(chart);
      } finally {
        // Selecting the same folder again is another ordinary website upload.
        event.target.value = "";
      }
    });
  });

  difficulty.addEventListener("change", () => run(async () => {
    const info = await host.selectDifficulty(Number(difficulty.value));
    if (info) showDifficulties(info);
  }));

  for (const control of controls.filter((control) => !["files", "difficulty"].includes(control.id))) {
    control.addEventListener("change", () => run(async () => {
      showDifficulties(null);
      await host.mount();
      if (lastChart) await loadChart(lastChart);
    }));
  }
  window.addEventListener("pagehide", () => host.destroy(), { once: true });
  return { ready: run(() => host.mount()) };
}

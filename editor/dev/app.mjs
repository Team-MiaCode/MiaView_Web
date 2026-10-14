import { createDevPreviewHost } from "./preview-host.mjs";
import { uploadChartFolder } from "./resources.mjs";
import { createBackendLogPanel } from "./log-panel.mjs";

const $ = (id) => document.getElementById(id);
const status = (text) => { $("status").textContent = text; };
const controls = [...document.querySelectorAll("#controls input, #controls select")];
let lastChart;
const host = createDevPreviewHost({ status, onMount: (instance) => logPanel.attach(instance) });
const logPanel = createBackendLogPanel(() => host.preview);

async function run(action) {
  for (const control of controls) control.disabled = true;
  try {
    await action();
  } catch (error) {
    status(error.message);
  } finally {
    for (const control of controls) control.disabled = false;
  }
}

$("files").addEventListener("change", (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  void run(async () => {
    try {
      void host.preview?.pause().catch(() => {});
      const chart = await uploadChartFolder(files, status);
      if (!chart) return;
      lastChart = chart;
      if (!host.active) await host.mount();
      await host.load(chart);
    } finally {
      // Selecting the same folder again is another ordinary website upload.
      event.target.value = "";
    }
  });
});

for (const control of controls.filter((control) => control.id !== "files")) {
  control.addEventListener("change", () => {
    void run(async () => {
      await host.mount();
      if (lastChart) await host.load(lastChart);
    });
  });
}
window.addEventListener("pagehide", () => host.destroy(), { once: true });
void run(() => host.mount());

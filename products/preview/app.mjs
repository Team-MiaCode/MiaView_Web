import { createPreview } from "./sdk/index.mjs";
import { inspectChartFolder } from "./services/chart-folder.mjs";
import { resolveChartMedia } from "./services/chart-resources.mjs";

const element = id => document.getElementById(id);
const status = text => { element("status").textContent = text; };
const preview = createPreview(element("preview"), { layout: "fit", diagnostics: false });
let projects = [], loading = Promise.resolve();
preview.on("progress", event => status(event.stage));
preview.on("error", event => status(event.message));
async function load(project) {
  element("difficulty").disabled = true;
  const info = await preview.load({ ...project.chart, video: undefined, filePath: project.path });
  const snapshot = await preview.getDocument();
  const resolved = resolveChartMedia(project.files, project.path, snapshot.metadataVideoPath);
  const input = { ...project.chart, ...resolved };
  await preview.setResources({ video: input.video || null, ...("cover" in resolved ? { cover: resolved.cover } : {}) });
  element("difficulty").replaceChildren(...info.charts.map(chart => new Option(chart.label, String(chart.id))));
  element("difficulty").value = String(info.difficultyId);
  element("difficulty").disabled = false;
  status(info.title || project.label);
}
function selectProject(project) {
  loading = loading.catch(() => {}).then(() => load(project));
  void loading.catch(error => status(error.message));
}
element("files").addEventListener("change", event => {
  try {
    if (!event.target.files.length) return;
    const selection = inspectChartFolder(event.target.files);
    projects = selection.projects;
    element("project").replaceChildren(...projects.map((project, index) => new Option(project.label, String(index))));
    element("project").hidden = projects.length === 1;
    const selected = selection.preferred || projects[0];
    element("project").value = String(projects.indexOf(selected));
    selectProject(selected);
  } catch (error) { status(error.message); }
  finally { event.target.value = ""; }
});
element("project").addEventListener("change", event => selectProject(projects[Number(event.target.value)]));
element("difficulty").addEventListener("change", event => {
  void preview.selectDifficulty(Number(event.target.value)).catch(error => status(error.message));
});
window.addEventListener("pagehide", () => preview.destroy(), { once: true });
void preview.ready.then(() => {
  element("files").disabled = false;
  status("选择包含 maidata.txt、音乐和素材的文件夹");
}, error => status(error.message));

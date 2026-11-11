import { createPreview } from "./sdk/index.mjs";
import { inspectChartFolder } from "./services/chart-folder.mjs";
import { resolveChartMedia } from "./services/chart-resources.mjs";
import { DEMO_CHART } from "./services/demo-chart.mjs";
import { PopupHost } from "./ui/components/popup-host.mjs";

const element = id => document.getElementById(id);
const status = text => { element("status").textContent = text; };
const report = error => status(error.message);
const lifetime = new AbortController();
const { signal } = lifetime;
const preview = createPreview(element("preview"), { layout: "fit", diagnostics: false,
  resolution: { width: 1080, height: 1080 }, preferencesKey: "miacode.web.preview.preferences" });
const popups = new PopupHost(element("preview"), (id, args) => {
  chooseMedia = args.kind;
  assetInput.accept = args.accept;
  assetInput.value = "";
  assetInput.click();
});
const assetInput = element("asset");
let chooseMedia;
assetInput.addEventListener("change", () => {
  const [file] = assetInput.files;
  assetInput.value = "";
  if (file) void queueDocument(() => preview.setResources({ [chooseMedia]: file })).catch(report);
}, { signal });
preview.on("progress", event => status(event.stage));
preview.on("error", event => status(event.message));

const difficulty = element("difficulty");
const projectSelect = element("project");
const media = element("media");
let projects = [], pending = Promise.resolve(), loaded = false;
function enableDocumentControls(enabled) {
  difficulty.disabled = media.disabled = !enabled;
}
function queueDocument(action) {
  enableDocumentControls(false);
  const operation = pending.then(action);
  const settled = pending = operation.catch(() => {});
  return operation.finally(() => {
    if (!signal.aborted && pending === settled) enableDocumentControls(loaded);
  });
}
function selectProject(project) {
  void queueDocument(async () => {
    loaded = false;
    const info = await preview.load({ ...project.chart, video: undefined, filePath: project.path });
    if (project.files) {
      const snapshot = await preview.getDocument();
      const resolved = resolveChartMedia(project.files, project.path, snapshot.metadataVideoPath);
      const resources = { ...project.chart, ...resolved };
      await preview.setResources({ video: resources.video ?? null,
        ...("cover" in resolved ? { cover: resolved.cover } : {}) });
    }
    loaded = true;
    difficulty.replaceChildren(...info.charts.map(chart => new Option(chart.label, String(chart.id))));
    difficulty.value = String(info.difficultyId);
    status(info.title || project.label);
  }).catch(report);
}
element("files").addEventListener("change", event => {
  try {
    if (!event.target.files.length) return;
    const selection = inspectChartFolder(event.target.files);
    projects = selection.projects;
    projectSelect.replaceChildren(...projects.map((project, index) => new Option(project.label, String(index))));
    projectSelect.hidden = projects.length === 1;
    const selected = selection.preferred || projects[0];
    projectSelect.value = String(projects.indexOf(selected));
    selectProject(selected);
  } catch (error) { report(error); }
  finally { event.target.value = ""; }
}, { signal });
element("maidata").addEventListener("change", event => {
  const [maidata] = event.target.files;
  if (!maidata) return;
  projectSelect.hidden = true;
  projectSelect.replaceChildren();
  projects = [];
  selectProject({ label: maidata.name, chart: { maidata } });
  event.target.value = "";
}, { signal });
projectSelect.addEventListener("change", () => selectProject(projects[Number(projectSelect.value)]), { signal });
difficulty.addEventListener("change", () => {
  const id = Number(difficulty.value);
  void queueDocument(async () => {
    await preview.selectDifficulty(id);
    const value = await preview.getState();
    difficulty.value = String(value.difficultyId);
  }).catch(report);
}, { signal });
media.addEventListener("click", () => popups.showMenu(media, [
  ["选择音乐", "media.select", null, { kind: "audio", accept: "audio/*,.flac,.ogg,.m4a" }],
  ["选择背景图", "media.select", null, { kind: "cover", accept: "image/*" }],
  ["选择 PV", "media.select", null, { kind: "video", accept: "video/*,.mp4,.webm" }],
]), { signal });

window.addEventListener("pagehide", event => {
  if (event.persisted) return;
  lifetime.abort();
  popups.destroy();
  preview.destroy();
}, { signal });

void preview.ready.then(() => {
  element("files").disabled = element("maidata").disabled = false;
  if (new URLSearchParams(location.search).get("demo") === "1") {
    selectProject({ label: "示例谱面", chart: { maidata: DEMO_CHART } });
  } else if (element("status").textContent === "预览初始化中…") {
    status("选择谱面文件或文件夹");
  }
}).catch(report);

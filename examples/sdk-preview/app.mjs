import { createPreview } from "../../sdk/index.mjs";
import { inspectChartFolder } from "../../services/chart-folder.mjs";
import { resolveChartMedia } from "../../services/chart-resources.mjs";

const element = id => document.getElementById(id);
const status = text => { element("status").textContent = text; };
const sources = element("sources");
const project = element("project");
const difficulty = element("difficulty");
const media = element("media");
const lifetime = new AbortController();
const { signal } = lifetime;
const preview = createPreview(element("preview"), {
  layout: "fit",
  panelLayout: "fill",
  diagnostics: false,
  resolution: { width: 1080, height: 1080 },
});
let projects = [];
let loaded = false;

function enableChartControls() {
  difficulty.disabled = media.disabled = !loaded;
}

async function run(action) {
  sources.disabled = true;
  try {
    await action();
  } catch (error) {
    if (!signal.aborted) status(error.message);
  } finally {
    if (!signal.aborted) {
      sources.disabled = false;
      enableChartControls();
    }
  }
}

async function load({ chart, path, files }) {
  loaded = false;
  const info = await preview.load({ ...chart, video: undefined, filePath: path });
  loaded = true;
  difficulty.replaceChildren(...info.charts.map(({ id, label }) => new Option(label, String(id))));
  difficulty.value = String(info.difficultyId);
  if (files) {
    const { metadataVideoPath } = await preview.getDocument();
    const resources = resolveChartMedia(files, path, metadataVideoPath);
    await preview.setResources({
      video: ("video" in resources ? resources.video : chart.video) ?? null,
      ...("cover" in resources ? { cover: resources.cover } : {}),
    });
  }
  status(info.title || chart.maidata.name);
}

element("folder").addEventListener("change", event => {
  const files = Array.from(event.target.files);
  event.target.value = "";
  if (!files.length) return;
  void run(async () => {
    const selection = inspectChartFolder(files);
    projects = selection.projects;
    project.replaceChildren(...projects.map(({ label }, index) => new Option(label, String(index))));
    element("project-row").hidden = projects.length === 1;
    const selected = selection.preferred ?? projects[0];
    project.value = String(projects.indexOf(selected));
    await load(selected);
  });
}, { signal });

element("maidata").addEventListener("change", event => {
  const [maidata] = event.target.files;
  event.target.value = "";
  if (!maidata) return;
  projects = [];
  element("project-row").hidden = true;
  void run(() => load({ chart: { maidata } }));
}, { signal });

project.addEventListener("change", () => {
  void run(() => load(projects[Number(project.value)]));
}, { signal });

difficulty.addEventListener("change", () => {
  void run(async () => {
    try {
      await preview.selectDifficulty(Number(difficulty.value));
    } finally {
      difficulty.value = String((await preview.getState()).difficultyId);
    }
  });
}, { signal });

for (const kind of ["audio", "cover", "video"]) {
  element(kind).addEventListener("change", event => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    void run(async () => {
      await preview.setResources({ [kind]: file });
      status(file.name);
    });
  }, { signal });
}

preview.on("progress", ({ stage }) => status(stage));
void preview.ready.then(() => {
  sources.disabled = false;
  status("请选择谱面文件或文件夹");
}).catch(error => {
  if (!signal.aborted) status(error.message);
});
window.addEventListener("pagehide", event => {
  if (event.persisted) return;
  lifetime.abort();
  preview.destroy();
}, { signal });

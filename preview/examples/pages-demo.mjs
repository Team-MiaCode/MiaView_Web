import { createPreview } from "../sdk/index.mjs";
import { inspectChartFolder } from "../services/chart-folder.mjs";
const $ = (id) => document.getElementById(id);
let preview, lastChart;
const status = (text) => {
  $("status").textContent = text;
};
function enable(loaded) {
  for (const id of ["play", "pause", "restart", "difficulty", "local-pv", "local-audio"])
    $(id).disabled = !loaded;
  $("remove-pv").disabled = !loaded || !lastChart?.video;
}
function updateMediaStatus(chart) {
  $("media-status").textContent = `音乐：${chart.audio?.name || "未选择"} · PV：${chart.video?.name || "未选择"}。文件只在浏览器中读取；PV 音轨不单独播放。`;
}
function mount() {
  preview?.destroy();
  enable(false);
  const [width, height] = $("resolution").value.split("x").map(Number);
  $("preview").style.maxWidth = width === height ? "720px" : "960px";
  preview = createPreview($("preview"), {
    diagnostics: false,
    resolution: { width, height },
    maxFps: $("max-fps").value === "unlimited"
      ? "unlimited"
      : Number($("max-fps").value),
  });
  preview.on("error", (event) => status(event.message));
  preview.on("progress", (event) => status(event.stage));
  return preview.ready;
}
async function load(chart) {
  enable(false);
  status("正在加载谱面…");
  const info = await preview.load(chart);
  $("difficulty").replaceChildren(
    ...info.charts.map((chart) => {
      const option = document.createElement("option");
      option.value = chart.id;
      option.textContent = chart.label;
      return option;
    }),
  );
  $("difficulty").value = info.difficultyId;
  enable(true);
  updateMediaStatus(chart);
  status(`已加载：${info.title || "未命名谱面"}，点击播放开始预览`);
}
async function selectFiles(event) {
  try {
    const files = [...event.target.files];
    if (!files.length) {
      status("没有读取到文件，请选择包含 maidata.txt 的谱面文件夹");
      return;
    }
    status(`已选择 ${files.length} 个文件，正在检查谱面…`);
    const { preferred } = inspectChartFolder(files);
    if (!preferred) throw new Error("请选择单个谱面文件夹");
    if (!preview || !$("preview").childElementCount) {
      status("已找到 maidata.txt，正在初始化播放器…");
      await mount();
    }
    lastChart = preferred.chart;
    await load(lastChart);
  } catch (error) {
    status(error.message);
  } finally {
    // Allow retrying the same files after a failed load.
    event.target.value = "";
  }
}
$("files").addEventListener("change", selectFiles);
async function replaceMedia(kind, file) {
  if (!lastChart) return;
  const target = preview, owner = lastChart.maidata;
  for (const id of ["local-pv", "local-audio", "remove-pv"]) $(id).disabled = true;
  try {
    const state = await target.setResources({ [kind]: file ?? null });
    if (target !== preview || owner !== lastChart.maidata) return;
    lastChart = { ...lastChart, [kind]: file, difficulty: Number($("difficulty").value) };
    updateMediaStatus(lastChart); enable(state.loaded);
    status("素材更新完成");
  } catch (error) {
    if (target !== preview || owner !== lastChart.maidata) return;
    enable((await target.getState()).loaded);
    status(error.message);
  }
}
for (const [id, kind] of [["local-pv", "video"], ["local-audio", "audio"]]) {
  $(id).addEventListener("change", event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) void replaceMedia(kind, file);
  });
}
$("remove-pv").addEventListener("click", () => void replaceMedia("video", undefined));
async function changePreviewOptions() {
  $("resolution").disabled = true;
  $("max-fps").disabled = true;
  try {
    await mount();
    if (lastChart) await load(lastChart);
  } catch (error) {
    status(error.message);
  } finally {
    $("resolution").disabled = false;
    $("max-fps").disabled = false;
  }
}
for (const id of ["resolution", "max-fps"])
  $(id).addEventListener("change", changePreviewOptions);
for (const name of ["play", "pause", "restart"])
  $(name).addEventListener("click", () => {
    void preview[name]().catch((error) => status(error.message));
  });
$("difficulty").addEventListener("change", () => {
  void preview
    .selectDifficulty(Number($("difficulty").value))
    .then(() => status(""))
    .catch((error) => status(error.message));
});
$("destroy").addEventListener("click", () => {
  preview?.destroy();
  lastChart = null;
  enable(false);
  $("media-status").textContent = "预览已关闭；可重新选择本地谱面。";
  status("预览已关闭");
});
window.addEventListener("pagehide", () => preview?.destroy());
void mount().catch((error) => status(error.message));

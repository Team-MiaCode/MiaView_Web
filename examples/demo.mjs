import { createPreview } from "../sdk/index.mjs";
const $ = (id) => document.getElementById(id);
let preview, lastChart;
const status = (text) => {
  $("status").textContent = text;
};
function enable(loaded) {
  for (const id of ["play", "pause", "restart", "difficulty"])
    $(id).disabled = !loaded;
}
function mount() {
  preview?.destroy();
  enable(false);
  const [width, height] = $("resolution").value.split("x").map(Number);
  $("preview").style.maxWidth = width === height ? "720px" : "960px";
  preview = createPreview($("preview"), { resolution: { width, height } });
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
  status("");
}
$("files").addEventListener("change", async () => {
  try {
    const files = [...$("files").files];
    const find = (pattern) => files.find((file) => pattern.test(file.name));
    const maidata = find(/^maidata\.txt$/i);
    if (!maidata) throw new Error("请选择包含 maidata.txt 的文件夹");
    if (!preview || !$("preview").childElementCount) await mount();
    lastChart = {
      maidata,
      audio: find(/\.(mp3|wav|ogg|flac|m4a)$/i),
      cover: find(/\.(png|jpe?g|webp)$/i),
      video: find(/\.(mp4|webm)$/i),
    };
    await load(lastChart);
  } catch (error) {
    status(error.message);
  }
});
$("resolution").addEventListener("change", async () => {
  try {
    await mount();
    if (lastChart) await load(lastChart);
  } catch (error) {
    status(error.message);
  }
});
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
  enable(false);
  status("预览已关闭");
});
window.addEventListener("pagehide", () => preview?.destroy());
void mount().catch((error) => status(error.message));

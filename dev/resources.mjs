import { inspectChartFolder } from "../services/chart-folder.mjs";

// Dev prepares HTTP resources; the component receives the same URLs as a website.
export async function uploadChartFolder(selectedFiles, status) {
  const files = [...selectedFiles];
  if (!files.length) {
    status("没有读取到文件，请选择包含 maidata.txt 的谱面文件夹");
    return null;
  }
  status(`已选择 ${files.length} 个文件，正在检查谱面…`);
  const { preferred } = inspectChartFolder(files);
  if (!preferred) throw new Error("请选择单个谱面文件夹");
  const selected = preferred.chart;
  status("正在上传到 Dev 后台，生成 HTTP URL…（上传完成后开始下载测试）");
  const resources = Object.entries(selected).filter(([, file]) => file);
  const created = await fetch("/__dev-charts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      Object.fromEntries(
        resources.map(([kind, file]) => [
          kind,
          { name: file.name, size: file.size },
        ]),
      ),
    ),
  });
  if (!created.ok)
    throw new Error("上传接口不可用，请重启 npm run dev 后重试");
  const { chart } = await created.json();
  let completed = 0;
  await Promise.all(
    resources.map(async ([kind, file]) => {
      const response = await fetch(chart[kind].url, {
        method: "PUT",
        body: file,
      });
      if (!response.ok)
        throw new Error(`${file.name} 上传失败（HTTP ${response.status}）`);
      status(
        `已上传 ${++completed}/${resources.length} 个资源，上传完成后开始 HTTP 下载测试…`,
      );
    }),
  );
  return chart;
}

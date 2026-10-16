// Resource names follow MiaCode's ChartAssetPaths; each chart uses its own directory.
import { resourceNames as names } from "./chart-resources.mjs";

export function inspectChartFolder(selectedFiles) {
  const files = [...selectedFiles];
  const paths = new Map(files.map(file => [(file.webkitRelativePath || file.name).replaceAll("\\", "/"), file]));
  const directories = new Map();
  for (const [path, file] of paths) {
    const directory = path.slice(0, path.lastIndexOf("/") + 1);
    if (!directories.has(directory)) directories.set(directory, new Map());
    directories.get(directory).set(path.slice(directory.length).toLowerCase(), file);
  }
  const projects = [];
  for (const [path, maidata] of paths) {
    if (maidata.name.toLowerCase() !== "maidata.txt") continue;
    const directory = path.slice(0, path.lastIndexOf("/") + 1);
    const directoryFiles = directories.get(directory);
    const chart = { maidata };
    for (const [kind, candidates] of Object.entries(names)) {
      const file = candidates.map(name => directoryFiles.get(name)).find(Boolean);
      if (file) chart[kind] = file;
    }
    projects.push({ path, directory, label: directory.replace(/\/$/, "") || maidata.name, chart, files: paths });
  }
  if (!projects.length) throw new Error("请选择包含 maidata.txt 的谱面文件夹");
  const rootDirectory = files[0]?.webkitRelativePath?.split("/")[0];
  const rootProject = projects.find(project => project.directory === `${rootDirectory}/` || project.directory === "");
  return { projects, preferred: rootProject || (projects.length === 1 ? projects[0] : null) };
}

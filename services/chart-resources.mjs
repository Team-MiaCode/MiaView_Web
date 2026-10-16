export const resourceNames = {
  audio: ["track.mp3", "track.wav", "track.flac", "track.ogg", "track.m4a"],
  cover: ["bg.jpg", "bg.png", "bg.jpeg", "bg.webp"],
  video: ["bg.mp4", "pv.mp4", "bg.webm", "pv.webm"],
};
export function chartDirectory(path) { return path.slice(0, path.lastIndexOf("/") + 1); }
export function resolveChartResource(files, chartPath, field) {
  const value = field?.trim().replaceAll("\\", "/");
  if (!value || value.startsWith("/") || /^[a-z]+:/i.test(value)) return null;
  const parts = chartDirectory(chartPath).split("/").filter(Boolean);
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length <= 1) return null; parts.pop(); }
    else parts.push(part);
  }
  const path = parts.join("/").toLowerCase();
  return [...files].find(([key]) => key.toLowerCase() === path)?.[1] || null;
}
export function resourceFile(file, path) {
  const result = new File([file], path.split("/").at(-1), { type: file.type, lastModified: file.lastModified });
  Object.defineProperty(result, "webkitRelativePath", { value: path });
  return result;
}
export function inputPaths(input) {
  return Object.fromEntries(Object.entries(input).map(([kind, file]) => [kind, file?.webkitRelativePath || ""]));
}
export function hydrateProjectResources(record) {
  const hydrate = entries => entries.map(([path, file]) => [path, resourceFile(file, path)]);
  record.files = hydrate(record.files); record.savedFiles = hydrate(record.savedFiles);
  const input = (values, paths, files) => Object.fromEntries(Object.entries(values).map(([kind, file]) =>
    [kind, paths[kind] ? new Map(files).get(paths[kind]) : file]));
  record.input = input(record.input, record.inputPaths, record.files);
  record.savedInput = input(record.savedInput, record.savedInputPaths, record.savedFiles);
  const files = new Map(record.files);
  record.resourceChanges = record.resourceChanges.map(([path, file]) => [path, file ? files.get(path) : null]);
  return record;
}
export function stageResource(files, filePath, kind, file, selectedPath = "") {
  const directory = chartDirectory(filePath), updated = new Map(files), writes = new Map();
  const candidates = [...updated].filter(([path]) => path === selectedPath || path.startsWith(directory)
    && resourceNames[kind].includes(path.slice(directory.length).toLowerCase()));
  let target;
  if (file) {
    const extension = file.name.split(".").at(-1).toLowerCase();
    const name = `${{ audio: "track", cover: "bg", video: "pv" }[kind]}.${extension}`;
    if (!resourceNames[kind].includes(name)) throw new Error("请选择支持的素材格式");
    target = [...updated.keys()].find(path => path.toLowerCase() === `${directory}${name}`.toLowerCase()) || directory + name;
  }
  for (const [path, previous] of candidates) {
    const dot = path.lastIndexOf("."), stem = path.slice(0, dot), suffix = path.slice(dot);
    let backup = `${stem}_bak${suffix}`, index = 2;
    while ([...updated.keys()].some(path => path.toLowerCase() === backup.toLowerCase())) backup = `${stem}_bak_${index++}${suffix}`;
    const copied = resourceFile(previous, backup);
    updated.set(backup, copied); writes.set(backup, copied);
    updated.delete(path); if (path !== target) writes.set(path, null);
  }
  const imported = file ? resourceFile(file, target) : null;
  if (imported) { updated.set(target, imported); writes.set(target, imported); }
  return { files: updated, writes, file: imported, path: target || "" };
}
export function relocatePath(path, oldRoot, newRoot) {
  const relative = oldRoot ? path.slice(oldRoot.length + 1) : path;
  if (oldRoot && !path.startsWith(`${oldRoot}/`)) throw new Error("素材路径与谱面目录存在差异");
  return `${newRoot}/${relative}`;
}

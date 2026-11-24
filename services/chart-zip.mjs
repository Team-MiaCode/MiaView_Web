import { chartDirectory, resourceNames, resolveChartResource } from "./chart-resources.mjs";
import { normalizedSource } from "../renderer/protocol.mjs";
import { fetchVerified } from "../renderer/runtime.mjs";

const mediaExtensions = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/flac": "flac", "audio/ogg": "ogg", "audio/mp4": "m4a", "image/jpeg": "jpg", "image/png": "png",
  "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" };

export function sanitizedZipStem(title) {
  const stem = String(title ?? "").trim().replace(/[\u0000\uD800-\uDFFF]/g, "")
    .replace(/[\u0001-\u001F<>:"/\\|?*]/g, "_").trim().replace(/[. ]+$/, "");
  return stem || "chart";
}

export async function chartZipFiles(project, sourceText, videoFieldValue = "", signal) {
  if (!sourceText) throw new Error("谱面为空");
  const directory = chartDirectory(project.filePath), files = new Map(project.files);
  for (const [kind, resource] of Object.entries(project.input || {})) {
    if (!resource || !resourceNames[kind]) continue;
    if (resource.webkitRelativePath && files.has(resource.webkitRelativePath)) continue;
    let file = normalizedSource(resource, globalThis.document?.baseURI || import.meta.url);
    let filename = file.name || "";
    if (!(file instanceof Blob)) {
      const descriptor = file;
      filename = new URL(descriptor.url).pathname.split("/").at(-1);
      if (descriptor.sha256) file = new Blob([await fetchVerified(descriptor, signal)], { type: descriptor.contentType });
      else {
        const response = await fetch(descriptor.url, { signal, credentials: "omit" });
        if (!response.ok) throw new Error("素材读取失败");
        file = await response.blob();
        if (descriptor.contentType) file = new Blob([file], { type: descriptor.contentType });
      }
    }
    const extension = filename.split(".").at(-1).toLowerCase();
    const name = resourceNames[kind].find(name => name.endsWith(`.${extension}`))
      || resourceNames[kind].find(name => name.endsWith(`.${mediaExtensions[file.type]}`));
    if (!name && !file.webkitRelativePath) throw new Error("请选择支持的音频、封面或 PV 格式");
    const path = file.webkitRelativePath || directory + name;
    if (!files.has(path)) files.set(path, file);
  }
  const siblings = new Map([...files].filter(([path, file]) => file && chartDirectory(path) === directory)
    .map(([path, file]) => [path.slice(directory.length).toLowerCase(), { path, file }]));
  const archive = new Map([["maidata.txt", new File([sourceText], "maidata.txt", { type: "text/plain;charset=utf-8" })]]);
  const append = entry => {
    if (entry && !/_bak$/i.test(entry.path.slice(0, entry.path.lastIndexOf(".")))) archive.set(entry.path.split("/").at(-1), entry.file);
  };
  const candidate = kind => resourceNames[kind].map(name => siblings.get(name)).find(Boolean);
  append(candidate("audio"));
  append(candidate("cover"));
  const override = resolveChartResource(files, project.filePath, videoFieldValue);
  const overrideEntry = override && [...files].find(([, file]) => file === override);
  const supportedOverride = overrideEntry && /\.(mp4|webm|jpg|jpeg|png|webp)$/i.test(overrideEntry[0]);
  const video = supportedOverride ? { path: overrideEntry[0], file: override } : candidate("video");
  if (video && chartDirectory(video.path) === directory && /\.(mp4|webm)$/i.test(video.path)) append(video);
  return archive;
}

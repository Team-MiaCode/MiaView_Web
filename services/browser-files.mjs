import { relocatePath } from "./chart-resources.mjs";
import { projectArchive } from "./zip-store.mjs";
import { sanitizedZipStem } from "./chart-zip.mjs";

export class BrowserFiles {
  constructor({ readDirectory, pickDirectory = browserPicker("showDirectoryPicker"), pickSaveFile = browserPicker("showSaveFilePicker"), pickOpenFile = browserPicker("showOpenFilePicker"), assets, download = downloadText } = {}) {
    this.readDirectory = readDirectory;
    this.pickDirectory = pickDirectory;
    this.pickSaveFile = pickSaveFile;
    this.download = download;
    this.pickOpenFile = pickOpenFile;
    this.assets = assets;
  }
  async openFiles({ accept, multiple = false, purpose, projectId, fallback }) {
    if (!this.pickOpenFile) return fallback();
    // Browser picker IDs retain their own directory history across sessions.
    const id = `${purpose}-${projectId || "global"}`.slice(0, 32);
    try {
      const extensions = accept.split(",").filter(Boolean);
      const handles = await this.pickOpenFile({ id, multiple,
        ...(extensions.length ? { types: [{ description: "素材文件", accept: { "application/octet-stream": extensions } }] } : {}) });
      return Promise.all(handles.map(handle => handle.getFile()));
    } catch (error) {
      if (error.name === "AbortError") return [];
      if (error.name === "SecurityError") return fallback();
      throw error;
    }
  }
  async openFolder({id="miacode-project",mode="readwrite"}={}) {
    if (!this.pickDirectory) return { files: await this.readDirectory(), handles: new Map() };
    let directoryHandle;
    try {
      const prior = await this.assets?.get(`file-dialog:${id}`);
      directoryHandle = await this.pickDirectory({ id, mode, ...(prior?.handle ? { startIn: prior.handle } : {}) });
      await this.assets?.put({ id: `file-dialog:${id}`, kind: "file-dialog", handle: directoryHandle });
    }
    catch (error) {
      if (error.name === "AbortError") return null;
      if (error.name === "SecurityError") return { files: await this.readDirectory(), handles: new Map() };
      throw error;
    }
    return this.readFolder(directoryHandle);
  }
  async readFolder(directoryHandle) {
    const files = [], handles = new Map();
    async function visit(directory, prefix) {
      for await (const handle of directory.values()) {
        const path = `${prefix}${handle.name}`;
        if (handle.kind === "directory") await visit(handle, `${path}/`);
        else {
          const file = await handle.getFile();
          Object.defineProperty(file, "webkitRelativePath", { value: path });
          files.push(file); handles.set(path, handle);
        }
      }
    }
    await visit(directoryHandle, `${directoryHandle.name}/`);
    return { files, handles, directoryHandle };
  }
  async saveTarget(binding, saveAs = false, project = {}) {
    if ((saveAs || project.all && !binding?.directoryHandle) && project.files?.length && this.pickDirectory) {
      let directoryHandle;
      try { directoryHandle = await this.pickDirectory({ id: "miacode-project-save", mode: "readwrite" }); }
      catch (error) { if (error.name === "AbortError") return null; if (error.name !== "SecurityError") throw error; }
      if (directoryHandle) {
        const filePath = relocatePath(project.filePath, project.resourceRoot, directoryHandle.name);
        const directory = await this.assetDirectory(directoryHandle, filePath);
        const fileHandle = await directory.getFileHandle(filePath.split("/").at(-1), { create: true });
        return { fileHandle, filePath, directoryHandle, resourceRoot: directoryHandle.name, copyResources: true };
      }
    }
    let handle = saveAs ? null : binding?.fileHandle;
    if (handle?.queryPermission && await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
      if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("请选择允许写入的谱面文件");
    }
    if (!handle && this.pickSaveFile) {
      try {
        handle = await this.pickSaveFile({ id: "miacode-chart", suggestedName: "maidata.txt",
          types: [{ description: "Simai 谱面", accept: { "text/plain": [".txt"] } }] });
      } catch (error) { if (error.name === "AbortError") return null; if (error.name !== "SecurityError") throw error; }
    }
    return handle ? { ...(handle === binding?.fileHandle ? binding : {}), fileHandle: handle, filePath: handle === binding?.fileHandle ? binding.filePath : handle.name }
      : { filePath: binding?.filePath || "maidata.txt", download: true };
  }
  async assetDirectory(root, path, create = true) {
    const parts = path.split("/");
    if (parts.shift() !== root.name || parts.some(part => !part || part === "." || part === "..")) throw new Error("素材路径与保存目录存在差异");
    parts.pop();
    let directory = root;
    for (const name of parts) directory = await directory.getDirectoryHandle(name, { create });
    return directory;
  }
  async writeResources(target, entries) {
    for (const [path, file] of entries) {
      if (!file) continue;
      const directory = await this.assetDirectory(target.directoryHandle, path);
      const fileHandle = await directory.getFileHandle(path.split("/").at(-1), { create: true });
      await this.write({ fileHandle }, file);
    }
  }
  async removeResources(target, entries) {
    for (const [path, file] of entries) {
      if (file) continue;
      try {
        const directory = await this.assetDirectory(target.directoryHandle, path, false);
        await directory.removeEntry(path.split("/").at(-1));
      } catch (error) { if (error.name !== "NotFoundError") throw error; }
    }
  }
  async readResources(target, paths) {
    const files = new Map();
    for (const path of paths) {
      const directory = await this.assetDirectory(target.directoryHandle, path, false);
      const file = await (await directory.getFileHandle(path.split("/").at(-1))).getFile();
      Object.defineProperty(file, "webkitRelativePath", { value: path }); files.set(path, file);
    }
    return files;
  }
  async projectPathExists(record) {
    const { directoryHandle, fileHandle } = record.binding || {};
    const handle = directoryHandle || fileHandle;
    if (!handle) return true;
    try {
      if (handle.queryPermission && await handle.queryPermission({ mode: "read" }) !== "granted") return true;
      const file = directoryHandle
        ? await (await this.assetDirectory(directoryHandle, record.filePath, false)).getFileHandle(record.filePath.split("/").at(-1))
        : fileHandle;
      await file.getFile();
      return true;
    } catch (error) {
      if (error.name === "NotFoundError") return false;
      throw error;
    }
  }
  async restoreProjectResources(record) {
    if (!record.binding?.directoryHandle) return record;
    const restored = new Map();
    const restore = async ([path, file]) => {
      if (!file) return [path, file];
      let pending = restored.get(file);
      if (!pending) {
        pending = (async () => {
          try { await file.slice(0, 1).arrayBuffer(); return file; }
          catch (error) {
            if (error.name !== "NotReadableError") throw error;
            return (await this.readResources(record.binding, [path])).get(path);
          }
        })();
        restored.set(file, pending);
      }
      return [path, await pending];
    };
    return { ...record, files: await Promise.all(record.files.map(restore)),
      savedFiles: await Promise.all(record.savedFiles.map(restore)), resourceChanges: await Promise.all(record.resourceChanges.map(restore)) };
  }
  async downloadProject(project, sourceText) {
    const files = new Map(project.files);
    files.set(project.filePath, new File([sourceText], "maidata.txt", { type: "text/plain;charset=utf-8" }));
    const archive = await projectArchive(files);
    await this.download(archive, `${project.resourceRoot || "MiaCode"}.zip`);
  }
  async chartZipTarget(title, binding) {
    const filePath = `${sanitizedZipStem(title)}.zip`;
    if (this.pickSaveFile) {
      try {
        const fileHandle = await this.pickSaveFile({ id: "miacode-chart-zip", suggestedName: filePath,
          ...(binding?.directoryHandle ? { startIn: binding.directoryHandle } : {}),
          types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }] });
        return { fileHandle, filePath };
      } catch (error) { if (error.name === "AbortError") return null; if (error.name !== "SecurityError") throw error; }
    }
    return { filePath, download: true };
  }
  async write(target, text) {
    if (target.download) { await this.download(text, target.filePath.split(/[\\/]/).at(-1)); return target; }
    const stream = await target.fileHandle.createWritable();
    try { await stream.write(text); await stream.close(); }
    catch (error) { await stream.abort().catch(() => {}); throw error; }
    return target;
  }
}

function browserPicker(name) {
  const picker = globalThis[name]?.bind(globalThis);
  if (!picker || !globalThis.window) return picker;
  try { return window.top.location.origin === window.location.origin ? picker : undefined; }
  catch (error) { if (error.name === "SecurityError") return undefined; throw error; }
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

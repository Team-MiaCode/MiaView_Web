import { openDatabase } from "./database.mjs";

export class ProjectStore {
  constructor(factory = globalThis.indexedDB, name = "miacode.web.projects", onBlocked) {
    this.database = openDatabase(factory, name, 2, ({ oldVersion, target: request }) => {
      const summaries = request.result.createObjectStore("summaries", { keyPath: "id" });
      summaries.createIndex("recent", ["recentFlag", "updatedAt"]);
      if (!oldVersion) {
        request.result.createObjectStore("projects", { keyPath: "id" });
        return;
      }
      request.transaction.objectStore("projects").openCursor().onsuccess = ({ target }) => {
        const cursor = target.result;
        if (!cursor) return;
        summaries.put(projectSummary(cursor.value));
        cursor.continue();
      };
    }, onBlocked);
    this.writes = Promise.resolve();
    this.fileSnapshots = new WeakMap();
  }
  async transaction(mode, operation, stores = ["projects"]) {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(stores, mode);
      let result;
      const request = operation(transaction, value => { result = value; });
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || request?.error);
      transaction.onerror = () => reject(transaction.error || request?.error);
    });
  }
  get(id) { return this.transaction("readonly", tx => tx.objectStore("projects").get(id)); }
  getSummary(id) { return this.transaction("readonly", tx => tx.objectStore("summaries").get(id), ["summaries"]); }
  async list() {
    const records = await this.transaction("readonly", tx => tx.objectStore("projects").getAll());
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async listSummaries() {
    const records = await this.transaction("readonly", tx => tx.objectStore("summaries").getAll(), ["summaries"]);
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  recent() {
    return this.transaction("readonly", (tx, setResult) => {
      const records = [];
      const paths = new Set();
      setResult(records);
      const range = IDBKeyRange.bound([1, -Infinity], [1, Infinity]);
      tx.objectStore("summaries").index("recent").openCursor(range, "prev").onsuccess = ({ target }) => {
        const cursor = target.result;
        if (!cursor) return;
        const path = recentPath(cursor.value);
        if (!path || !paths.has(path)) records.push(cursor.value);
        if (path) paths.add(path);
        if (records.length < 10) cursor.continue();
      };
    }, ["summaries"]);
  }
  put(record) {
    const write = this.writes.then(async () => {
      const snapshot = await this.snapshotProject(record);
      return this.transaction("readwrite", tx => {
        const summaries = tx.objectStore("summaries");
        summaries.get(record.id).onsuccess = ({ target }) => {
          summaries.put(projectSummary({ ...snapshot, recent: target.result?.recent ?? snapshot.recent }));
        };
        return tx.objectStore("projects").put(snapshot);
      }, ["projects", "summaries"]);
    });
    this.writes = write.catch(() => {});
    return write;
  }
  async snapshotProject(record) {
    const snapshotFile = file => {
      if (!(file instanceof Blob)) return file;
      let snapshot = this.fileSnapshots.get(file);
      if (!snapshot) {
        // File-backed blobs retain the disk reference until their bytes are read.
        snapshot = file.arrayBuffer().then(bytes => file instanceof File
          ? new File([bytes], file.name, { type: file.type, lastModified: file.lastModified })
          : new Blob([bytes], { type: file.type }));
        this.fileSnapshots.set(file, snapshot);
      }
      return snapshot;
    };
    const inputs = values => values && Promise.all(Object.entries(values).map(async ([kind, file]) => [kind, await snapshotFile(file)])).then(Object.fromEntries);
    const entries = values => values && Promise.all(values.map(async ([path, file]) => [path, await snapshotFile(file)]));
    const [input, savedInput, files, savedFiles, resourceChanges, coverFiles] = await Promise.all([
      inputs(record.input), inputs(record.savedInput), entries(record.files), entries(record.savedFiles), entries(record.resourceChanges),
      record.coverExport?.coverFiles && Promise.all(record.coverExport.coverFiles.map(async asset => ({ ...asset, file: await snapshotFile(asset.file) }))),
    ]);
    return { ...record, input, savedInput, files, savedFiles, resourceChanges,
      ...(record.coverExport ? { coverExport: { ...record.coverExport, coverFiles } } : {}) };
  }
  removeRecent(id) {
    const write = this.writes.then(() => this.transaction("readwrite", tx => {
      const summaries = tx.objectStore("summaries"), request = summaries.get(id);
      request.onsuccess = () => {
        const record = request.result;
        if (!record) return;
        const path = recentPath(record);
        if (!path) { summaries.put({ ...record, recent: false, recentFlag: 0 }); return; }
        summaries.openCursor().onsuccess = ({ target }) => {
          const cursor = target.result;
          if (!cursor) return;
          if (recentPath(cursor.value) === path) cursor.update({ ...cursor.value, recent: false, recentFlag: 0 });
          cursor.continue();
        };
      };
    }, ["summaries"]));
    this.writes = write.catch(() => {});
    return write;
  }
  delete(id) {
    const write = this.writes.then(() => this.transaction("readwrite", tx => {
      tx.objectStore("summaries").delete(id);
      return tx.objectStore("projects").delete(id);
    }, ["projects", "summaries"]));
    this.writes = write.catch(() => {});
    return write;
  }
  async close() { await this.writes; (await this.database).close(); }
}

function recentPath({ filePath, boundToPath }) {
  return boundToPath || filePath?.includes("/") ? filePath : null;
}

function projectSummary({ id, title, filePath, binding, updatedAt, recent, dirty }) {
  const boundToPath = Boolean(binding && !binding.download);
  return { id, title, filePath, boundToPath, updatedAt: updatedAt ?? 0, recent, dirty, recentFlag: recent === false ? 0 : 1 };
}

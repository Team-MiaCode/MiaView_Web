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
      setResult(records);
      const range = IDBKeyRange.bound([1, -Infinity], [1, Infinity]);
      tx.objectStore("summaries").index("recent").openCursor(range, "prev").onsuccess = ({ target }) => {
        const cursor = target.result;
        if (!cursor) return;
        records.push(cursor.value);
        if (records.length < 10) cursor.continue();
      };
    }, ["summaries"]);
  }
  put(record) {
    const write = this.writes.then(() => this.transaction("readwrite", tx => {
      tx.objectStore("summaries").put(projectSummary(record));
      return tx.objectStore("projects").put(record);
    }, ["projects", "summaries"]));
    this.writes = write.catch(() => {});
    return write;
  }
  delete(id) { return this.transaction("readwrite", tx => {
    tx.objectStore("summaries").delete(id);
    return tx.objectStore("projects").delete(id);
  }, ["projects", "summaries"]); }
  async close() { await this.writes; (await this.database).close(); }
}

function projectSummary({ id, title, filePath, updatedAt, recent, dirty }) {
  return { id, title, filePath, updatedAt: updatedAt ?? 0, recent, dirty, recentFlag: recent === false ? 0 : 1 };
}

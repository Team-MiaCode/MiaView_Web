export class ProjectStore {
  constructor(factory = globalThis.indexedDB, name = "miacode.web.projects") {
    this.database = new Promise((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    this.writes = Promise.resolve();
  }
  async transaction(mode, operation) {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("projects", mode);
      let result;
      const request = operation(transaction.objectStore("projects"));
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || request?.error);
      transaction.onerror = () => reject(transaction.error || request?.error);
    });
  }
  get(id) { return this.transaction("readonly", store => store.get(id)); }
  async list() {
    const records = await this.transaction("readonly", store => store.getAll());
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async recent() { return (await this.list()).filter(record => record.recent !== false); }
  put(record) {
    const write = this.writes.then(() => this.transaction("readwrite", store => store.put(record)));
    this.writes = write.catch(() => {});
    return write;
  }
  delete(id) { return this.transaction("readwrite", store => store.delete(id)); }
  async close() { await this.writes; (await this.database).close(); }
}

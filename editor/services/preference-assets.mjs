export class PreferenceAssets {
  constructor(factory) {
    this.factory = factory;
    this.pending = Promise.resolve();
  }
  open() {
    return this.database ??= new Promise((resolve,reject) => {
      const request = (this.factory ?? globalThis.indexedDB).open("miacode.web.assets",2);
      request.onupgradeneeded = event => {
        const store = event.oldVersion ? request.transaction.objectStore("assets") : request.result.createObjectStore("assets",{keyPath:"id"});
        store.createIndex("kind", "kind");
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async transaction(mode, action) {
    const database = await this.open();
    return new Promise((resolve,reject) => {
      const transaction = database.transaction("assets",mode), request = action(transaction.objectStore("assets"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || request.error);
      transaction.onerror = () => reject(transaction.error || request.error);
    });
  }
  get(id) { return this.transaction("readonly",store=>store.get(id)); }
  list(kind) { return this.transaction("readonly",store=>store.index("kind").getAll(kind)); }
  fonts() { return this.list("font"); }
  coverPresets() { return this.list("cover-preset"); }
  write(action) {
    const result = this.pending.then(()=>this.transaction("readwrite",action)); this.pending = result.catch(()=>{}); return result;
  }
  put(asset) { return this.write(store=>store.put(asset)); }
  delete(id) { return this.write(store=>store.delete(id)); }
  async close() { await this.pending; (await this.database)?.close(); }
}

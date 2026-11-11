import { openDatabase } from "./database.mjs";

export class PreferenceAssets {
  constructor(factory, onBlocked) {
    this.factory = factory;
    this.onBlocked = onBlocked;
    this.pending = Promise.resolve();
  }
  open() {
    return this.database ??= openDatabase(this.factory ?? globalThis.indexedDB, "miacode.web.assets", 3,
      event => {
        const request = event.target;
        const store = event.oldVersion ? request.transaction.objectStore("assets") : request.result.createObjectStore("assets",{keyPath:"id"});
        if (event.oldVersion < 2) store.createIndex("kind", "kind");
        const catalog = request.result.createObjectStore("catalog", { keyPath: "id" });
        catalog.createIndex("kind", "kind");
        store.openCursor().onsuccess = ({ target }) => {
          const cursor = target.result;
          if (!cursor) return;
          if (appearanceKinds.has(cursor.value.kind)) catalog.put(assetMetadata(cursor.value));
          cursor.continue();
        };
      }, this.onBlocked);
  }
  async transaction(mode, action, stores = ["assets"]) {
    const database = await this.open();
    return new Promise((resolve,reject) => {
      const transaction = database.transaction(stores,mode), request = action(transaction);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || request.error);
      transaction.onerror = () => reject(transaction.error || request.error);
    });
  }
  get(id) { return this.transaction("readonly", tx => tx.objectStore("assets").get(id)); }
  list(kind) { return this.transaction("readonly", tx => tx.objectStore("assets").index("kind").getAll(kind)); }
  catalog(kind) { return this.transaction("readonly", tx => tx.objectStore("catalog").index("kind").getAll(kind), ["catalog"]); }
  coverPresets() { return this.list("cover-preset"); }
  write(action) {
    const result = this.pending.then(()=>this.transaction("readwrite",action, ["assets", "catalog"])); this.pending = result.catch(()=>{}); return result;
  }
  put(asset) { return this.write(tx => {
    if (appearanceKinds.has(asset.kind)) tx.objectStore("catalog").put(assetMetadata(asset));
    return tx.objectStore("assets").put(asset);
  }); }
  delete(id) { return this.write(tx => {
    tx.objectStore("catalog").delete(id);
    return tx.objectStore("assets").delete(id);
  }); }
  async close() { await this.pending; (await this.database)?.close(); }
}

const appearanceKinds = new Set(["font", "skin", "outline"]);
function assetMetadata({ file, files, ...metadata }) { return metadata; }

import { leaseAppearanceAssets } from "./appearance-assets.mjs";

export async function loadPreviewFonts(preview, assets, paths) {
  for (const path of new Set(paths.filter(Boolean))) {
    const record = await assets.get(`font:${path}`);
    if (!record) throw new Error(`请导入字体素材：${path}`);
    await preview.importFont(record.file, record.file.name);
  }
}

export class UserFonts {
  constructor(preview, assets) {
    this.preview = preview; this.assets = assets;
    this.fonts = new Map(); this.faces = new Map();
    this.pending = Promise.resolve();
  }
  async import(file) {
    const lease = leaseAppearanceAssets(this.preview);
    try {
      const font = await lease.importFont(file, file.name);
      const result = { ...font, cssFamily: `MiaCode-user-${font.sha256}` };
      await this.assets.put({ id: `font:${font.path}`, kind: "font", file, ...result });
      this.fonts.set(font.path, result);
      return result;
    } finally { await lease.release(); }
  }
  async restore() {
    for (const { path, family, sha256 } of await this.assets.catalog("font"))
      this.fonts.set(path, { path, family, sha256, cssFamily: `MiaCode-user-${sha256}` });
    return this.list();
  }
  show(paths) {
    const selected = new Set(paths.filter(Boolean));
    const update = this.pending.then(async () => {
      if (this.destroyed) return;
      for (const [path, face] of this.faces) if (!selected.has(path)) {
        document.fonts.delete(face); this.faces.delete(path);
      }
      for (const path of selected) if (!this.faces.has(path)) {
        const record = await this.assets.get(`font:${path}`);
        if (!record) continue;
        const face = await new FontFace(`MiaCode-user-${record.sha256}`, await record.file.arrayBuffer()).load();
        if (this.destroyed) return;
        document.fonts.add(face); this.faces.set(path, face);
      }
    });
    this.pending = update.catch(() => {});
    return update;
  }
  list() { return [...this.fonts.values()].sort((left, right) => left.family.localeCompare(right.family)); }
  destroy() {
    this.destroyed = true;
    for (const face of this.faces.values()) document.fonts.delete(face);
    this.faces.clear(); this.fonts.clear();
  }
}

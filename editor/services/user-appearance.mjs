import { loadPreviewFonts } from "./user-fonts.mjs";
import { leaseAppearanceAssets } from "./appearance-assets.mjs";

export function skinFolder(files) {
  const paths = files.map(file => ({ path: file.webkitRelativePath || file.name, file }));
  const taps = paths.filter(item => item.path.split("/").at(-1) === "tap.png");
  if (taps.length !== 1) throw new Error("请选择包含 tap.png 的单个皮肤目录");
  const prefix = taps[0].path.slice(0, -"tap.png".length);
  return { name: prefix.split("/").filter(Boolean).at(-1) || "Skin",
    files: paths.filter(item => item.path.startsWith(prefix) && item.path.endsWith(".png"))
      .map(item => ({ path: item.path.slice(prefix.length), file: item.file })) };
}
export async function restorePreviewAppearance(preview, assets, settings) {
  const skin = settings.skinDirectoryName;
  if (skin?.startsWith("skin-")) {
    const record = await assets.get(`skin:${skin}`);
    if (!record) throw new Error("请导入所选皮肤");
    const result = await preview.importSkin(record.files.map(item => ({ path: item.path, image: item.file })));
    if (result.skinDirectoryName !== skin) throw new Error("皮肤素材与保存记录存在差异");
  }
  const outline = settings.customOutlineFileName;
  if (outline) {
    const record = await assets.get(`outline:${outline}`);
    if (!record) throw new Error("请导入所选判定线");
    const result = await preview.importJudgeLine(record.file);
    if (result.customOutlineFileName !== outline) throw new Error("判定线素材与保存记录存在差异");
  }
}

export class UserAppearance {
  constructor(preview, assets) { this.preview = preview; this.assets = assets; this.pending = Promise.resolve(); }
  async list() {
    const [skins, outlines] = await Promise.all([this.assets.catalog("skin"), this.assets.catalog("outline")]);
    return { userSkins: skins.map(({ name, skinDirectoryName }) => ({ name, skinDirectoryName })),
      userOutlines: outlines.map(({ name, customOutlineFileName }) => ({ name, customOutlineFileName })) };
  }
  apply(changes) {
    const result = this.pending.then(() => this.applySettings(changes));
    this.pending = result.catch(() => {});
    return result;
  }
  async applySettings(changes) {
    const lease = leaseAppearanceAssets(this.preview);
    try {
      await loadPreviewFonts(lease, this.assets, Object.values(changes.hudFontPaths || {}));
      await restorePreviewAppearance(lease, this.assets, changes);
      return await this.preview.setSettings(changes);
    } finally {
      await lease.release();
    }
  }
  async importSkin(files) {
    const folder = skinFolder(files);
    const lease = leaseAppearanceAssets(this.preview);
    try {
      const result = await lease.importSkin(folder.files.map(item => ({ path: item.path, image: item.file })));
      await this.assets.put({ ...folder, ...result, id: `skin:${result.skinDirectoryName}`, kind: "skin" });
      return result;
    } finally { await lease.release(); }
  }
  async importJudgeLine(file) {
    const lease = leaseAppearanceAssets(this.preview);
    try {
      const result = await lease.importJudgeLine(file);
      await this.assets.put({ ...result, file, name: file.name, id: `outline:${result.customOutlineFileName}`, kind: "outline" });
      return result;
    } finally { await lease.release(); }
  }
}

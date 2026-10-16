export function skinFolder(files) {
  const paths = files.map(file => ({ path: file.webkitRelativePath || file.name, file }));
  const taps = paths.filter(item => item.path.split("/").at(-1) === "tap.png");
  if (taps.length !== 1) throw new Error("请选择包含 tap.png 的单个皮肤目录");
  const prefix = taps[0].path.slice(0, -"tap.png".length);
  return { name: prefix.split("/").filter(Boolean).at(-1) || "Skin",
    files: paths.filter(item => item.path.startsWith(prefix) && item.path.endsWith(".png"))
      .map(item => ({ path: item.path.slice(prefix.length), file: item.file })) };
}

export async function restorePreviewAppearance(preview, assets, settings, imported = new Set()) {
  const skin = settings.skinDirectoryName;
  if (skin?.startsWith("skin-") && !imported.has(skin)) {
    const record = await assets.get(`skin:${skin}`);
    if (!record) throw new Error("请导入所选皮肤");
    const result = await preview.importSkin(record.files.map(item => ({ path: item.path, image: item.file })));
    if (result.skinDirectoryName !== skin) throw new Error("皮肤素材与保存记录存在差异");
    imported.add(skin);
  }
  const outline = settings.customOutlineFileName;
  if (outline && !imported.has(outline)) {
    const record = await assets.get(`outline:${outline}`);
    if (!record) throw new Error("请导入所选判定线");
    const result = await preview.importJudgeLine(record.file);
    if (result.customOutlineFileName !== outline) throw new Error("判定线素材与保存记录存在差异");
    imported.add(outline);
  }
}

export class UserAppearance {
  constructor(preview, assets) { this.preview = preview; this.assets = assets; this.imported = new Set(); }
  async list() {
    const [skins, outlines] = await Promise.all([this.assets.list("skin"), this.assets.list("outline")]);
    return { userSkins: skins.map(({ name, skinDirectoryName }) => ({ name, skinDirectoryName })),
      userOutlines: outlines.map(({ name, customOutlineFileName }) => ({ name, customOutlineFileName })) };
  }
  restore(settings) { return restorePreviewAppearance(this.preview, this.assets, settings, this.imported); }
  async importSkin(files) {
    const folder = skinFolder(files);
    const result = await this.preview.importSkin(folder.files.map(item => ({ path: item.path, image: item.file })));
    await this.assets.put({ ...folder, ...result, id: `skin:${result.skinDirectoryName}`, kind: "skin" });
    this.imported.add(result.skinDirectoryName);
    return result;
  }
  async importJudgeLine(file) {
    const result = await this.preview.importJudgeLine(file);
    await this.assets.put({ ...result, file, name: file.name, id: `outline:${result.customOutlineFileName}`, kind: "outline" });
    this.imported.add(result.customOutlineFileName);
    return result;
  }
}

export function leaseAppearanceAssets(preview) {
  const owner = crypto.randomUUID();
  return {
    importFont: (file, name) => preview.importFont(file, name, owner),
    importSkin: files => preview.importSkin(files, owner),
    importJudgeLine: image => preview.importJudgeLine(image, owner),
    release: fontPaths => preview.releaseUnusedAppearance(owner, fontPaths),
  };
}

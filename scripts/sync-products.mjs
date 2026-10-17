import { cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourcePin } from "./source-pin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.argv.includes("--runtime");
const generated = new Set(["miacode-preview.js", "miacode-preview.wasm", "miacode-analysis.js", "miacode-analysis.wasm", "qtloader.js", "theme.css", "build-identity.json", "artifact-manifest.json", "LICENSE", "LICENSE_SCOPE.md", "THIRD_PARTY_NOTICES.md", "sfx"]);
const configuration = sourcePin(root);
const packageSource = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
function sameFile(source, target) {
  if (!existsSync(target)) return false;
  const from = lstatSync(source), to = lstatSync(target);
  return from.isFile() && to.isFile() && from.size === to.size
    && readFileSync(source).equals(readFileSync(target));
}
const destination = join(root, "editor");
mkdirSync(destination, { recursive: true });
for (const name of ["sdk", "renderer", "services", "ui", "native", "scripts", "dev", "tests", "examples", "backend", "docs", ".assets"]) {
  cpSync(join(root, name), join(destination, name), { recursive: true, filter: (path, target) => {
    const relative = path.slice(join(root, name).length + 1).replaceAll("\\", "/");
    if (relative.split("/").includes("__pycache__") || relative.endsWith(".pyc")) return false;
    if (name === "scripts" && relative === "sync-products.mjs") return false;
    if (name === "tests" && relative === "editor-template-smoke.mjs") return false;
    if (name === "native" && ["build", "build-release", "build-dev-refactor-release"].includes(relative.split("/")[0])) return false;
    if (name === "renderer" && !runtime && (generated.has(relative.split("/")[0]) || /\.(br|gz)$/.test(relative))) return false;
    return !sameFile(path, target);
  } });
}
for (const path of ["scripts/sync-products.mjs", "tests/editor-template-smoke.mjs", "ui/workbench/media-tools.mjs"]) rmSync(join(destination, path), { force: true });
for (const name of ["index.html", "app.mjs", "page.css", "preview-window.html"])
  if (!sameFile(join(root, name), join(destination, name))) copyFileSync(join(root, name), join(destination, name));
const productPackage = { ...packageSource, name: "miacode-web-editor", description: "MiaCode Web Editor: browser workbench and embeddable preview", scripts: { ...packageSource.scripts } };
delete productPackage.scripts["sync:products"];
delete productPackage.scripts["test:editor-template"];
writeFileSync(join(destination, "package.json"), JSON.stringify(productPackage, null, 2) + "\n");
const productLock=JSON.parse(readFileSync(join(root,"package-lock.json"),"utf8"));
productLock.name=productPackage.name;productLock.packages[""].name=productPackage.name;
writeFileSync(join(destination,"package-lock.json"),JSON.stringify(productLock,null,2)+"\n");
writeFileSync(join(destination, "source-config.json"), JSON.stringify(configuration, null, 2) + "\n");
writeFileSync(join(destination, ".gitignore"), readFileSync(join(root, ".gitignore"), "utf8") + "\n/vendor/MiaCode/\n");
writeFileSync(join(destination, "README.md"), `# MiaCode Web Editor\n\n本目录采用主项目的 HTML/CSS、ES modules、iframe SDK 与 Qt Quick/WASM 架构，包含自身的入口、界面、服务、预览适配器、构建脚本和源版本配置。\n\n初始化源码与运行时：\n\n\`\`\`sh\nnode scripts/initialize-source.mjs\nnode scripts/fetch-runtime.mjs\nnpm run dev\n\`\`\`\n\n运行时与源码版本一致时可使用预编译产物。源码构建使用本目录的 \`build-devtools/\` 与 Release 配置；工具链配置位于 \`native/toolchain.json\`。功能与发布验收见 \`docs/WEB_EDITOR_MIGRATION_PLAN_ZH.md\`。\n`);
console.log(`Editor template synchronized: ${destination}`);

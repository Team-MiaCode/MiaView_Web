# MiaCode Web Editor

本目录采用主项目的 HTML/CSS、ES modules、iframe SDK 与 Qt Quick/WASM 架构，包含自身的入口、界面、服务、预览适配器、构建脚本和源版本配置。

初始化源码与运行时：

```sh
node scripts/initialize-source.mjs
node scripts/fetch-runtime.mjs
npm run dev
```

运行时与源码版本一致时可使用预编译产物。源码构建使用本目录的 `build-devtools/` 与 Release 配置；工具链配置位于 `native/toolchain.json`。功能与发布验收见 `docs/WEB_EDITOR_MIGRATION_PLAN_ZH.md`。

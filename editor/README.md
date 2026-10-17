# MiaCode Web Editor

本目录提供编辑器页面、编辑器 SDK 与预览 SDK，采用 HTML/CSS、ES modules、iframe 和 Qt Quick/WASM 架构。入口为 `index.html`，编辑器接入示例为 `examples/editor.html`。

## 运行与构建

在本目录执行，Node.js 22+：

```sh
npm ci
node scripts/initialize-source.mjs
node scripts/fetch-runtime.mjs https://team-miacode.github.io/MiaView_Web/feature/renderer/
npm run check:source
npm run dev
```

源码与运行时的固定上游和 native 输入哈希逐项核对。源码构建使用本目录的 `build-devtools/`，配置为 Release；Qt 与 Emscripten 版本见 `native/toolchain.json`，安装脚本为 `scripts/install-qt.py`，构建命令为 `npm run build:native`。工具链、上游源码及生成资源放在本目录的 `.deps/`、`vendor/MiaCode/` 和 `renderer/`。

## 嵌入网页

部署整个目录，宿主容器设置高度：

```html
<div id="editor" style="height:80vh"></div>
<script type="module">
  import { createEditor } from './sdk/editor.mjs';
  const editor = createEditor(document.getElementById('editor'));
  await editor.ready;
  await editor.load({ maidata: '&title=Example\n&lv_5=12\n&inote_5=(120){4}1,2,3,4,E' });
  editor.on('documentChanged', document => console.log(document.revision));
  await editor.command('page.metadata');
  const saved = await editor.getDocumentSaveText();
  console.log(saved.sourceText);
  // 页面卸载或移除组件时调用 editor.destroy()。
</script>
```

`load` 支持正文、File/Blob 与 HTTP(S) 资源，`audio`、`cover`、`video` 沿用预览 SDK 字段。`command` 使用 [工作台命令](docs/WEB_EDITOR_COMMANDS_ZH.md)，`getDocument` 返回共享文档快照，`getState` 返回预览状态。SDK 通过来源、窗口与会话标识校验 iframe 消息，支持同页多个实例及跨来源部署。跨来源文件选择使用文件夹输入，保存生成谱面或资源 ZIP。

帧率通过性能偏好命令设置并保存：`editor.command('preferences.performance', { canvasFrameRateMode: 1, stageMediaFrameRateMode: 1, timelineFrameRateMode: 1 })`。模式 `0/1/2/3` 对应 `30/60/120 FPS/无限制`。时间轴沿用 v2 的居中播放跟随。

预览 SDK 入口为 `sdk/index.mjs`，类型入口与实现同名。运行验收使用 `npm test`、`npm run check:source`、`npm run build:pages`。阶段要求见 [迁移计划](docs/WEB_EDITOR_MIGRATION_PLAN_ZH.md)。

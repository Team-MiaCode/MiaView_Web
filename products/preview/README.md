# MiaView Web Preview

本目录提供独立预览页面与预览 SDK，采用主项目的 ES modules、iframe SDK 和 Qt Quick/WASM 架构。入口为 `index.html`，选择谱面文件夹读取 `maidata.txt`、`track.*`、`bg.*` 与 PV；谱面集合通过文件夹列表切换。

## 运行与构建

在本目录执行，Node.js 22+：

```sh
npm ci
node scripts/initialize-source.mjs
node scripts/fetch-runtime.mjs https://team-miacode.github.io/MiaView_Web/feature/renderer/
npm run check:source
npm run dev
```

工具链版本见 `native/toolchain.json`，Qt 安装脚本为 `scripts/install-qt.py`。源码构建使用本目录的固定上游 `vendor/MiaCode/`、工具链 `.deps/` 与 Release 构建目录 `build-devtools/`，命令为 `npm run build:native`。预编译运行时按上游与 native 输入哈希核对。

## 嵌入网页

部署整个目录，接入示例为 `examples/index.html`：

```html
<div id="preview" style="height:70vh"></div>
<script type="module">
  import { createPreview } from './sdk/index.mjs';
  const preview = createPreview(document.getElementById('preview'), { layout: 'fit' });
  await preview.ready;
  await preview.load({ maidata: '&title=Example\n&lv_5=12\n&inote_5=(120){4}1,2,3,4,E' });
  preview.on('timeupdate', state => console.log(state.currentTime));
  await preview.play();
  await preview.pause();
  // 页面卸载或移除组件时调用 preview.destroy()。
</script>
```

`maidata` 接受正文、File/Blob 或 `{ url }`；`audio`、`cover`、`video` 接受 File/Blob 或 HTTP(S) 资源。播放、难度、倍率、帧率、主题、设置、状态与事件沿用 `sdk/index.d.mts`。每个 iframe 拥有自身预览引擎，SDK 校验来源、窗口与会话，支持子路径部署、多实例及跨来源宿主。

验证入口为 `npm test`、`npm run check:source` 和 `npm run build:pages`。协议、控件、渲染适配器与原生桥接源码沿用主项目文件名和公共字段。

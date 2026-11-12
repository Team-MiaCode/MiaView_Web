# MiaView Web Preview

本目录提供独立预览页面与预览 SDK，采用主项目的 ES modules、iframe SDK 和 Qt Quick/WASM 架构。入口为 `index.html`，选择谱面文件夹读取 `maidata.txt`、`track.*`、`bg.*` 与 PV；谱面集合通过文件夹列表切换。

也可单独打开谱面文件，通过“媒体”选择音乐、背景图和 PV。预览区包含进度条、播放控制和音符统计。播放控制栏的预览设置和音频设置按钮，在进度条上方打开半透明设置面板。

在本目录运行 `npm run dev` 后，打开[独立预览示例页](http://127.0.0.1:3030/index.html?demo=1)。页面载入内置谱面。静态部署时，在预览入口的 `index.html` 后加上 `?demo=1` 即可打开同一个示例。

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

部署同一版本的 `sdk/`、`renderer/`、`ui/` 和 `services/`。基础示例位于 `examples/index.html`。React 组件和外部宿主适配器见 [SDK 发布分支的示例](https://github.com/Team-MiaCode/MiaView_Web/tree/standalone-preview/examples)。

```html
<div id="preview" style="height:min(70dvh, 100vw * 865 / 741)"></div>
<script type="module">
  import { createPreview } from './sdk/index.mjs';
  const preview = createPreview(document.getElementById('preview'), { layout: 'fit', diagnostics: false });
  const stop = preview.on('playing', event => console.log(event.elapsedMs));
  await preview.ready;
  await preview.load({ maidata: '&title=Example\n&lv_5=12\n&inote_5=(120){4}1,2,3,4,E' });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    stop();
    preview.destroy();
  });
</script>
```

`controls` 默认为 `true`，在 iframe 中显示画面、统计、进度条、播放控制和设置覆盖层。设为 `false` 时由宿主组装控制区。`layout: "fit"` 让 iframe 填满容器。完整面板默认按 741∶865 布局。设置 `panelLayout: "fill"` 后，面板填满 iframe，宿主可分别指定容器宽度和高度。

| 接口 | 输入与结果 |
| --- | --- |
| `ready` | 渲染器、运行时和面板设置就绪后兑现。加载失败时拒绝 |
| `load()` | `maidata` 接受正文、File/Blob 或 `{ url }`。`audio`、`cover`、`video` 接受 File/Blob 或 HTTP(S) 资源。成功返回标题、难度和时长 |
| `selectDifficulty(id)` | 使用加载结果中的难度 ID，成功后可用 `getState()` 读取当前难度 |
| `play()`、`pause()`、`seek(seconds)`、`restart()` | 操作当前谱面，返回预览状态。时间以秒计 |
| `on(type, listener)` | 返回取消订阅函数。`progress.progress` 取值 0 到 1。`loaded` 在当前谱面加载完成时返回 `ChartInfo`。`error` 提供错误代码和描述。`playing` 在实际开始播放时触发，`elapsedMs` 以毫秒计 |
| `destroy()` | 移除实例、释放订阅，等待中的调用随实例关闭而拒绝 |

连续调用 `load()` 时采用最新资源，先前请求以 `AbortError` 结束。媒体权限由宿主处理。需要登录的资源可由宿主获取为 Blob，再传给播放器。面板设置默认保留在实例内，传入 `preferencesKey` 可按渲染器来源和存储键持久化。自定义皮肤、判定线和字体资源保存在渲染器来源的素材库。

React 示例通过 `loadResources(chartId, signal)` 查询作品信息，把 `{ id, bgExt, hasVideo, difficulty }` 交给适配器，由适配器映射为 SDK 的四种资源。宿主可通过 `onPlaying(chartId, event)` 接收播放通知。

验证入口为 `npm test`、`npm run check:source` 和 `npm run build:pages`。协议、控件、渲染适配器与原生桥接源码沿用主项目文件名和公共字段。

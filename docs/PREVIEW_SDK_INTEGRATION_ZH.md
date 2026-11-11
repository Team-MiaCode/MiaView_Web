# 接入 MiaCode Web 预览 SDK

本说明适用于 `standalone-preview` 分支，示例以宿主提供的谱面和媒体地址创建播放器。

## 下载与部署

在 [Web preview 构建列表](https://github.com/Team-MiaCode/MiaView_Web/actions/workflows/web.yml)选择 `standalone-preview` 对应提交的成功运行，下载 **`miaview-preview`**。解压后将下列四个完整目录放在网站同一个静态前缀，例如 Next.js 项目的 `public/miaview/`。

| 目录 | 用途 |
| --- | --- |
| `sdk/` | 对外入口 `index.mjs`、TypeScript 声明及 SDK 模块 |
| `renderer/` | iframe 入口、Qt JS/WASM、运行时清单、音效及运行资源 |
| `ui/` | 播放面板、设置组件、样式、字体及图标 |
| `services/` | 播放器使用的共享资源与设置服务 |

若构建产物过期，可对同一提交重新运行工作流，或按[仓库构建说明](../README.md#开发与构建)构建原生运行时，再执行 `npm run sync:products -- --runtime`，从 `build-devtools/products/preview` 提取这四个目录。`miaview-preview-standalone` 的解压根目录也提供同名目录。

部署时保留目录内的文件和相对路径，四个目录按同一版本一起更新。`.mjs` 使用 JavaScript MIME 类型，`.wasm` 使用 `application/wasm`。确认 `/miaview/sdk/index.mjs`、`/miaview/renderer/index.html` 和 `/miaview/renderer/build-identity.json` 可访问。示例采用网站同源 HTTPS 和 `diagnostics: false`，这组配置只需静态文件。

## 替换现有播放器

把详情页原播放器 iframe 换为一个容器。用下方模块替换旧 iframe 的加载与消息监听，原页面继续持有难度列表和业务状态。SDK 会创建 iframe，并在其中显示预览、播放控制和设置面板。

```html
<div style="container-type: inline-size">
  <div id="chart-preview" style="height: min(72dvh, 100cqw * 865 / 741)"></div>
</div>
```

`layout: "fit"` 让 iframe 填满宿主容器。完整面板默认按 `741∶865` 布局，上面的容器高度上限让面板适合窄卡片。宿主也可以分别指定容器的宽和高，并在创建选项中加入 `panelLayout: "fill"`，使面板填满容器。画布分辨率通过 `resolution` 或 `setCanvasSize()` 设置。

将以下模块保存为网站自己的 `chart-player.mjs`。入口采用浏览器 ES module，可与现有 React 或 Next.js 页面配合使用。

```js
import { createPreview } from "/miaview/sdk/index.mjs";

export function mountChartPlayer(container, chart, handlers = {}) {
  const abort = new AbortController();
  const { signal } = abort;
  const preview = createPreview(container, {
    rendererUrl: "/miaview/renderer/index.html",
    layout: "fit",
    diagnostics: false,
    resolution: { width: 1080, height: 1080 },
  });

  const fileBlob = async url => {
    if (!url) return undefined;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`预览资源加载失败（HTTP ${response.status}）`);
    return response.blob();
  };

  let firstPlay = true;
  const unsubscribe = [
    preview.on("progress", event => handlers.onProgress?.(event)),
    preview.on("playing", event => {
      handlers.onPlaying?.(event);
      if (firstPlay) {
        firstPlay = false;
        void Promise.resolve()
          .then(() => handlers.onFirstPlay?.(chart.id))
          .catch(error => handlers.onError?.(error));
      }
    }),
  ];

  const ready = (async () => {
    const [, maidata, audio, cover] = await Promise.all([
      preview.ready,
      fileBlob(chart.maidataUrl),
      fileBlob(chart.audioUrl),
      fileBlob(chart.coverUrl),
    ]);
    signal.throwIfAborted();
    return preview.load({
      maidata,
      audio,
      cover,
      video: chart.videoUrl ? new URL(chart.videoUrl, location.href).href : undefined,
      difficulty: chart.difficulty,
    });
  })();

  return {
    ready,
    async selectDifficulty(id) {
      await ready;
      await preview.selectDifficulty(Number(id));
      return (await preview.getState()).difficultyId;
    },
    destroy() {
      abort.abort();
      for (const stop of unsubscribe) stop();
      preview.destroy();
    },
  };
}
```

将模块放在网站的 `public/chart-player.mjs`。以下代码可在详情页浏览器模块中调用。将 `#chart-difficulty` 和 `#chart-preview-status` 对应到网站现有的难度列表和状态区。

```js
import { mountChartPlayer } from "/chart-player.mjs";

export function attachChart(chart, { onFirstPlay } = {}) {
  const difficulty = document.querySelector("#chart-difficulty");
  const status = document.querySelector("#chart-preview-status");
  const report = error => { status.textContent = error.message; };
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const player = mountChartPlayer(document.querySelector("#chart-preview"), chart, {
    onProgress: ({ stage }) => { status.textContent = stage; },
    onFirstPlay,
    onError: report,
  });

  let selected;
  difficulty.disabled = true;
  void player.ready.then(info => {
    if (signal.aborted) return;
    difficulty.replaceChildren(...info.charts.map(item => new Option(item.label, item.id)));
    difficulty.value = selected = String(info.difficultyId);
    difficulty.disabled = false;
    status.textContent = info.title;
  }).catch(error => { if (!signal.aborted) report(error); });

  difficulty.addEventListener("change", async () => {
    difficulty.disabled = true;
    try {
      selected = String(await player.selectDifficulty(difficulty.value));
    } catch (error) {
      if (!signal.aborted) report(error);
    } finally {
      if (!signal.aborted) {
        difficulty.value = selected;
        difficulty.disabled = false;
      }
    }
  }, { signal });

  return () => {
    lifetime.abort();
    player.destroy();
  };
}

const detach = attachChart({
  id: "demo",
  maidataUrl: "/charts/demo/maidata.txt",
  audioUrl: "/charts/demo/track.mp3",
  coverUrl: "/charts/demo/bg.jpg",
  videoUrl: "/charts/demo/bg.mp4",
  difficulty: 5,
});
```

切换作品或卸载组件时调用返回的 `detach()`。React 页面可在客户端 effect 中创建播放器，并把 `detach` 作为清理函数。难度列表由 React 管理时，用 `info.charts` 和 `info.difficultyId` 更新组件状态。网站已有浏览量处理函数时，可将其传给 `onFirstPlay`，沿用网站的计数和显示逻辑。

## 对接字段和事件

| 项目 | 接法 |
| --- | --- |
| 谱面 | `maidata.txt` 读取成 Blob 后传入 `maidata`。也可传谱面正文或 `{ url: "…" }` |
| 音乐 | `track.mp3` 对应 `audio`。可传 Blob 或 URL |
| 封面 | 将宿主提供的封面 URL 或 Blob 传入 `cover`。缺省时省略 |
| 视频 | 将宿主提供的视频 URL 或 Blob 传入 `video`。缺省时省略 |
| 初始难度 | 将谱面已有的难度编号传入 `load()` 的 `difficulty` |
| 切换难度 | 侧栏调用 `player.selectDifficulty(id)`，等待成功后按返回的实际编号更新选中项 |
| 加载状态 | `onProgress({ stage, progress })` 提供阶段和 0 到 1 的进度，`player.ready` 返回谱面加载结果 |
| 播放事件 | `onPlaying({ elapsedMs })` 在实际开始或恢复播放时触发，单位为毫秒。首次播放用 `onFirstPlay(chartId)` 接到网站原有的浏览量处理函数 |

网站按作品保留现有的浏览量去重策略。示例对单次播放器挂载去重，跨组件重挂的去重由网站负责。谱面、音乐和封面的请求沿用网站登录态。需要鉴权的视频由宿主获取 Blob 或签发播放器可读取的 URL。媒体跨域部署时，由资源服务器允许播放器来源读取相应资源。

## 分支与交付物

当前分支包含完整的 **MiaCode Web 网页编辑器源码**。仓库根目录提供工作台及共享源码，Pages 输出的 `editor/` 和 `preview/` 分别提供独立编辑器和预览入口。部署完整编辑器选择 `miaview-editor`。网站详情页接入播放器可使用 `miaview-preview` 的四个静态目录，生成的 Qt JS/WASM 随构建产物提供。

仓库另有 [HTML 示例](../examples/pages.html)、[React 示例](../examples/react-preview.jsx)和[网站资源适配器](../examples/chart-website-adapter.mjs)。

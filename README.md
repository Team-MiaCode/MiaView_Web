# MiaCode Web Preview

可嵌入网站的实时谱面预览模块：在浏览器中运行 MiaCode 原生 Simai 解析器和导出共用场景，使用 WebAssembly / Qt Quick / WebGL 2 绘制、WebAudio 播放。画面采用导出模板，但不生成或下载视频；不是 MiaCode 桌面应用的完整移植。

不依赖原网站的 API、Next.js、React、数据库、账号系统或播放遥测。预编译文件可以直接静态部署；只有本地示例服务器和重新编译原生代码需要开发工具。

## 目录与版本

```text
MiaCodeWebPreview/
├── sdk/                       网站接入接口和 TypeScript 声明
│   ├── index.mjs
│   └── index.d.mts
├── renderer/                  可直接部署的完整播放器
│   ├── index.html
│   ├── player.mjs
│   ├── runtime.mjs
│   ├── sdk-bridge.mjs
│   ├── miacode-preview.js
│   ├── miacode-preview.wasm
│   ├── qtloader.js
│   ├── build-identity.json
│   ├── artifact-manifest.json
│   └── sfx/                   判定音效
├── native/                    原生宿主、上游源码/资源及构建脚本
├── examples/                  文件夹加载示例
├── scripts/                   本地静态服务器及完整性检查
├── tests/                     接口、类型及可选浏览器检查
└── .miacode-sdk-export.json    提取时的网站版本和独立模块版本
```

`renderer/build-identity.json` 是独立模块的实际构建身份；`.miacode-sdk-export.json` 记录提取来源。SDK 使用独立消息桥，所以它的版本号与网站播放器不同，这不表示引擎更旧。提取时沿用网站同一套 JS/WASM，复制最新原生宿主及浏览器适配，只替换独立接入桥并重新生成身份/哈希。

## 本地运行

需要 Node.js 22 或更高版本，不需要先执行 `npm install`：

```sh
cd /path/to/MiaCodeWebPreview
npm run dev
```

浏览器打开 `http://localhost:3030`。选择含有 `maidata.txt` 的谱面文件夹，可同时提供音乐、背景图片和 PV；加载完成后默认暂停，点击播放开始。文件只在本地浏览器读取，不上传到示例服务器。

示例按扩展名寻找首个音乐/图片/视频文件，多份同类素材时请使用接口明确指定。浏览器是否能解码音视频由设备和编解码支持决定，不是看到扩展名就保证可播放。

示例可切换 1920×1080 / 1080×1080，选择难度，并调用播放、暂停、重播和销毁。画面下方保留播放器内置控制栏与设置面板。关闭终端中的服务用 `Ctrl+C`。修改端口：

```sh
PORT=3031 npm run dev
```

服务器仅监听 `127.0.0.1`，用于本机开发，不是生产服务。不能通过 `file://` 双击 HTML 运行，也不应把它直接暴露到公网。

## 嵌入网站

### 静态目录部署

将整个 `sdk/` 和整个 `renderer/` 复制到网站静态目录，例如：

```text
public/miacode/sdk/...
public/miacode/renderer/...
```

默认播放器地址是相对于 SDK 模块的 `../renderer/index.html`。若目录结构不同，或使用打包工具把 SDK 合并进网站脚本，显式传入 `rendererUrl`。不要只复制 WASM；JS、Qt loader、适配脚本、CSS、构建身份、清单和音效都要保留。

```html
<div id="preview" style="width:100%;max-width:960px"></div>
<button id="play" disabled>播放</button>
<p id="status" role="status"></p>

<script type="module">
  import { createPreview } from "/miacode/sdk/index.mjs";

  const status = document.getElementById("status");
  const playButton = document.getElementById("play");
  const preview = createPreview(document.getElementById("preview"), {
    rendererUrl: "/miacode/renderer/index.html",
    resolution: { width: 1920, height: 1080 },
    timeoutMs: 120000,
  });

  preview.on("error", ({ message }) => {
    status.textContent = message;
  });
  preview.on("progress", ({ stage, progress }) => {
    status.textContent = `${stage} ${Math.round(progress * 100)}%`;
  });
  playButton.onclick = () =>
    preview.play().catch((error) => {
      status.textContent = error.message;
    });

  try {
    await preview.ready;
    const info = await preview.load({
      maidata: { url: "/charts/example/maidata.txt" },
      audio: "/charts/example/track.mp3",
      cover: "/charts/example/cover.jpg", // 可选
      video: "/charts/example/pv.mp4", // 可选；有 PV 时使用视频背景
      difficulty: 5,
    });
    status.textContent = info.title;
    playButton.disabled = false;
  } catch (error) {
    status.textContent = error.message;
  }

  window.addEventListener("pagehide", () => preview.destroy(), { once: true });
</script>
```

路径仅为接入示例，模块不附带这些谱面/音乐文件。加载成功不自动播放；首次发声需要浏览器允许用户操作触发的音频播放。若宿主按钮无法解锁跨域 iframe 的音频，先点击播放器内置「播放」。

### 框架与多实例

这是框架无关的 ES module。React/Vue/Svelte 等在 DOM 挂载后调用 `createPreview`，卸载时调用 `destroy()`。React 开发模式可能重复执行 effect，必须清理前一个实例；不要每次 render 都创建播放器。

SDK 自行创建包装容器和 iframe，不清空宿主已有内容。宿主容器应有可用宽度；包装容器按画面比例响应式缩放并额外预留 56px 控制栏，避免用固定高度裁掉底部操作区。

多个容器可分别创建实例，命令和状态相互独立；每个实例都有自己的 WASM、音频和视频，内存/GPU 开销不会因为引擎下载缓存而共享。不再需要的预览应及时销毁。

可通过本地 npm 包方式安装本目录，但包目前标记为 `private`、未发布 npm。打包工具只解决 SDK 引入；`renderer/` 仍必须静态部署，并配置它的公开 URL。

## 初始化选项与分辨率

```js
const preview = createPreview(container, {
  rendererUrl: "/miacode/renderer/index.html",
  resolution: { width: 1080, height: 1080 },
  timeoutMs: 120000,
});
```

| 选项          | 默认值                            | 含义                                                     |
| ------------- | --------------------------------- | -------------------------------------------------------- |
| `rendererUrl` | SDK 旁的 `../renderer/index.html` | HTTP(S) 播放器入口；相对值按宿主 `document.baseURI` 解析 |
| `resolution`  | `{ width: 1920, height: 1080 }`   | 实际渲染尺寸，不是容器 CSS 尺寸                          |
| `timeoutMs`   | `120000`                          | 启动及单次命令超时，必须是有限正数，单位毫秒             |

分辨率只能是正整数，单边不超过 4096，且精确满足横向 16:9 或 1:1。例如 1280×720、1920×1080、2560×1440、720×720、1080×1080 有效；1920×1200、1080×1920、零值及小数无效。非法配置在创建 iframe 前拒绝，原生入口也会校验。

| 比例 | 时间戳 | 左上谱面信息 | 物量统计 | Combo / 右上 FPS |
| ---- | ------ | ------------ | -------- | ---------------- |
| 16:9 | 显示   | 显示         | 显示     | 显示             |
| 1:1  | 显示   | 隐藏         | 隐藏     | 显示             |

尺寸不包含底部 56px 控制栏。HiDPI/浏览器缩放不会把 framebuffer 再乘以设备像素比；改变容器宽度只缩放呈现，不改变渲染分辨率。接口没有运行中的 `setResolution()`，需要 `destroy()` 后以新尺寸创建并重新加载，回到默认暂停状态。

## 谱面与资源输入

`load({ maidata, audio?, cover?, video?, difficulty? })` 中仅 `maidata` 必填；不传音乐仍可预览谱面，不传背景则使用默认背景。接口不读取谱面文件里的素材路径来自动请求其他文件，宿主必须显式提供资源。

| 输入项                      | 字符串                 | `File` / `Blob` | URL 对象                                    |
| --------------------------- | ---------------------- | --------------- | ------------------------------------------- |
| `maidata`                   | 谱面原文，**不是 URL** | 支持            | `{ url: "/maidata.txt" }`                   |
| `audio` / `cover` / `video` | HTTP(S) URL            | 支持            | `{ url, contentType?, byteSize?, sha256? }` |

相对 URL 按宿主 `document.baseURI` 解析，而非播放器目录。URL 不允许内嵌用户名/密码；不接受 `file:` / `data:` / `blob:` URL 字符串，已有本地数据请直接传 Blob/File。谱面字节支持 UTF-8 和旧 GB18030 解码。

### 原文或本地文件

```js
await preview.load({
  maidata: "&title=Example\n&artist=Example\n&first=0\n&inote_5=(120)1,2,3,4,E",
  difficulty: 5,
});

// maidataFile / musicFile 为宿主文件选择器得到的 File 对象。
await preview.load({ maidata: maidataFile, audio: musicFile });
```

`difficulty` 为 1–7 的整数，省略或 `null` 默认选择实际存在的最高难度编号。`load()` 指定一个不存在的有效编号时，原生加载回退到最高难度；返回的 `difficultyId` 才是实际选中的编号。`selectDifficulty()` 则要求该编号确实存在，否则拒绝。

### 字节完整性校验

```js
await preview.load({
  maidata: {
    url: "/charts/example/maidata.txt",
    byteSize: manifest.maidata.byteSize,
    sha256: manifest.maidata.sha256,
    contentType: "text/plain",
  },
  audio: {
    url: manifest.audio.url,
    byteSize: manifest.audio.byteSize,
    sha256: manifest.audio.sha256,
  },
});
```

这里的 `manifest` 由宿主准备，不是 SDK 提供的后台接口。`byteSize` 和 `sha256` 必须同时给出：大小为正的安全整数，哈希为 64 位小写十六进制。值不合法会在 SDK 侧拒绝；下载后大小或哈希不符会报错。`contentType` 可用于补充服务器缺失的 MIME，不能让浏览器获得不支持的编解码能力。

网络素材读取不发送 Cookie，也没有自定义请求头接口。私有资源应由宿主先鉴权并提供有效的短期签名 URL，或宿主自行获取后传 Blob；不要把登录凭据写进 URL。SDK 不实现原网站的授权清单续期或登录权限检查。

## 控制接口

```js
await preview.ready; // 初始化完成；resolve 为当前实例
const info = await preview.load(chartInput);
await preview.play();
await preview.pause();
await preview.seek(12.5); // 单位：秒
await preview.restart();
await preview.selectDifficulty(6);
const settings = await preview.setSettings({ tapFlowSpeed: 8 });
const state = await preview.getState();
preview.destroy();
```

| 接口                   | 返回值                              | 行为                                                   |
| ---------------------- | ----------------------------------- | ------------------------------------------------------ |
| `ready`                | `Promise<MiaCodePreview>`           | 等待初始化；失败会 reject 并清理 iframe                |
| `load(input)`          | `Promise<ChartInfo>`                | 加载资源与谱面；完成后 0 秒暂停，保留当前设置          |
| `play()` / `pause()`   | `Promise<PreviewState>`             | 播放/暂停；必须先成功加载谱面                          |
| `seek(seconds)`        | `Promise<PreviewState>`             | 有限非负秒数；超出时长限制到末尾，保留播放状态         |
| `restart()`            | `Promise<PreviewState>`             | 回到 0 秒并播放，不是回到 0 秒暂停                     |
| `selectDifficulty(id)` | `Promise<ChartInfo>`                | 切换已有难度；0 秒暂停，保留设置和当前资源             |
| `setSettings(partial)` | `Promise<PreviewState["settings"]>` | 部分更新；保留时间和播放状态，返回原生归一化结果       |
| `getState()`           | `Promise<PreviewState>`             | 当前快照，可在加载前查询                               |
| `on(type, listener)`   | 取消订阅函数                        | 订阅事件，不返回 Promise                               |
| `destroy()`            | `void`                              | 移除 iframe、停止媒体并清理监听/未完成请求，可重复调用 |

同一实例的异步控制命令按调用顺序排队，调用前不 `await ready` 也会内部等待。`createPreview()` 的参数错误会同步抛出；命令错误通过 Promise reject，调用方应处理 `.catch()` 或使用 `try/catch`。失败命令不会永久阻塞后续命令。

超时只代表宿主停止等待，不保证底层操作已经取消。要终止下载/播放器应调用 `destroy()`；在正在加载时继续排队另一次 `load()`，不能当作取消前一次加载的接口。销毁后不能复用实例，重新调用 `createPreview()`。

### 返回数据

`ChartInfo` 包含 `title`、`artist`、`difficultyId`、`duration`（秒）、`noteCount` 和 `charts: [{ id, label }]`。难度编号来自 `maidata` 的 `inote_1` 到 `inote_7`，不是难度等级文字或数组下标。

`PreviewState` 包含：

```js
const exampleState = {
  loaded: true,
  playing: false,
  currentTime: 0, // 秒
  duration: 120, // 秒，以实际返回值为准
  difficultyId: 5, // 尚未加载时为 null
  settings: {
    previewMode: "native",
    outerBrightness: 0.5,
    innerBrightness: 0.2,
    tapFlowSpeed: 7.5,
    touchFlowSpeed: 8,
    earlierSlideOnTop: true,
    noteSkin: "DX",
    showJudgeEffects: true,
  },
  resolution: {
    width: 1920,
    height: 1080,
    showTimestamp: true,
    showChartInfoHud: true,
    showObjectStatsHud: true,
  },
};
```

这是结构示意，不是内置示例统计。`duration` 取谱面与已解码音乐时长的较大值。`getState()` 不是实时推送；自定义进度条可适量轮询，不要每帧跨 iframe 请求。FPS 仅显示在播放器内，目前没有 FPS 数值事件或状态字段。

## 设置、模式与固定模板

```js
await preview.setSettings({
  previewMode: "maimuri_dx_style",
  outerBrightness: 0.5,
  innerBrightness: 0.2,
  tapFlowSpeed: 7.5,
  touchFlowSpeed: 8,
  earlierSlideOnTop: true,
  noteSkin: "DX",
});
```

| 字段                | 默认值     | 接受值 / 含义                             |
| ------------------- | ---------- | ----------------------------------------- |
| `previewMode`       | `"native"` | 见下表                                    |
| `outerBrightness`   | `0.5`      | 外侧亮度，0–1；UI 中按百分比显示          |
| `innerBrightness`   | `0.2`      | 内侧亮度，0–1                             |
| `tapFlowSpeed`      | `7.5`      | 1–10，原生按 0.25 步进归一化              |
| `touchFlowSpeed`    | `8.0`      | 1–10，原生按 0.25 步进归一化              |
| `earlierSlideOnTop` | `true`     | 较早的 Slide 叠放在上；false 为较晚的在上 |
| `noteSkin`          | `"DX"`     | `"SD"` / `"DX"`，只切换 Note 素材         |

| 模式     | 值                   | 显示和消除逻辑                                                                                                      |
| -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 谱面确认 | `"native"`           | 原生谱面确认绘制，轨迹按普通时间进度消除                                                                            |
| 无理检测 | `"maimuri_dx_style"` | 原 MuriAnalyzer 分析驱动 Slide/Wifi 分区消除及其他 Note 的蹭粉/绿（Perfect/Good）效果；**不显示触发区域或手部轨迹** |
| 按区消去 | `"erase_by_area"`    | 原 Slide/Wifi 按区域分段消去，不启用无理分析报告                                                                    |

模式差异发生在划动和判定过程中，不是把整个画面换一种颜色。无理检测首次使用时按当前谱面/难度懒分析；同一份分析复用，加载不同谱面/难度后失效，不累计历史分析。关闭区域/手部视觉层不关闭分析判定和轨迹消除。

设置修改即时生效，不移动播放位置、不切换播放状态、不改音效时间线。切换难度和加载其他谱面保留设置；刷新页面或重新创建实例恢复默认。内置面板可恢复默认，SDK 则重新传入表中默认值。未知字段、超出范围或非法模式/皮肤会拒绝，不应把未知字段当成预留扩展。

以下模板参数固定，不开放设置接口：布局整图 95%、中心 Combo、判定线为线、DX 判定素材/效果、MiaCode 内置默认导出字体、无片头、关闭平滑亮度和 HUD 字体行距修正、不启用 `clock_count`。判定效果始终显示：`getState().settings.showJudgeEffects` 为 true，但 `setSettings({ showJudgeEffects: false })` 或传入这个字段均会拒绝。选择 SD 不改变固定的 DX 判定素材和线判定线。

目标帧率固定 60 fps，右上角 FPS 统计 Qt 实际 `frameSwapped`，不是目标值或 RAF 调用次数；静态暂停时可能显示 0。实时预览不编码视频或音频，因此没有视频导出、导出帧率、音频码率 192kbps 等编码接口；分辨率通过初始化参数传入。

## 事件与加载进度

```js
const unsubscribe = preview.on("paused", ({ elapsedMs }) => {
  console.log("暂停位置（毫秒）", elapsedMs);
});
preview.on("settingsChanged", (settings) => console.log(settings));
unsubscribe();
```

| 事件                           | 数据                                | 说明                                                             |
| ------------------------------ | ----------------------------------- | ---------------------------------------------------------------- |
| `ready`                        | `{ playerVersion, sourceRevision }` | 初始化身份；注册监听应在创建后立即进行，也可等待 `ready` Promise |
| `progress`                     | `{ stage, progress }`               | 谱面资源/解析/准备阶段，progress 为 0–1                          |
| `playing` / `paused` / `ended` | `{ elapsedMs }`                     | 单位毫秒；加载完成也会发 `paused`                                |
| `error`                        | `{ code, message, elapsedMs? }`     | 启动/运行错误；仍需处理方法的 Promise reject                     |
| `seeked`                       | `{ currentTime }`                   | SDK `seek()` 完成，单位秒                                        |
| `settingsChanged`              | 完整 settings                       | SDK `setSettings()` 成功后的原生结果                             |

播放/暂停包括内置控制栏操作。当前内置设置面板修改设置及内置进度条拖动并不发对应 SDK `settingsChanged` / `seeked`；需要同步宿主 UI 时调用 `getState()`。不要假设所有内置控件都与 SDK 方法事件完全相同。

加载阶段当前为：资源下载 1%、读取谱面 5%、解析谱面 15%、音乐/音效/背景准备 30%、背景 PV 准备 65%、视频首帧准备 85%、就绪 100%。无 PV 跳过两段视频阶段；缓存命中时阶段可能很快结束。

这些数值是**阶段标识，不是实际下载字节百分比**。播放器启动没有精确百分比或独立 progress 事件，宿主应在 `ready` 前显示不定进度，不能伪造启动百分比。独立 SDK 先并行获取输入资源，全部转为 File 后进入原生加载；URL PV 下载期间可能停留在「正在加载资源」1%，后面的 PV 阶段表示播放器内部准备，不保证单独反映 PV 网络下载速度。原网站外层进度条不是 SDK 的一部分，宿主按事件自行显示。

## 缓存与性能边界

模块包含当前浏览器适配优化：音频时钟驱动播放、60 fps 截止时间调度、新视频帧才上传 PV、固定尺寸时不重建视频 Canvas、HUD 节流以及当前谱面媒体/解析复用。这些策略不保证任意设备和谱面都满 60 fps。

- **引擎磁盘缓存**：使用浏览器 Cache Storage 的 `miacode-engine-v1`，按 WASM SHA-256/大小缓存，最多 64MiB / 2 项。重新进入页面仍读取构建身份和清单，但相同引擎可复用字节；仍需编译/初始化当前实例，不缓存活的 Qt 场景。
- **完整性**：JS/WASM 按同一构建身份加载并校验，缓存命中仍校验；损坏后重新获取。Cache Storage 禁用、空间不足或隐私模式不阻止加载。不要手动混搭不同版本 JS/WASM。
- **当前谱面内存复用**：`selectDifficulty()` 复用已获取的输入资源和已准备媒体；原生只保留当前文本/难度的解析缓存。新的 `load()` 会重新获取输入并清理当前媒体缓存，不承诺缓存所有历史谱面。
- **独立 SDK 与网站的差别**：通用接口没有网站版本作用域的 `cacheScope` / 授权清单参数，因此不启用网站的谱面素材跨刷新持久缓存。即使 URL 输入带 byteSize/sha256，它们用于校验，不等于启用 SDK 谱面磁盘缓存。资源服务器/浏览器的普通 HTTP 缓存仍可能起作用；需要更强素材缓存可由宿主管理并传 Blob。

Cache Storage 属于播放器来源，在跨域或受限浏览器环境可能被分区或限制。`destroy()` 释放实例，但不清除引擎磁盘缓存；清除浏览器站点数据会使后续加载重新下载。该 SDK 不写播放遥测、登录 Cookie 或设置持久化，但**会写引擎字节缓存**，不能把它理解为完全不使用浏览器存储。

带 PV 的预览还包括视频解码、像素读取和 WebGL 上传成本，画面分辨率与视频素材大小都会影响耗时。网络影响冷启动/资源读取，不足以解释已加载后稳定低帧率。4096 的上限只是尺寸校验，不代表推荐或性能保证；低性能设备可由接入代码选用 1280×720 / 720×720，并减少同时运行的实例。

## 跨域、静态服务与安全

正式部署使用 HTTPS，开发可用 localhost。创建实例需要安全上下文中的 `crypto.randomUUID`；单线程 WASM 不需要为本模块额外启用 SharedArrayBuffer 或跨源隔离。浏览器需支持 WebAssembly、WebGL 2、WebAudio、ES module、iframe 及所用音视频解码，正式移动端/浏览器支持范围尚未确定。

静态服务器应正确返回 `.mjs` / `.js` 为 JavaScript、`.wasm` 为 `application/wasm`、JSON/HTML/CSS 对应类型，并保留原文件字节。流式 WASM 编译不可用或 MIME 不适合时有字节编译回退，但这不能补救服务器返回 HTML 错误页。允许 JS/WASM 网络压缩可以减少冷启动传输，哈希校验针对解压后的实际字节。

跨域关系需要分别配置：

1. 宿主读取播放器的 `build-identity.json`：播放器静态服务器允许**宿主来源**的 CORS。
2. 播放器读取谱面/音乐/PV：素材服务器允许**播放器来源**的 CORS，而不只是宿主来源。
3. 跨域导入 SDK：SDK 静态服务器允许宿主来源的模块读取。
4. 允许嵌入：播放器的 `frame-ancestors` / `X-Frame-Options` 不应拒绝预期宿主；宿主 CSP 的 `frame-src`、`script-src`、`connect-src` 等需允许实际地址。严格 CSP 还需满足 iframe 内 WASM、动态脚本、样式和 Blob 媒体的使用需求。

模块不会绕过 CORS/CSP，也不要求生产站点把所有安全策略放宽到 `*`。示例开发服务器的宽松 CORS 仅供本机示例。资源请求不带 Cookie，因此无需为了该 SDK 配置跨域凭据读取。

iframe 使用 `sandbox="allow-scripts allow-same-origin"`，允许 autoplay/fullscreen。通信校验精确 Origin、iframe window、Session、协议、请求 ID 和构建身份，不使用 `postMessage("*")`。这些校验不替代宿主鉴权；公开可访问的签名 URL 或 Blob 仍由宿主决定如何授权。

更新时将整个 `renderer/` 作为一组发布，使用版本目录或原子切换避免正在部署时读取到半套文件。身份/清单每次重新读取，JS/WASM 带版本和校验；不要给身份/清单施加长时间不刷新的 CDN 缓存，也不要用旧清单配新 WASM。更新 iframe 中的播放器需要重新创建实例或刷新宿主页面。

## 重新编译与重新提取

### 在独立目录重编译原生代码

预编译 `renderer/` 已可直接使用；只有修改原生逻辑/素材时才需要重编译。当前构建环境是 Linux，所需工具：Node.js 22+、CMake 3.24+、Ninja、Qt 6.8.3 的 `wasm_singlethread` 及同版本 `gcc_64` 主机工具、已激活的 Emscripten 3.1.56。Qt 组件包含 Core/Gui/Quick/Svg/ShaderTools。

```sh
MIACODE_QT_ROOT=/path/to/Qt/6.8.3 \
MIACODE_EMSDK_ROOT=/path/to/emsdk \
MIACODE_BUILD_JOBS=1 \
npm run build:native
npm run check
```

`MIACODE_QT_ROOT` 下应有 `wasm_singlethread/` 和 `gcc_64/`；`MIACODE_EMSDK_ROOT` 下有 `upstream/emscripten/emcc`。脚本检查 Emscripten 版本，再以 Release 构建；默认构建目录为 `native/build-release/`，可用 `MIACODE_BUILD_DIR` 指向专用目录，不能复用另一项目的 CMake 构建目录。并行数默认 6，内存有限时设为 1，首次完整构建仍可能占用较多内存。

构建自动替换成对的 JS/WASM/Qt loader，生成新的独立模块身份和产物哈希。修改 `renderer/` 脚本后也需要更新身份/清单，不能只改文件却留下旧哈希。保留 `native/upstream/` 的原始字节和资源清单；当前 PV 源矩形修正及 Slide 表复用由 CMake 在构建目录生成适配副本，不修改上游存档。

### 从网站仓库重新提取

在包含本提取脚本的网站仓库根目录运行，而不是在独立模块目录运行：

```sh
node integrations/miacode-webgl/sdk/export.mjs /path/to/MiaCodeWebPreview
```

脚本先校验网站现有产物清单，再复制最新引擎、适配脚本、独立 SDK、原生源码及本文档，生成独立消息桥、构建身份和哈希。如果原生逻辑或网站播放器脚本有改动，先按网站集成说明重建/更新网站产物，不能拿过期 WASM 提取。

已有目标必须带 `.miacode-sdk-export.json` 标记，否则拒绝覆盖。重新提取会覆盖它管理的 README、源码和产物；独立项目里的手工改动请先备份/纳入版本管理，并先同步回提取模板，避免下次丢失。脚本不清空整个目标目录，也不复制网站凭据、环境文件、数据库、`node_modules` 或 `.git`；未知旧文件不会自动删除，不要据此认为它们适合公开。

## 轻量检查与排错

```sh
npm test          # 接口/消息边界测试，不启动浏览器或真实播放器
npm run check    # 产物哈希、上游存档和独立桥检查
```

有 TypeScript 编译器时还可执行 `tsc --project tsconfig.json` 检查随附类型用例。此命令不是运行时必需，也不要求给预览 SDK 增加依赖。

| 现象                        | 优先检查                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------- |
| 启动超时或无法创建          | HTTPS/localhost、安全上下文、rendererUrl、iframe 是否被 CSP 拦截                    |
| 模块脚本加载失败            | `.mjs` MIME、静态路径、跨域模块 CORS                                                |
| 构建身份不一致 / 初始化越界 | 完整成对发布 JS/WASM，身份/清单是否被旧 CDN 或 Service Worker 缓存；不要只替换 WASM |
| 素材加载失败                | URL 是否过期、播放器来源的 CORS、Cookie 资源是否应改成签名 URL / Blob               |
| 大小/哈希不符               | 传入元数据是否对应当前素材原始字节，服务器是否返回了错误页                          |
| 音乐或 PV 无法解码          | 浏览器编解码支持、实际 MIME/文件内容；可暂时去掉 PV 用图片定位问题                  |
| 加载卡在某一百分比          | 百分比是阶段，不是下载进度；SDK 首阶段包含 URL 素材下载                             |
| 加载成功但没有播放          | 默认暂停；点击内置播放解锁音频，不要假定 load 会自动播放                            |
| 无理模式没有手部圆圈        | 当前预设刻意隐藏区域/手部，仅保留分析判定及 Slide 消除                              |
| 长时间低 FPS                | 看实际渲染负载/分辨率/PV 解码/实例数量，不把目标 60 或网速当成实测帧率              |

项目还带有可选的 `npm run test:browser` 脚本，需要外部 Playwright/Chromium，可用 `MIACODE_PLAYWRIGHT_MODULE` / `MIACODE_CHROMIUM` 指定。它会实际启动浏览器、多个播放器、谱面和 PV，内存开销明显高于以上检查，**不是安装或接入必需步骤**。不要在内存受限环境中默认运行；这次提取只做轻量检查，浏览器画面和实际性能由接入者验收。

当前是本地独立提取版，未发布 npm/GitHub，未开展新的许可证审核；保留 `renderer/LICENSE`、`LICENSE_SCOPE.md`、`THIRD_PARTY_NOTICES.md` 及上游许可文件。提取完成不代表已经完成公开发布前的许可审核。

# 组件与 dev 分离：功能与优化变更说明

2026-10-11 更新：生成播放器与压缩文件已退出 Git，改由 [CI 构建和分发](ci-artifacts.md)。下文的预编译提交记录属于历史版本。

本文记录组件重构分支最初的变更；与 dev-preview 整合后，上游已改为固定 MiaCode 子模块，工具链为 Qt 6.11.1 / Emscripten 4.0.7。当前构建与入口见 [README](../README.md)。

## 对比范围

- 日期：2026-10-10。
- 分支：`feat/component-dev-refactor`。
- 上一版基准：`8539dab658e3d764f7c9b6000d53272d4d2afe2c`（`feat: 新增最大帧率调节接口`）。
- 本文记录相对该提交的全部工作区变更，包括原有文件修改、新模块、测试及预编译产物，不仅记录最后一次 PV 超时配置修改。
- 创建分支前已执行 `git fetch origin`：远端 `main` 仍为上述基准；远端 `feat/dev-preview` 为 `eb003f7`，含独立的 dev/构建改动。本分支基于 main，不包含该分支的五个后续提交。

本文中的“新增”“优化”均相对上述基准。Simai 原生解析器、Qt Quick Note 场景、WebAudio 播放时钟、最大帧率接口、分辨率校验、当前谱面解析缓存和 HUD 节流已存在于基准，不作为本次新增功能。没有进行固定设备上的前后性能基准测量，因此不声明具体提速百分比。

## 1. 核心组件与开发网站分离

上一版 `renderer/player.mjs` 同时承担引擎、媒体、播放、UI 和本地文件选择；SDK bridge 内又实现了一套加载、设置、播放命令。当前将这些职责拆开：

```text
宿主网站 → sdk/index.mjs → sdk-bridge.mjs ─┐
                                        ├→ player-controller.mjs → player-engine.mjs
组件内置控件 → player-controls.mjs ────────┘
```

- `player.mjs` 只组装引擎、控制器、组件控件和 bridge。
- `player-engine.mjs` 管理 WASM 初始化、资源准备、播放时钟、视频和诊断。
- `player-controller.mjs` 统一命令校验、执行顺序和事件；SDK 与组件按钮使用同一套行为。无效参数不会破坏已加载谱面，也不会使后续命令队列失效。
- `sdk-bridge.mjs` 只处理可信消息、初始化握手、响应与事件转发，不再提前将所有 URL 下载转换为 File。
- 移除组件内的本地文件选择入口；文件夹选择属于 dev 宿主。公开 SDK 仍接受原文、URL、Blob/File。
- SDK 的协议、分辨率、帧率模块重导出 renderer 中的规范实现，消除两份校验逻辑。部署仍需同时提供 `sdk/` 和 `renderer/`。
- `npm run check` 增加 renderer 不依赖 dev 模块或上传接口的边界检查。

正式接入的产品是 SDK、renderer 和播放器后台日志接口；dev 页面、上传服务器不参与核心组件运行。

## 2. dev 模拟普通网站的加载行为

上一版示例直接把本地 File/Blob 交给播放器，不能覆盖服务器下载、CORS、缓存和弱网加载过程。现在流程为：

1. 选择包含 `maidata.txt` 的文件夹，宿主选取谱面、首个音乐、封面和 PV。
2. `POST /__dev-charts` 创建资源地址，再通过 `PUT` 上传各资源。
3. 全部上传完成后，宿主自动调用公开 SDK，以 HTTP URL 加载。
4. 播放器重新下载资源；播放、暂停、跳转、难度和预览设置使用组件内置控件。

顶部仅保留创建实例时的分辨率、最大帧率、播放器 URL、SDK 超时、PV 超时和后台日志开关，以及文件夹上传。修改创建配置会重建实例，并使用已有 URL 自动重新加载，不重复上传；再次上传文件夹复用当前实例。

开发后台将上传流式写入系统临时目录，每个上传会话隔离，只有完整上传后才允许读取。上传接受同源请求，单文件上限 2 GiB；服务器关闭时清理临时素材。dev 状态提示区报告创建、上传、下载或错误状态，不另设播放器业务逻辑。可在上传完成后启用浏览器 Network 限速并禁用缓存，再修改创建配置测试下载过程。

## 3. 日志统一走播放器后台

新增诊断采集、日志传输及后台格式化模块，通路为：

```text
renderer 采集 → 播放器同源的 /__performance → 后台终端 / 可选 JSONL
                                            ↓ 后台返回相同文本
                                 SDK performance 事件 → dev 面板显示
```

- 默认 `diagnostics: true`，后台终端输出开启，文件输出关闭。浏览器控制台不打印初始化或性能日志。
- `initialization` 记录引擎下载/校验/编译、Qt 初始化、谱面解析、音乐下载解码、封面、PV 数据获取及首帧、音效下载解码、加载总耗时和错误。
- 资源时间线显示每次加载编号、开始/结束偏移、耗时、字节数和完成/失败/取消/超时状态，并标明本批最晚结束的资源步骤。并行步骤不能相加。
- `performance` 仅在已加载且正在播放时每秒输出，记录实际呈现 FPS、帧工作、WASM 更新、长任务、音效调度及视频重同步等。暂停、未加载、加载中和结束后不输出；恢复播放重新开始采样，丢弃暂停前的未完整统计窗口。
- 报告使用 `logKind` 区分两类日志；为兼容接口，事件仍名为 `performance`。事件里的 `backendLog` 携带后台返回的文本和输出状态。
- dev 只显示后台返回的原文，不自行采集或格式化，保留当前实例最近 120 段；重建实例时清空。组件诊断历史最多保留 600 条。
- 新增 `getDiagnostics()`、`resetDiagnostics()`、`setDiagnostics(boolean)`，以及创建选项 `diagnostics`。
- 日志传输按顺序提交，队列有上限，单次请求有超时，后台不可用时退避，发送不阻塞播放。后台拒绝跨源、格式错误和过大的请求，客户端不能指定文件路径或修改输出开关。

`MIAVIEW_LOG_FILE=1` 开启 `.logs/performance-*.jsonl`，`MIAVIEW_LOG_TERMINAL=0` 关闭终端输出。日志文件不作为静态资源开放；跨域宿主嵌入时，日志仍发往播放器服务器。生产部署需提供该后台接口或代理到日志服务。

## 4. 加载与缓存优化

- 上一版 bridge 等全部 URL 下载结束后才交给引擎；现在将资源描述直接交给引擎，使谱面解析、音乐下载解码、封面和 PV 准备并行推进。
- WASM 网络传输期间开始 `compileStreaming`，另一路核对完整文件长度及 SHA-256。编译和校验均通过后才运行引擎；校验错误不执行 glue。
- 已校验 WASM 和资源的缓存写入转为尽力完成的异步操作，不阻塞初始化/资源读取返回。缓存写失败不使有效资源加载失败。
- 保留当前谱面的媒体复用；同素材切换难度可复用音乐解码和 PV 数据。视频重新挂载的首帧准备仍受超时预算约束。
- 错误提示明确指出谱面、音乐、封面或 PV 的失败，并提供网络/CORS 排查信息；取消、超时保留自身语义。

## 5. PV 渲染管线与超时配置

### 浏览器合成视频

上一版每个视频帧经过 `drawImage → getImageData → WASM 内存复制 → QImage → Qt 纹理`。现在直接由浏览器 `<video>` 合成，Qt 画布透明并叠在视频之上，Qt 继续绘制 Note、亮度遮罩和 HUD。

- C++ 导出从 `miacode_video_frame` 改为 `miacode_external_video`。
- 删除 JavaScript 视频像素读取、上传缓冲分配和 `PreviewVideoFrames` 管理逻辑。
- Qt 开启 alpha 缓冲，窗口背景透明；视频通过 CSS 覆盖舞台。
- 音乐仍为播放时钟，视频偏离超过 250ms 时校正。诊断标记 `videoPipeline: "browser-compositor"`，记录视频解码/丢帧和重同步。

该改动减少每帧 CPU 像素搬运和 WASM/GPU 上传工作，但实际收益依赖浏览器、设备和素材，没有承诺固定 FPS 增幅。

### 可配置加载预算

所有 URL PV 都完整获取后才准备首帧，不在播放期间依赖网络流式缓冲；提供完整性信息时仍先校验。新增创建选项：

```js
const preview = createPreview(container, {
  pvTimeoutMs: 30000, // 默认；整数毫秒 >= 10000
  // pvTimeoutMs: "unlimited", // 不限时
});
```

- 下载、校验和首帧准备共享一个预算，默认 30 秒，支持 10 秒起到任意安全整数毫秒，或 `"unlimited"`。
- 有限超时只中止 PV 分支，记录日志并使用封面/无视频继续加载，不取消谱面、音乐或封面。
- 当前实例记住已超时的同一 PV，切换难度或再次加载不重试；新建实例可以重试。
- 不限时仍能被加载取消或实例销毁中止。超出浏览器单次定时器上限的有限值分段计时，避免溢出。
- SDK 加载和切换难度的等待预算为 `pvTimeoutMs + timeoutMs`；PV 不限时则这两个命令也不限时，销毁仍拒绝待完成命令。SDK 初始化和普通命令继续使用 `timeoutMs`。
- iframe 参数支持 `pvTimeoutMs`；状态和报告包含该配置。dev 用秒输入，`unlimited` 表示不限，修改会重建实例。

## 6. 静态服务与产物同步

- dev 静态服务支持协商 `.br` / `.gz`，返回原始 MIME、`Content-Encoding` 和 `Vary`。
- 有当前构建版本的 renderer 请求可使用长期 immutable 缓存，构建身份和清单保持不长期缓存；普通资源支持 ETag，媒体支持 Range/HEAD。
- `native/artifacts.mjs` 统一生成构建身份、产物长度与 SHA-256 清单、引擎压缩文件以及许可证副本，原生构建复用该逻辑。
- 新增 `npm run sync:artifacts`：JS/CSS/HTML 修改后无需重新编译 C++，即可同步清单和构建身份。原生代码修改仍需 `npm run build:native`。
- renderer 源文件自动纳入身份计算，拆分出的新模块不会漏记。此次同步提交新的 JS/WASM、身份、清单及压缩文件，部署应整体替换 renderer。
- npm 发布文件范围增加可复用 `backend/`；`.gitignore` 增加 `.logs/` 与本地 `charts/`。

## 7. 全部 Git 变更文件与用途

M 表示修改基准文件，A 表示新增。以下覆盖本分支相对基准的变更路径，生成的二进制和压缩产物也列入。

| 状态 | 文件 | 对应功能或优化 |
| --- | --- | --- |
| M | `.gitignore` | 忽略运行日志和本地谱面目录 |
| M | `README.md` | 更新 dev、后台日志、PV 配置、加载优化、部署和目录说明，链接本文 |
| A | `docs/changes-component-dev-refactor.md` | 本次与上一版的完整变更说明 |
| M | `package.json` | 发布 backend，增加产物同步命令 |
| M | `examples/index.html` | 简化测试宿主页面，创建配置、上传和日志展示 |
| M | `examples/demo.mjs` | 兼容示例入口，委托 dev/app |
| A | `dev/app.mjs` | 网站上传、重建及自动 URL 加载流程 |
| A | `dev/preview-host.mjs` | 仅通过公开 SDK 创建、加载和销毁实例 |
| A | `dev/resources.mjs` | 文件夹资源选择及 HTTP 上传 |
| A | `dev/chart-upload.mjs` | 临时文件流式上传、同源校验、完整上传后开放读取与清理 |
| A | `dev/log-panel.mjs` | 原样显示后台日志，限制显示数量 |
| A | `dev/page.css` | dev 配置区、组件容器和日志面板布局 |
| A | `dev/server.mjs` | 组合上传、日志与静态服务，增加压缩、缓存和 Range |
| A | `backend/log.mjs` | 日志接收、格式化、终端及可选 JSONL 输出 |
| M | `scripts/serve.mjs` | 保留启动及 staticServer 导出，配置默认日志输出和退出清理 |
| A | `scripts/dev-chart-upload.mjs` | 上传模块的兼容重导出 |
| A | `scripts/performance-log.mjs` | 后台日志模块的兼容重导出 |
| M | `scripts/verify.mjs` | 保留产物校验，增加组件/dev 边界检查 |
| M | `native/browser-host.cpp` | 外部视频模式、透明 Qt 窗口，移除逐帧像素接收 |
| M | `native/build.mjs` | 原生构建后使用统一产物同步逻辑 |
| A | `native/artifacts.mjs` | 身份、清单、压缩产物和许可证同步 |
| M | `renderer/index.html` | 加入舞台视频元素，移除本地文件选择 UI |
| M | `renderer/player.css` | 视频层样式，清理本地上传样式 |
| M | `renderer/player.mjs` | 缩为组件组装入口 |
| A | `renderer/player-engine.mjs` | 提取引擎，接入并行资源、视频合成、诊断和 PV 超时 |
| A | `renderer/player-controller.mjs` | SDK/控件共享命令、校验、队列和事件 |
| A | `renderer/player-controls.mjs` | 内置播放器控件接入共享控制器 |
| M | `renderer/sdk-bridge.mjs` | 仅承担握手和消息通信，移除重复业务及下载逻辑 |
| M | `renderer/runtime.mjs` | 流式编译与校验并行、非阻塞写缓存、PV 预算与音效调度统计 |
| M | `renderer/protocol.mjs` | 增加诊断命令及 performance 事件 |
| A | `renderer/diagnostics.mjs` | 初始化/播放采集、资源时间线、有界采样和历史 |
| A | `renderer/performance-transport.mjs` | 后台单一日志通路、队列和失败退避 |
| A | `renderer/pv-timeout.mjs` | PV 参数规范、URL 解析及长时间定时器 |
| M | `sdk/index.mjs` | 诊断接口、PV 创建配置、iframe 参数与加载等待预算 |
| M | `sdk/index.d.mts` | 配置、状态、诊断报告、事件及方法类型 |
| M | `sdk/protocol.mjs`、`sdk/resolution.mjs`、`sdk/frame-rate.mjs` | 重导出 renderer 规范，删除重复实现 |
| M | `renderer/miacode-preview.js`、`renderer/miacode-preview.wasm` | 对应外部视频原生适配的预编译播放器 |
| M | `renderer/build-identity.json`、`renderer/artifact-manifest.json` | 更新构建身份和完整产物清单 |
| A | `renderer/miacode-preview.js.br`、`renderer/miacode-preview.js.gz` | JS 预压缩文件 |
| A | `renderer/miacode-preview.wasm.br`、`renderer/miacode-preview.wasm.gz` | WASM 预压缩文件 |
| M | `tests/browser-smoke.mjs` | 扩展真实浏览器加载、视频、日志、dev 上传和重建配置验证 |
| M | `tests/frame-rate.spec.mjs` | 移除已删除视频上传辅助类的测试引用，保留帧率验证 |
| M | `tests/sdk.spec.mjs` | 诊断和 PV 配置校验、不限时等待及销毁验证 |
| M | `tests/types.ts` | 新增公开诊断与 PV 配置类型用例 |
| A | `tests/player-controller.spec.mjs` | 共用命令事件、可信边界、资源校验与错误恢复 |
| A | `tests/loading.spec.mjs` | 并行加载、完整 PV 获取、默认超时、校验与流式编译 |
| A | `tests/pv-timeout.spec.mjs` | 最小值、不限时、共享预算、取消与长定时器 |
| A | `tests/diagnostics.spec.mjs` | 有界采样、长任务、错误、资源时间线及仅播放输出 |
| A | `tests/performance-transport.spec.mjs` | 日志顺序、后台原文与失败退避 |
| A | `tests/performance-log.spec.mjs` | 默认输出、JSONL、拒绝非法请求及初始化文本 |
| A | `tests/dev-chart-upload.spec.mjs` | 上传隔离、HTTP 资源、完整性及清理 |
| A | `tests/static-server.spec.mjs` | 压缩协商、构建缓存及媒体范围请求 |
| A | `tests/fixtures/bg-stream.mp4` | 浏览器 PV 加载和弱网场景测试素材 |

## 8. 验证结果及接入影响

- `npm test`：44 项全部通过。
- `npm run check`：产物哈希、上游源文件清单和组件/dev 边界通过。
- `npm run test:browser`：使用 Playwright + Chromium 验证通过，包含多实例、URL 下载、PV 超时及取消、视频合成、播放/暂停日志、上传和创建配置重建；PV 的 10 秒与不限时配置均被验证。
- `tests/types.ts` 已更新，本次未单独运行 TypeScript 编译器，不将类型用例记作已执行验证。

公开播放与资源加载接口保留；新增配置均有默认值。最大帧率和原有预览设置继续可用。组件 HTML 不再提供本地文件上传，测试上传应使用 dev 宿主。生产部署需同时更新 SDK 与完整 renderer，并提供播放器后台日志接口；也可通过 `diagnostics: false` 关闭报告。不限时 PV 会持续等待，宿主可销毁实例取消。预编译原生接口已变更，不可混用上一版 WASM。

复核差异可运行：

```sh
git diff --stat 8539dab..feat/component-dev-refactor
git diff --name-status 8539dab..feat/component-dev-refactor
git diff 8539dab..feat/component-dev-refactor -- sdk renderer dev backend native scripts tests
```

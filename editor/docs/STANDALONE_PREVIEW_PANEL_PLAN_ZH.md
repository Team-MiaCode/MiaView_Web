# 独立预览产品拆分计划

日期：2026-11-11。基线：`feature/web-editor-migration` 的 `e13e643`。工作分支：`standalone-preview`。

交付目标：以用户截图中的预览面板为主体，提供独立预览页面，支持打开谱面与媒体。红框位置使用音频设置按钮。音频设置与预览设置采用半透明覆盖面板，覆盖范围限定在进度条上方的预览画面区域。

## 仓库依据

本计划依据当前源码、Git 状态及以下仓库资料：

- `docs/WEB_EDITOR_MIGRATION_PLAN_ZH.md` Stage4：公共源码统一维护，子项目包含运行与构建依赖，使用生成脚本同步，公共字段、文件名、SDK 与资源身份保持一致。
- `products/preview/index.html`、`app.mjs`、`page.css`：独立预览入口的权威源码。当前入口包含文件夹选择、集合切换、难度选择和 SDK 播放器。
- `scripts/sync-products.mjs`：从公共源码与 `products/preview/` 生成 `preview/`；`scripts/build-pages.mjs` 打包时调用同步流程。
- `ui/workbench/workbench.mjs`：截图对应的标题、画布、`PreviewTransport` 和 `NoteStatistics` 装配位置。
- `ui/workbench/preview-settings.mjs`、`audio-settings.mjs`：预览与音频设置的现有实现。
- `sdk/index.mjs`、`sdk/index.d.mts`：播放器创建、加载、播放、设置、统计事件及音频命令接口。

## 产品布局与功能

主体顺序沿用截图：标题栏 → 预览画面 → 进度条 → 播放控制 → 音符统计。

| 区域 | 交付内容 |
| --- | --- |
| 文件入口 | 页面顶部提供打开谱面文件夹、集合中的谱面选择、难度选择和加载状态；补充谱面文件、音乐、背景图与 PV 的选择入口 |
| 标题栏 | 左侧“预览”，右侧预览设置按钮；按钮打开画面区域内的半透明预览设置面板 |
| 预览画面 | 默认方形画布，显示背景/PV、音符、判定效果和时间戳；自由画布使用现有尺寸与坐标规则 |
| 进度条 | 显示播放位置，拖动进入暂停态并跳转；沿用时间范围与负起点语义 |
| 播放控制 | 停止、播放/暂停、当前时间/总时长、倍率、画布菜单、音频设置；停止行为与工作台保持一致 |
| 画布菜单 | 保留自由画布和隐藏 PV 的现有入口 |
| 音频设置 | 红框位置采用现有 `audio-settings` 图标与“音频设置”提示，打开画面区域内的半透明混音设置面板 |
| 音符统计 | 保留 Tap、Hold、Slide、Touch、Break、合计，消费运行时的当前数量/总量及 SD/DX 图标 |

面板宽度根据可用高度按参考图的 741∶865 比例计算。面板在空间充足时水平居中，窗口较窄时可横向滚动。面板宽度充足时显示六列统计，较窄的面板沿用三列两行布局。

### 设置覆盖面板

- 现有工作台的音频设置与预览设置由编辑标签页承载；独立产品使用画面容器内的覆盖层承载这两种设置。
- 半透明背景覆盖整个预览画面容器，四边贴合画面边界。进度条、播放控制和音符统计保持可见及可操作。
- 面板背景使用主题对应的半透明色，背景画面透过面板可见；文字、图标与表单控件保持清晰。透明度作用于面板背景。
- 两种设置共用一个覆盖容器，同一时刻显示一种内容；点击对应按钮打开或收起面板，点击另一设置按钮切换内容。
- 设置内容在覆盖层内部滚动，面板提供标题与关闭按钮；Escape 关闭，关闭后焦点返回触发按钮。键盘焦点可在设置与播放控制之间移动。
- 覆盖层承接其范围内的指针输入；开启、关闭和切换设置保持画布几何及播放状态，设置结果通过现有接口应用到当前预览。

基础能力包括文件夹自动识别、集合切换、难度切换、音乐与判定音效、背景/PV、播放/暂停/停止/重播/跳转、倍率、现有区间播放接口、预览设置、主题与帧率配置、加载状态及资源释放。区间参数沿用 `rangePlaybackEnabled`、`exportStartSeconds`、`exportEndSeconds`；独立页面的区间设置放入播放设置区域。

## 组件与状态拆分

1. 从工作台装配位置提取公共预览面板，建议位置为 `ui/workbench/preview-panel.mjs`。复用 `PreviewTransport`、`NoteStatistics` 和公共控件，由宿主传入命令、菜单及设置打开回调。
2. `PreviewTransport` 的末尾操作由宿主配置：独立产品提供音频设置操作；工作台提供其现有窗口操作。各宿主配置使用现有命令标识。
3. 将预览面板、统计、设置表单所需 CSS 提取为公共样式，主工作台和独立页面共同引用。布局尺寸由各宿主定义。
4. 独立入口通过 `createPreview(container, { layout: "fit", controls: false, resolution: { width: 1080, height: 1080 } })` 创建运行时，宿主组件承担完整控制区。
5. 独立宿主负责文件、设置和 UI 状态；播放时间、音符统计、有效音频增益由 SDK/运行时提供。订阅 `timeupdate`、`playbackChanged`、`settingsChanged`，通过 `statistics`、`statisticsAvailable` 更新统计。
6. 提取并复用预览相关偏好读取、保存与应用逻辑，沿用 `previewPlaybackRate`、`previewCanvasFreeAspect`、`previewHidePv`、`audioSettings`、`audioSoftwareDefault` 等字段。预览设置中的皮肤、判定线与字体导入复用对应资源服务。
7. 预览及音频设置组件通过宿主回调处理关闭。独立页面在预览画面容器内装配半透明设置覆盖层，工作台使用现有页面容器。复用 `preview-settings`、`audio-settings` 标识管理覆盖内容，业务设置命令保持原标识。
8. 页面销毁统一注销 SDK 订阅、尺寸观察器、DOM 监听与媒体引用，调用 `NoteStatistics.destroy()` 和 `preview.destroy()`。

## 音频设置接入

复用 `createAudioSettings()` 与 `updateAudioSettings()`，保留全局、音乐、Answer、Tap、EX、Break、Break Slide、Slide、Touch、烟花、片头通道，以及尾部判定音开关。

| 操作 | 现有接口或字段 |
| --- | --- |
| 读取设置 | `audioCommand("audio.getSettings")` |
| 调整音量 | `audioCommand("audio.channelPercent", { key, percent })` |
| 静音切换 | `audioCommand("audio.channelMuted", { key, muted })` |
| 尾部判定音 | `audioCommand("audio.breakSlideTailCheerMuted", { value })` |
| 保存本地默认值 | 复用 `audio.saveAsSoftwareDefault` 与 `audioSoftwareDefault` |
| 恢复本地默认值 | 复用 `audio.restoreSoftwareDefault`，调用 `audio.restoreSettings` |

命令返回值驱动表单回显与偏好保存；音乐、音效和 PV 共用现有播放时钟与媒体生命周期。

## 文件加载与媒体处理

- 文件夹加载复用 `inspectChartFolder()`、`resolveChartMedia()` 及 `maidata.txt`、`track.*`、`bg.*`、PV 的现有命名规则。
- 单独谱面加载复用 `load({ maidata, difficulty })`；媒体选择复用 `setResources({ audio, cover, video })`，保留文档、难度和播放位置语义。
- 集合与难度切换消费对应 SDK 返回状态，按当前文档更新标题、难度列表、统计和控制状态。
- 加载沿用现有序列与文档版本约束；连续选择文件时，页面状态对应最终选中的谱面。
- 公开 SDK 沿用 `createPreview`、`load`、`setResources`、`setSettings`、`setPlayback`、`audioCommand`、`on`、`destroy` 及同名类型声明。

## 实施阶段

| 阶段 | 主要文件与工作 | 完成条件 |
| --- | --- | --- |
| P1 公共面板提取 | `ui/workbench/workbench.mjs`、`preview-transport.mjs`、公共面板模块和样式；设置关闭回调 | 工作台与独立宿主可装配同一组预览组件，末尾按钮由宿主配置 |
| P2 独立产品装配 | `products/preview/index.html`、`app.mjs`、`page.css`；文件与偏好服务；画面内的半透明设置覆盖层 | 截图结构、谱面与媒体加载、播放控制、统计及两种设置连通；覆盖层底边位于进度条上方 |
| P3 同步与交付 | `scripts/sync-products.mjs`、`products/preview/README.md`、`preview/`、打包清单与接入示例 | 生成目录与权威源码一致，独立目录中的资源和引用闭合，交付包具有源码与资源身份 |
| P4 验收 | 现有契约检查、产品闭合检查、Release 构建与打包；授权后的浏览器验收 | 功能逐项通过，布局符合截图和窄屏规则，预览画面与音频设置结果符合现有运行时行为 |

各阶段以可运行结果组织改动。实现从权威源码进入同步流程，`preview/` 承担生成后的独立产品交付。

## 验证与分支交付

- 基础检查使用 `npm run check:repo`、`npm test`；接口或类型变化执行 `npm run check:types`。
- 同步与静态闭合使用 `npm run sync:products`、`npm run check:products`；运行资源按 `check:source` 核对源码和构建身份。
- 打包使用 `npm run build:pages`；native 输入变化使用 `npm run build:native`，构建目录为各项目的 `build-devtools/`，配置为 Release。
- 功能验收覆盖加载、播放控制、难度与媒体切换、设置保存恢复、六类统计、尺寸变化和销毁。浏览器/UI 验收列为用户明确授权后的验收环节。
- 测试产生的临时文件在验证结束后清理；现有仓库测试入口用于回归。
- 每次 commit 或 push 前检查差异范围、潜在问题、格式及受影响构建和测试结果。提交标题沿用仓库的 `type(scope): 中文描述` 格式。
- 本项计划与实现使用 `standalone-preview`；合并目标为 `feature/web-editor-migration`。当前 CI 对 push/PR 执行检查与构建；Pages 发布条件指定 `main` 和 `feature/web-editor-migration`。新分支通过构建产物验收，合并后沿用 `/feature/preview/` 产品入口。

## 验收重点

1. 标题栏按钮与红框位置分别打开预览设置、音频设置，两种半透明覆盖层均铺满画面。进度条、播放控制和统计保持可见及可操作。
2. 画面、进度、倍率、时间文本及六类统计消费同一实例的状态。
3. 预览设置和媒体切换保持现有画布、时间与资源语义；音乐与判定音效按相同时间基准输出。
4. 桌面布局匹配截图的面板层级、控件顺序与统计排列。可用高度相同时，改变窗口宽度后面板宽度保持一致。
5. 独立产品复制至独立目录后，模块、媒体资源、类型、构建脚本和源码身份检查通过。
6. 两种设置支持切换、收起、内部滚动与 Escape 关闭；通道音量和静音操作作用于当前预览，关闭后焦点返回按钮，覆盖层开关保持画布几何及播放状态。

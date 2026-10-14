# feat/dev-preview 合入 feat/component-dev-refactor 的详细方案

2026-10-11 后续变更：用户停止推送，并要求清理大文件历史、改为 CI 构建。当前 PR 分支在 main 之上的历史重建为源码提交，生成产物退出 Git；本文件的 merge commit 和预编译提交策略保留为历史记录。当前流程见 [CI 构建](ci-artifacts.md)。

本方案基于实际分支差异和 Git merge-tree 模拟结果。第 1–10 节保留实施前方案，实施结果见第 11 节。

## 1. 范围、基线与目标

| 项目 | 已核实状态 |
| --- | --- |
| 目标分支 | origin/feat/component-dev-refactor，1f5fac69ed8062774b404e539a02c19afb294fa5 |
| 来源分支 | origin/feat/dev-preview，eb003f780e870a8526911f5d1e327d3fa2fd7d51 |
| 共同基点 | 8539dab658e3d764f7c9b6000d53272d4d2afe2c |
| 独有提交 | 目标 1 个，来源 5 个 |
| 合并模拟 | 16 个冲突文件；无法 fast-forward |

目标是保留目标分支的组件拆分、共用控制器、并行加载、浏览器视频合成、PV 超时和后台诊断，再引入来源分支的 MiaCode 子模块构建、主题/布局、静态示例和 CI 修复。

不改写已发布历史。不直接 cherry-pick 五个来源提交作为默认路径：前两个提交含大规模源码迁移与产物更新，逐个应用仍需处理同样的架构冲突。

## 2. 最终职责和目录

```text
sdk/                         公开嵌入接口、类型、创建配置
renderer/player.mjs          仅装配 engine、controller、controls、bridge
renderer/player-engine.mjs   WASM、媒体、时钟、加载和诊断
renderer/player-controller.mjs  SDK 与组件控件共用的命令入口
renderer/player-controls.mjs 控件、主题、全屏、设置面板
renderer/sdk-bridge.mjs      可信消息、握手、命令/事件转发
dev/                        HTTP 上传型开发宿主及开发服务器
backend/                    播放器后台日志
examples/index.html         保留目标分支的开发宿主入口
examples/demo.mjs            保留兼容入口，委托 dev/app.mjs
examples/pages.html         新增纯静态示例
examples/pages-demo.mjs      从来源示例迁移本地文件流程，只使用公开 SDK
native/                     Web 原生适配与统一产物同步
vendor/MiaCode               来源分支记录的核心源码子模块
```

保留现有 dev 路径可减少 browser-smoke 和开发入口改动。Pages 构建仅复制静态示例及其依赖，并在输出目录映射为 examples/index.html、examples/pages-demo.mjs，保持现有 Pages 对外 URL。输出页面应明确引用 pages-demo.mjs，不能引用 dev 的兼容 demo.mjs。

## 3. 16 个冲突文件的处理决定

| 文件 | 处理 |
| --- | --- |
| .gitignore | 合集：node_modules、构建目录、.deps、artifacts、aqtinstall.log、.logs、charts 等 |
| README.md | 重写为最终入口说明：嵌入、dev 上传、静态 Pages、构建和诊断 |
| examples/demo.mjs | 保留目标的 dev 委托入口；来源本地文件逻辑迁入 pages-demo.mjs |
| examples/index.html | 保留目标 dev 页面；来源示例迁入 pages.html |
| native/build.mjs | 用来源的子模块/工具链构建流程，构建尾部调用改造后的统一产物同步 |
| package.json | 合并版本、发布目录和 scripts，见第 8 节 |
| renderer/artifact-manifest.json | 最终生成，禁止逐项手工拼接 |
| renderer/build-identity.json | 最终生成；保留来源的子模块与工具链溯源字段 |
| renderer/index.html | 来源布局与主题控件 + 目标 stage-video；不恢复组件内上传入口 |
| renderer/miacode-preview.js | 与 WASM、qtloader 配套重新构建 |
| renderer/miacode-preview.wasm | 重新构建；两边现成二进制均不作为最终结果 |
| renderer/player.css | 来源主题/响应式布局 + 目标视频叠层样式 |
| renderer/player.mjs | 保留目标装配入口；来源业务按职责迁入 controls/engine |
| scripts/verify.mjs | 来源清单与 source 校验 + 目标组件/dev 边界校验 |
| sdk/index.d.mts | 同时保留 theme、diagnostics、pvTimeoutMs、诊断类型及方法 |
| sdk/index.mjs | 目标 SDK 为基础，加入来源 theme 校验/参数与 TRANSPORT_HEIGHT |

不能对全部冲突使用 ours/theirs。特别是 native/build.mjs 的尾部冲突，不能以目标的 writeArtifacts() 替换来源的 configure/build/copy 步骤，否则可能跳过实际构建。

## 4. 原生源码迁移和视频接口

接收来源的 .gitmodules、vendor/MiaCode、native/toolchain.json、CMakeLists.txt、browser-assets.qrc.in 和 Qt 安装脚本。保留 native/upstream、shims、旧 upstream-manifest、旧 upstream-sources 和旧静态 qrc 的删除。

来源记录的 MiaCode revision 为 fb6fcd9eee1e92f2668e4e883db4567eff91006e，Qt 6.11.1，Emscripten 4.0.7，wasm_singlethread。本次整合固定该 revision，不顺带把子模块更新到远端 dev 最新提交。

native/browser-host.cpp 模拟中自动合并成功，但需要人工核对这些契约：

- 来源的 SimaiParser、core/analysis、core/scene、AssetPaths include 和 setAssetRoot 保留。
- 目标的 miacode_external_video、alpha buffer、透明 QQuickWindow 保留。
- 不恢复 miacode_video_frame 和逐帧像素复制链。
- 重置视频、切换到无视频谱面和超时降级时，DOM 与原生 media 状态同步清理。
- 保留分辨率/帧率/设置/帧计数导出，HEAPU8 仍可用于封面上传和诊断。

已在来源子模块核对到 ExternalQuickMediaItem、externalMediaType 和相关背景层处理；仍需构建与画面验证其透明合成、封面回退和亮度遮罩行为。

不要复用 Qt 6.8.3 的 CMake 缓存。建议本次用 native/build-dev-refactor-release 新目录，或确认已有目录已配置为新工具链。使用 Release，构建并发最多 4。

## 5. 播放器和 SDK 的功能迁移

### 5.1 player.mjs

保留 createPlayerEngine → createPlayerController → attachPlayerControls → attachSdkBridge 的装配流程，不把来源的大文件业务重新放回入口。

### 5.2 player-controls.mjs

迁入来源的主题按钮、theme URL 参数初始化、fullscreen/error/fullscreenchange 处理、settings-open class、桌面侧栏和移动端滚动定位。播放/暂停/重播/跳转/设置继续调用 controller.execute，不新增直接操作音频或 WASM 的第二条路径。

难度选择保留在宿主 SDK 流程。本次不把来源的本地文件与难度选择 header 恢复到 renderer，避免为独立 renderer 再实现一套加载流程。

### 5.3 player-engine.mjs 与视图回调

迁入时间显示和谱面标题刷新点：加载成功、seek、pause、播放 tick、clear。建议复用现有 view.settings 回调风格，增加轻量 view.chart/view.transport 回调，由 controls 更新 DOM；不要为此引入新的状态存储或消息协议。

标题只在加载/清理时更新；时间显示只在格式化文字变化时写 DOM。使用引擎的音频 currentTime/duration，保持唯一播放时钟。

### 5.4 HTML、CSS 和高度

- 来源的 theme.css、player-layout、progress-row、control-row、time、chart-title、theme-toggle、fullscreen、transport-error 保留。
- 目标的 stage-video 位于 viewport 内，Qt 画布叠在视频之上；保留定位、层级、尺寸和 object-fit。
- SDK TRANSPORT_HEIGHT 与 theme.css 的 --transport-height 均为 80。不能只改 SDK 留下 56px 的组件布局。
- 覆盖 16:9 和 1:1、桌面侧栏、320px 移动端、设置开关和全屏下的舞台尺寸。

### 5.5 SDK

同一实例支持 theme、resolution、maxFps、pvTimeoutMs、diagnostics、rendererUrl、timeoutMs。theme 默认 dark，仅接受 dark/light，并在挂载前校验。保留目标的 PV load/selectDifficulty 等待预算和销毁取消语义。

sdk/protocol、resolution、frame-rate 继续重导出 renderer 规范。来源 theme 是创建参数和组件按钮行为，本次无需增加 setTheme 命令。tests/sdk.spec.mjs 和 tests/types.ts 虽自动合并，也要运行以验证组合配置与类型。

## 6. 统一产物流程

这是必须改造的无文本冲突文件：目标新增的 native/artifacts.mjs 仍读取 upstream-manifest.json、upstream-sources.cmake、shims 和 native/upstream；来源已删除这些路径。原样保留会导致 sync:artifacts 运行失败。

建议保留 native/artifacts.mjs 作为统一协调器：

1. 原生构建采用来源的检查与 CMake 流程，计算 upstreamGitCommit、upstreamTree、upstreamDirty、sourceRevision，复制本次 JS/WASM/qtloader 与许可证。
2. 调用 syncTheme，从同一子模块生成主题。
3. 复用 scripts/build-identity.mjs 的 rendererVersion。其算法包含 sourceRevision、工具链、原生适配和实际 JS/WASM/renderer 源文件。
4. 写 build-identity.json，保持 protocolVersion=1；构建版本使用来源的 miaview-web-2 前缀。
5. 基于本次 JS/WASM 重建 .br/.gz，覆盖旧压缩文件。
6. 扩展 scripts/update-artifacts.mjs，将压缩文件和许可证也纳入唯一清单，再生成长度/SHA-256。

避免保留两个独立的清单/身份实现。版本计算不包含身份、清单和压缩文件，避免循环；清单最后生成并包含身份文件。

JS-only 的 sync:artifacts 保留已有原生来源和工具链身份，更新版本、压缩与清单，不能根据当前 checkout 自动宣称旧 WASM 来自新上游。若子模块、原生适配或工具链发生变化，必须先 build:native。建议记录原生构建输入指纹，使 JS-only 同步能拒绝需要原生重建的变化。

旧分支的 JS/WASM/压缩文件可以在解决冲突期间作为占位，但不得提交为完成结果。发布必须整体更新 SDK 和 renderer，不独立替换 WASM 或只刷新 manifest。

## 7. dev 与静态 Pages

### 开发宿主

保留目标流程：文件夹 → POST 会话 → PUT 资源 → SDK 加载 HTTP URL。保留仅通过 SDK 的 preview-host、后台原文日志、配置重建复用 URL 和不重复上传。scripts/serve.mjs 继续委托 dev/server.mjs。

### 静态示例

从来源示例迁出本地文件夹、独立 PV/音乐选择、移除 PV、难度、播放和重建实例行为。全部调用公开 SDK。创建时明确 diagnostics:false，因为静态 Pages 没有日志后台。

build-pages.mjs 仅复制 SDK、完整 renderer 和静态示例依赖，将 pages.html 映射到输出 examples/index.html，根页面继续跳转到该路径。原有兼容 demo.mjs、dev 模块和 backend 不成为静态入口依赖。

Pages 保持本地文件不上传。PV 失败可替换、移除和重试；主题/难度变化不得丢失已选媒体。使用相对路径，覆盖 /MiaView_Web/ 项目前缀。

### Pages 测试隔离

来源 tests/pages-smoke.mjs 使用 staticServer；合并后该函数来自目标 dev/server，自带上传与日志路由。因此必须改为仅支持 GET/HEAD 的独立静态测试服务，任何 POST/PUT 请求直接失败，且不实现 /__dev-charts 或 /__performance。

除了无 pageerror，增加页面/模块资源无 404 和网络无写请求的检查。不能用开发后台正常运行来证明静态部署可用。

## 8. 包、校验和 CI

package.json 使用来源 0.2.0-dev，保留 SDK exports、Node >=22。发布 files 保留 sdk、renderer、backend、README；native 默认不加入运行包，因为其构建需要 vendor 和工具链，单独打包 native 不完整。完整源码构建通过 Git checkout + submodule 获取。

合并 scripts：dev、test、check、check:source、test:browser、test:ui、test:pages、build:pages、build:native、sync:artifacts。

verify 合并以下契约：清单路径安全/唯一/长度/哈希、必要模块/主题/压缩/许可证存在、组件装配及 dev 边界、上游提交/tree/sourceRevision/工具链与版本一致。check:source 要求已初始化子模块；普通 check 仍可检验预构建发布包而不初始化源码。

保留来源 web.yml 的 Linux ICU/EGL 环境修复和两条流水线：预构建产物验证、从固定子模块重建后验证。两者都覆盖 browser/UI；静态入口覆盖 Pages。

pages.yml 来源仅监听 main 和 feat/dev-preview，合入目标后不会因目标分支 push 自动部署。建议合并阶段先保留该部署触发策略，目标只跑构建验证；以后若需目标分支成为正式演示来源，再显式调整触发分支。Pages 流水线发布前运行 test:pages。若多分支均自动部署同一个 Pages 环境，应明确最终发布来源。

README、旧迁移计划和重构变更说明需补充整合结果，区分历史记录与当前入口，不再指导用户运行已删除的 upstream 流程。

## 9. 实施步骤与提交边界

以下为执行方案，尚未执行。先确认工作区干净和远端 tips 未变化。

```powershell
git fetch origin
git switch -c codex/integrate-dev-preview origin/feat/component-dev-refactor
git merge --no-ff --no-commit origin/feat/dev-preview
```

推荐在隔离整合分支完成；不要在当前 feat/dev-preview 上反向做目标合并。

1. 按冲突表处理源码，先不运行旧 artifact 脚本，也不把二进制标记为最终结果。
2. 改造 artifacts、verify、Pages 入口和无冲突但仍依赖旧路径的模块。
3. 运行 JS 单测、类型检查与分层/路径核对。
4. 初始化 vendor/MiaCode 到来源固定提交，使用新工具链目录进行 Release 原生重建。
5. 统一同步主题、身份、压缩和清单，运行完整验收。
6. git diff --check；确认无未解决冲突与意外生成文件；提交一次有两个父提交的 merge commit。
7. 验收通过后将整合分支通过 PR 合入 feat/component-dev-refactor，或在允许的本地目标分支上 fast-forward 到该 merge commit。不推送/发布在本次方案范围内。

来源历史保留五个提交，目标拆分保留一个提交；冲突解决与必要适配进入 merge commit，使该提交本身可运行。无需先制造一个坏掉的 merge commit，再补多个修复提交。

## 10. 验证顺序和完成定义

### 低成本检查

```powershell
npm test
npx tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2022,DOM tests/types.ts
git diff --check
git diff --name-only --diff-filter=U
```

现有依赖不足时按 web.yml 的版本安装 Playwright/TypeScript。编译生成产物前的 check 哈希失败可能来自占位产物，不把它当作源码验证通过，也不通过手工修改哈希掩盖问题。

### 原生和产物

```powershell
git submodule update --init --recursive
$env:MIACODE_BUILD_DIR = Join-Path (Get-Location) 'native/build-dev-refactor-release'
$env:MIACODE_BUILD_JOBS = '4'
npm run build:native
npm run check
npm run check:source
```

Qt/Emscripten 安装以来源 toolchain.json 和 CI 脚本为准。已配置同一工具链目录可复用；同目录不同时构建。当前方案未确认本机能完成新工具链编译。

### 实际浏览器

```powershell
npm run test:browser
npm run test:ui
npm run test:pages
npm run build:pages
```

build:pages 使用空输出目录；如果 smoke 或之前运行已生成默认输出，选择新的明确输出路径，不盲目递归删除。

验收必须同时满足：

| 契约 | 验收场景 |
| --- | --- |
| 视频接口 | 新 WASM 导出 external_video；PV 真正出现在 Qt 下方，亮度/Note/HUD 正确 |
| 视频回退 | 有 PV → 无 PV、有 PV → 超时、失败 PV → 替换/移除；无残留视频/遮罩 |
| 并行与取消 | 保留并行加载、超时仅跳过 PV、unlimited 可被销毁取消 |
| 命令一致 | UI/SDK 播放、暂停、seek、难度、设置走同一控制器，错误后队列仍可用 |
| 布局 | 16:9、1:1、320px、桌面设置侧栏、移动设置展开、全屏、80px 控制栏 |
| 诊断 | dev 后台原文；只在播放期间性能采样；静态页面诊断关闭且无后台请求 |
| 压缩/缓存 | .br/.gz 解压与原文件一致；版本缓存与身份/清单策略一致 |
| Pages | /MiaView_Web/ 前缀路径正确，资源无 404，无 POST/PUT，本地媒体不上传 |
| 溯源 | 固定 submodule、干净源码、匹配工具链/identity/manifest，无旧 upstream 引用 |

只有所有适用检查通过才把整合视为完成。以上是实施前的完成定义。


## 11. 2026-10-11 实施结果

已在 `codex/integrate-dev-preview` 将来源合入目标，保留双方历史与播放器模块拆分。16 个冲突已按方案解决，自动合并的原生视频契约、产物同步与 Pages 后台依赖也已复核。

原生 Release 使用干净固定 MiaCode `fb6fcd9eee1e92f2668e4e883db4567eff91006e`、Qt 6.11.1 / Emscripten 4.0.7 构建，配套 JS/WASM、主题、许可证、压缩文件和清单统一生成。构建版本为 `miaview-web-2-26737ad6968d`。JS-only 同步实际验证成功；临时改变原生输入时同步被拒绝，且不修改产物，恢复后源码一致性检查通过。

本机验证通过：44/44 单元测试、TypeScript 严格检查、产物哈希及压缩解压回验、固定源码/工具链/版本检查、实际 Edge 的 browser/UI/Pages 三组测试、Pages 静态打包和 Git whitespace 检查。浏览器覆盖 PV 超时与取消、透明合成像素、后台诊断、主题全屏、320px 布局、错误 PV 后替换、音乐与难度保持、移除 PV，以及静态入口无上传请求和资源 404。桌面/移动截图人工检查正常。

本次只完成本地合并与验证，不推送或部署；远端 Linux CI、其他浏览器与真实 GPU 未在本机执行。整合提交将快进到本地 `feat/component-dev-refactor`，整合分支保留用于审阅。

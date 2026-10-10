# MiaView_Web 跟进 MiaCode dev 的方案

当前分发与提交策略见 [CI 构建](ci-artifacts.md)，本文件保留历史调研。

日期：2026-10-10。本文件保留实施前的调研快照与方案依据。方案已获确认并开始实施；当前源码基线、改动与验证见 [迁移实现与验收](dev-migration.md)，以下旧快照不代表当前构建使用的提交。

## 结论

在保留 MiaView 独立源码仓的前提下，推荐 **Git submodule 固定 MiaCode 的提交，直接链接上游模块；MiaView 只保留浏览器宿主、WebAudio/PV 适配、JS SDK 和网页外壳**。跨平台接口和渲染修复回到 MiaCode，避免持续维护复制的源码、同名 shim 和字符串替换补丁。

两位子代理的后续调研见 [上游复用与 SDK 仓库决策](C:/Users/admin/Desktop/MiaView_Web/docs/upstream-sdk-options.md)。目前应先在上游形成可消费的 SDK，不必新增 SDK 仓库；如果同一团队经常同时修改两端，Web 宿主并入 MiaCode 单仓、分别发布产品也是合理的长期候选。

Web 保持可嵌入播放器定位。上游规划明确 Web 不带编辑器和时间轴；本轮不扩展为桌面编辑器，也不引入 BASS、FFmpeg、封面/视频导出等桌面链路。新版对齐范围是预览画面、HUD、播放控制和设置体验。

## 已核实的基线

| 对象 | 本机快照 | 含义 |
| --- | --- | --- |
| MiaView main | `8539dab658e3d764f7c9b6000d53272d4d2afe2c` | 2026-10-08，最大帧率接口；已完成克隆 |
| MiaCode 本地 main | `641e4d0d46170ed9673186a549637b45620bc697` | CMake 仍标为 1.0.0，不能用它代替 1.2.0 |
| MiaCode origin/main | `6573efb611056bccd046dd17bc2f4cceda78bf88` | 本机缓存，CMake 标为 1.2.0 |
| MiaCode v1.2.0 | `2f5bb005f9f47ea6887320d01714cf5ccacdce86` | 稳定版对照 |
| MiaCode 本地 dev | `f5ff674795731591d1bb9239c3ee16508d125c40` | CMake 标为 2.0.0-alpha，本方案目标快照 |
| MiaCode origin/dev | `cb52f6e8103e2773e839b797cdbd2522e780e2c7` | 比本地 dev 旧；本轮未联网刷新 MiaCode 引用 |

MiaView 的 `native/upstream-manifest.json` 有 499 个文件，其中 160 个 C++/头文件。与本机 dev 对照，82 个同路径代码文件内容一致，36 个同路径文件有变化，42 个旧路径已不存在（路径搬迁或删除；统计已消除 CRLF/LF 差异）。因此不能把 42 个缺失路径理解为 42 个功能被删掉，也不能通过只替换 WASM 完成迁移。

`sourceRevision` 当前是 64 位内容身份，不是 40 位 Git 提交。保留其协议用途，新增独立 `upstreamGitCommit`、上游标签、工具链版本和资源清单，避免混淆。

当前 13 项 Node 测试通过，产物/上游归档哈希检查通过。Windows Git 最初自动转换换行导致哈希失败，已将本仓库 `core.autocrlf` 设为 false，并恢复 Git 原始文件字节；原始跟踪文件无内容改动。

## 上游模块化的实际状态

依据：`MiaCode/docs/specs/architecture/MODULE_LAYERING_CURRENT_ZH.md`、`MODULE_LAYERING_ZH.md`、`docs/audit/MODULE_LAYERING_A_DELIVERY_ZH.md`、`MODULE_LAYERING_A_REVIEW_ZH.md`，并回到当前源码核对。

已经可以复用的是 base → chart → analysis → scene → preview_quick 的模块关系、音符模型、SFX 时间线、资源归属和 `MiaCode.Preview` QML 模块。`WebModuleBoundarySpec.cpp` 已验证库组合不链接桌面 MiaCode。

但该 Spec 是桌面 offscreen 链接/运行验证，**不能当作真实 Emscripten 单线程构建通过的证据**。审计明确记录了这一限制。

历史审计也不能原样当成当前问题清单。例如审计 B2 的 HUD 持久化问题已经变化：当前 `PreferenceProvider` 只提供语言，`PreviewHudFontSettings` 显式随配置传递。迁移应沿用这种值注入，不在 Web 端恢复旧的全局读写。

仍需解决的具体问题：

1. 上游顶层 CMake 要求 Qt 6.10，并无条件配置桌面 UI、ScintillaQuick 和 MultimediaQuickPrivate；模块文件也集中定义桌面目标。直接 `add_subdirectory(MiaCode)` 仍会带入无关配置。
2. `miacode_preview_quick` 仍 PUBLIC 链接 QtMultimedia，定义 `HAVE_QT_MULTIMEDIA=1`，PreviewRuntime 中的 QVideoFrame 路径仍在。应核实无调用方后将转换部分移入 stage_media，或者提供明确的模块特性开关，而不是在 Web 中覆盖同名头。
3. `miacode_audio` 含桌面 worker，当前使用 QThread 并立即启动；preview 素材加载也有 QThreadPool 路径，base 日志/看门狗仍有 std::thread。单线程 WASM 不能以桌面 boundary Spec 代替验证。首版保留已工作的 WebAudio，只复用 scene 中的 SFX 语义，不强行链接 audio/audio_bass，并验证资源加载/诊断的单线程路径。
4. `AssetPaths.h` 仍按 applicationDirPath 搜索磁盘；Web 需要 qrc 或虚拟文件系统目录。资源路径、语言包及默认字体必须成为可配置的宿主输入。
5. PreviewStageBackground 的两处 sourceRect 归一化调用在当前 dev 仍存在，MiaView CMake 当前通过生成副本修正。将其验证为共享修复并回归桌面后合入上游，清除这一复制补丁。
6. 上游 Web 工具链尚未实证。MiaView 当前固定 Qt 6.8.3 / Emscripten 3.1.56，不能假定 dev 的 Qt 6.10 源码直接兼容。先选定一组受 Qt 对应版本支持的工具链做构建验证，再写入 CI 锁定配置。

## 引用与维护方式

| 方式 | 维护效果 | 本方案判断 |
| --- | --- | --- |
| submodule + 上游模块目标 | 源码不复制；提交指针与升级 diff 可审查 | 首选，匹配上游“单仓、多 CMake 目标”方向 |
| FetchContent 固定完整 SHA | 也能避免源码复制；适合 CI 自动取依赖 | 可替代 submodule，避免同时维护两种远程来源 |
| 继续 native/upstream 快照导出 | 需要持续维护源清单、shim、补丁与资源清单 | 只作稳定版回退，不作为 dev 长期方案 |
| Web 宿主并入 MiaCode 单仓 | 核心与 Web 改动可在同一 PR 验证，产品仍独立发布 | 同团队、频繁跨端修改时值得考虑；有迁移贡献/发布流程成本 |
| 单独抽出核心新仓库 | 可独立维护 API、权限和版本；新增跨仓兼容与发布职责 | 当前接口成熟度与维护需求不足以支持这项额外成本 |

建议目录：

```text
MiaView_Web/
  vendor/MiaCode/          # submodule，固定经验证的 dev SHA
  native/
    CMakeLists.txt         # 消费上游公开模块构建入口
    browser-host.cpp       # JS/WASM 边界与 Web 宿主装配
    adapters/              # 资源、语言、媒体平台适配
  sdk/                     # 保持当前 createPreview 接入接口
  renderer/                # 网页外壳、WebAudio、HTMLVideo、构建产物
  tests/                   # SDK 兼容、共享行为、真实浏览器测试
```

建议在 **MiaCode 上游**补一个可被 add_subdirectory 使用的 library-only 配置入口，按目标依赖闭包启用模块。拟议参数如 `MIACODE_BUILD_PROFILE=web` 和 `MIACODE_BUILD_APP=OFF` 目前尚不存在，不能直接照抄运行。关闭的桌面目标应同时跳过 find_package 和第三方配置，仅 EXCLUDE_FROM_ALL 不足以解决配置期依赖。

Web 消费者应链接 `miacode_chart`、`miacode_analysis`、`miacode_scene`、`miacode_preview_quick`，base 通过依赖传递；HTML/WebAudio 媒体宿主不链接 stage_media/export。使用真实 PreviewRuntime 或上游公开的 frame-state 输入接口，删除 `native/shims/preview/runtime/PreviewRuntime.h` 这种同名伪实现。若缺少方法，先补上游端口，不在 Web 再拷一套算法。

播放协调器目前仍在 `app/runtime/playback`；上游方向文档将共享 `playback` 和 `workspace` 库列为阶段二，而非已交付能力。当前只共用下层时间/SFX/场景算法，Web 保留必要的 AudioContext 调度。后续从上游拆出共享 playback 目标后接入 Web 后端，不能为了复用而引入整个桌面 Session，或在 Web 复制 PlaybackCoordinator。base 的日志/诊断后台线程也需通过真实单线程 WASM 构建与运行验证，必要时提供上游公开的可选诊断实现，最终清除现有日志同名 shim。

开发时允许 `MIACODE_SOURCE_DIR` 指向本地 MiaCode，便于同机联调；发布/CI 只允许干净的 submodule 提交。这个本地覆盖参数也是待实现项。发布不静默跟随移动的 dev HEAD，优先升级已合入远端的完整 SHA。

submodule 更新流程：选择 dev 提交 → 验证 Web/桌面公共契约 → 重建 WASM 与资源 → SDK 和浏览器回归 → 提交 submodule 指针与完整 renderer 产物。构建身份写入上游 SHA 和源码树 dirty 状态；发布拒绝 dirty 来源。

先建立新链路并通过回归，再移除旧快照。旧版 SDK/renderer 完整产物作为可回滚版本保留，避免在一份 renderer 目录混用两代 JS/WASM。生产消费者不需要编译，也不需要递归克隆 submodule，仍部署预编译 sdk/renderer。

## 代码归属与最小分叉

| 内容 | 放在哪里 |
| --- | --- |
| Simai 文档与解析、Muri、时间语义、SFX 归属、HUD、QSG 场景、纹理生命周期 | MiaCode 上游原实现 |
| library-only 构建入口、资源根注入、可选平台依赖、共同渲染缺陷修复 | MiaCode 上游，桌面与 Web 一起验证 |
| AudioContext 时钟/混音、HTMLVideo 解码/追帧、Blob/URL、iframe 消息、WASM ABI | MiaView 平台适配 |
| 页面外壳、浏览器全屏、触摸布局、静态部署和实例释放 | MiaView |
| 主题颜色/间距/控件语义 | 从上游抽取无桌面依赖的 token 源，生成 QML/CSS 消费输出 |

上游 `Theme.qml` 当前属于 app/UI 且引用偏好/窗口材质，不能为同步样式而把整个桌面 UI 链入 Web。首版保留 HTML 外壳与 Qt 场景，统一 token、文案、设置含义和控制布局。之后如抽取 Qt 共用预览控制组件，应形成独立 `PreviewUI` 模块，再让各宿主装配；这属于可选后续范围。

长期规则：不在 Web 手改上游源码；不从上游复制第二份 parser/Muri/scene；不维护另一份上游源文件列表。共享修复先提交上游并合入，再升级指针。临时补丁必须列出原因、上游问题和清除条件，并在 CI 中检测失效。

## 功能与 UI 对齐

第一批必须对齐：谱面解析与诊断、&first/BPM 时间语义、Slide 等待与头材质、无理/按区消去、判定效果、SFX，SD/DX 皮肤、画布与 HUD、自定义亮度/流速/叠放、PV seek 和销毁后的资源释放。已有能力先作回归项，不能把它们全部宣传成 dev 新功能。

推荐 UI：舞台保持主视觉；时间进度条独占一行，播放/重播、当前时间、模式和设置居于下一行。采用 dev 的低饱和控件、细分隔线、常规字重和紧凑间距。设置按“画面 / 音频”分组；大尺寸用舞台旁独立设置区，小尺寸放到舞台下方，避免设置覆盖关键谱面。

交互原型提供“嵌入播放器”和“看谱工作台”两种布局。工作台仅用于示例页/独立看谱，不增加编辑器或时间轴。可切换设置、难度、预览模式，拖动进度与亮度。舞台音符是布局示意；它不证明 dev 已完成渲染迁移。

可在迁移后增加倍速、主音量/BGM/SFX 音量、主题、画布/HUD 开关；这些需要 SDK、类型、协议和调度一起实现，不只添加按钮。现有协议继续以 v1 语义兼容；新增字段可通过能力声明暴露。只有改变现有命令语义时才升级协议版本。速度必须同步 AudioContext、SFX 时间线、PV 和场景时刻。

浏览器独立窗口与桌面 detach 的生命周期不同。首批提供容器扩展/浏览器全屏，跨窗口分离作为后续独立功能，避免为视觉对齐引入第二播放实例。

## 实施顺序与验收

工作量为规划估计，按一名熟悉 Qt/CMake 的开发者、可用 Linux WASM 构建环境计算；不含工具链下载等待。

| 阶段 | 改动与交付 | 验收门槛 | 估计 |
| --- | --- | --- | --- |
| 基线与契约 | 固定 SHA，选工具链；同一谱面生成 native/Web 解析、Muri、SFX 对照；记录当前加载和资源占用 | 当前 13 项测试、check、浏览器基线；版本/资源可追溯 | 1–2 日 |
| 上游构建入口 | library-only 配置、Web 必要依赖隔离、资源输入；真实 WASM 编译 | 无 BASS/FFmpeg/编辑器依赖，桌面受影响构建/Spec 不回归 | 2–4 日 |
| submodule 与宿主 | 接入模块，移除 shim/字符串补丁；适配解析与 FrameState、WebAudio/PV | 同谱解析/SFX/Muri 等价；1:1/16:9、seek/切谱/重复实例销毁正确 | 2–3 日 |
| UI 与 SDK | 主题 token、控制栏与设置；增量 API、响应式和状态反馈 | 旧 createPreview 示例兼容，320px/桌面、深浅色、键盘/触摸可用 | 2–3 日 |
| 发布与升级闭环 | Linux CI 产物、哈希、浏览器回归、升级记录、稳定版回滚 | 全量 renderer 原子部署；发布记录两个提交和工具链 | 1–2 日 |

总计约 **8–14 个工作日**；工具链兼容失败或需要较大上游公共接口调整时重估。先完成“上游模块可真实构建 + Web 宿主最小播放”再开展完整 UI，避免返工。

共享行为验收应覆盖合法/非法 &first、BPM/细分诊断、$/$$/@/?/!、延迟 slide/wifi、touch-hold 相邻/重叠/嵌套与中途 seek、旧异步结果丢弃；对照上游已有 Spec 和 CLI 输出。UI 验收另外覆盖设置不遮谱、错误/加载/空态、长曲名、文件夹多素材、移动端控制命中区域。

本轮没有做真实 dev WASM 构建，也没有把旧审计中的通过结论当作当前全量测试通过。当前机器有 Playwright 库和 Edge，可用于原型检查；仓库所需固定版本的 Qt/WASM 工具链仍待准备和实证。

UI 原型已在独立 headless Edge 会话检查：两种布局切换、设置展开/关闭、画面/音频分组、模式切换、进度拖动、播放状态、亮度数值及深浅色；检查 1024/736/320px 宽度，没有横向溢出或页面脚本错误。该检查不运行 dev WASM，也不播放真实音频。

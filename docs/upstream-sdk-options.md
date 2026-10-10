# 上游复用与 SDK 仓库决策

日期：2026-10-10。由两位子代理分别核查上游复用边界、仓库与发布策略，再综合当前源码和官方工具文档。

范围：实施前的只读调研与方案，保留当时 `f5ff674795731591d1bb9239c3ee16508d125c40` 快照。用户确认后已刷新 `dev`、修改共享构建入口并接入 submodule；实际源码、构建与验收状态见 [迁移实现与验收](dev-migration.md)。

## 建议

**目前没有必要新增一个独立 SDK 仓库。先在 MiaCode 内形成可消费、可验证的共享 SDK，再决定是否需要独立的源码仓。**

近期默认保持现有两仓：MiaCode 保存唯一的共享实现，MiaView 固定引用经验证的上游提交，保留浏览器宿主、JS SDK 和网页外壳。先补上游构建/资源契约，再实施 submodule 迁移。

如果两端由同一团队维护，而且多数核心变更都要同时修改 Web，把 Web 宿主放入 MiaCode 的 `apps/web` 也值得考虑，长期协调成本可能更低。桌面产品与 MiaView 仍可以分别发布。相比新增第三个核心 SDK 仓库，这条路径更适合边界仍在演进的阶段。

上游当前规划选择了“单仓、多个 CMake 目标，不拆仓”，见 [MODULE_LAYERING_ZH.md](C:/Users/admin/Desktop/MiaCode/docs/specs/architecture/MODULE_LAYERING_ZH.md:25)。它是当前设计依据；本次不拆 SDK 仓的主要理由是接口成熟度与维护成本，而不是把这句话当成不可改变的限制。

## 先区分 SDK、依赖获取与仓库

| 对象或决策 | 本项目中的含义 | 是否要求另建仓库 |
| --- | --- | --- |
| C++/Qt 共享 SDK | chart、analysis、scene、preview_quick，未来的 playback；包含公开接口、构建约定、资源契约与测试 | 不要求，可由 MiaCode 单仓提供 |
| 浏览器 JS SDK | `createPreview()`、类型、iframe 消息、renderer 接入 | 不要求，已经位于 MiaView 的 sdk/ |
| 获取源码 | submodule、FetchContent、固定 SHA 的源码发行包 | 不决定代码是否解耦 |
| 消费代码 | 源码树 targets，或可安装的 CMake package | 不决定仓库数量 |
| 对外发布 | 完整静态包/npm 包、源码包、指定工具链的二进制包 | 可以从同一个仓库独立发布多个产品 |

现有 [package.json](C:/Users/admin/Desktop/MiaView_Web/package.json:4) 已配置 entry、types、exports，但为 `private:true`，README 明示未发布 npm。独立版本的 JS SDK 可以直接从现有仓库发布，无须把 sdk/ 再拆一仓；`private:true` 会阻止 npm 发布，见 [npm 文档](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#private)。发布仍需要设计包内容、renderer 部署和兼容关系，不能只改这一字段。

JS wrapper 也依赖 renderer：默认寻找相邻 renderer，启动读取构建身份，并校验消息的播放器身份，见 [sdk/index.mjs](C:/Users/admin/Desktop/MiaView_Web/sdk/index.mjs:39)。单独拆 JS 仓会增加 wrapper/renderer 的版本组合、默认部署路径和联调成本，对减少 C++ 算法分叉帮助很小。

## 当前上游到了哪一步

已经完成源码分层和静态 target 复用基础，但尚未形成完整的安装式 SDK，也尚未实证 Web 工具链。

| 核查项 | 当前事实 | 对决策的影响 |
| --- | --- | --- |
| 共享核心 | base → chart → analysis → scene → preview_quick 已定义；音符模型、解析/Muri、SFX 语义、HUD 和 QSG 可共享 | 不需要重新复制或抽一套算法 |
| 公开构建入口 | 顶层仍是桌面 app 配置；全量 Qt 依赖、ScintillaQuick、FFmpeg 等在配置期出现 | 直接 submodule + add_subdirectory 还不够 |
| 安装导出 | 自有顶层与 cmake/ 未发现 install(TARGETS/EXPORT)、MiaCodeConfig 或版本包配置；helper PUBLIC 暴露源码树 src 根 | 内部 targets 尚不能直接当作可搬移的外部 SDK 包 |
| 平台验证 | WebModuleBoundarySpec 是桌面 offscreen 验证；现有上游 CI 矩阵为 Windows/macOS，无真实 Web job | 不能据审计宣布 Emscripten 构建或浏览器运行已通过 |
| 播放内核 | workspace/playback 仍在 app，文档列为阶段二 | 第一批不应等待整个阶段二，也不应复制桌面协调器 |
| Qt 依赖 | 上游明确保留 QtCore/QtGui；preview_quick 使用 QtQuick/Qml | 本轮无需为“SDK”另做去 Qt 化重写 |

主要证据：[顶层依赖](C:/Users/admin/Desktop/MiaCode/CMakeLists.txt:112)、[模块定义](C:/Users/admin/Desktop/MiaCode/cmake/MiaCodeModules.cmake:369)、[helper 源码 include](C:/Users/admin/Desktop/MiaCode/cmake/MiaCodeModuleHelpers.cmake:17)、[阶段二规划](C:/Users/admin/Desktop/MiaCode/docs/specs/architecture/MODULE_LAYERING_ZH.md:31)、[CI 矩阵](C:/Users/admin/Desktop/MiaCode/.github/workflows/package.yml:34)。

历史审计须结合当前代码阅读：HUD 偏好持久化耦合已有修复，PreferenceProvider 已收窄到语言；slide 参考数据已经统一缓存。PreviewAudioWorker 当前使用 QThread，而非旧审计中的 std::thread，但仍立即启动线程。不能把旧问题全部算成新一轮待开发工作。

## 方案的收益与代价

| 方案 | 主要收益 | 主要代价与风险 | 本次判断 |
| --- | --- | --- | --- |
| **保留两仓，MiaView submodule 固定 MiaCode SHA** | 不复制核心；改动最小；保留各自贡献与发布工作流；升级和回滚有明确提交 | 上游接口与 Web 接入无法原子合入；需要两仓联调、指针升级；初始化、提交可达性、上游资源体量仍要管理 | 现有两仓继续独立维护时的近期首选 |
| **Web 宿主并入 MiaCode apps/web，分别发布产品** | 核心修复与 Web 适配可在同一 PR 验证；没有 submodule 指针协调；阶段二接口变更更方便 | 需要迁移贡献入口/发布流程，决定是否迁历史；CI 需按依赖选择作业；仓库更大，独立维护权限较粗 | 同团队且经常跨端修改时，长期可能最省维护 |
| **上游单仓，发布源码/CMake 包** | 消费者无需完整仓库；公共头文件、资源和依赖约定更清晰；保留唯一源码来源 | 要维护导出、Qt 依赖发现、QML 静态插件/qrc/shader；源码包仍需编译；二进制包须维护工具链矩阵 | 接口验证稳定后逐步提供，不必另建 SDK 仓 |
| **独立核心 SDK 仓，两端都消费它** | API、权限、版本、维护责任和发布周期可独立；第三方只关注核心 | 桌面也须改成消费者；共享改动涉及核心→桌面/Web 三仓；新增兼容矩阵、稳定分支和发布责任；资源/测试归属须重定 | 当前收益不足以覆盖额外成本 |
| **继续 vendor 源码快照** | 保留稳定版方便；离线复现容易；不需子模块工作流 | 源清单、路径迁移、同名 shim、字符串补丁要持续同步；共享修复易漏 | 留作旧版归档/临时回退 |

submodule 的 gitlink 记录依赖提交，默认 clone 不会自动 checkout 其内容，见 [Git 官方文档](https://git-scm.com/docs/gitsubmodules)。它解决源码引用和版本固定，不保证 API 稳定或平台兼容。发布应使用已推送、可获取的完整 SHA；不能静默跟随 dev HEAD。Web 配置不需要 ScintillaQuick 时，也应避免无必要地递归初始化上游桌面子模块。

FetchContent 是同一源码策略的另一种获取方式：固定完整 SHA，有利于构建脚本集成，但会把首次获取依赖的网络问题带入配置步骤，需要缓存/离线约定。它同样绕不过当前顶层桌面依赖。CMake 官方建议远程 Git 依赖使用提交 hash，见 [FetchContent 文档](https://cmake.org/cmake/help/latest/module/FetchContent.html)。本项目应选择一种默认来源；本地联调覆盖可以共用同一消费入口，不再另维护源文件列表。

如果独立 SDK 仓仍从 MiaCode 手动复制源码，然后两边继续各改各的，会多一个同步源。真正拆核心仓时，需要把它变成唯一权威，桌面和 Web 都作为消费者。由上游自动生成且禁止直接开发的镜像仓则是发布镜像，主要改善获取体量，不等同于建立新的源码维护中心。

## 真正需要先解决的风险

| 风险 | 当前证据 | 最小处理与验收 |
| --- | --- | --- |
| 配置期拉入桌面依赖 | 顶层全量 REQUIRED Qt；模块定义无选择；非 Win/mac 路径配置 FFmpeg/VAAPI | 上游提供 library-only 配置和目标依赖闭包；未选桌面模块须同时跳过 find_package/第三方配置。EXCLUDE_FROM_ALL 本身不足以处理配置期依赖 |
| preview 强制 Multimedia | [Modules.cmake:427](C:/Users/admin/Desktop/MiaCode/cmake/MiaCodeModules.cmake:427)；Runtime 的 QVideoFrame 桥接 | 将桥接放入 stage_media/可选目标，核查潜在接口消费者；首期 Web 用 HTMLVideo，复用 QSG 场景 |
| 资源根、缓存与线程 | [AssetPaths.h](C:/Users/admin/Desktop/MiaCode/src/core/video/AssetPaths.h:13) 静态缓存桌面目录；[AssetRepository](C:/Users/admin/Desktop/MiaCode/src/preview/runtime/PreviewSceneAssetRepository.cpp:68) 使用线程池；base 日志有线程 | 显式注入资源根/解析端口，并定义缓存生命周期；选择单线程兼容的加载/诊断路径。真实浏览器检查缺图、seek、切谱、退出与销毁 |
| 用同名 shim 代替真实 Runtime | [MiaView shim](C:/Users/admin/Desktop/MiaView_Web/native/shims/preview/runtime/PreviewRuntime.h:1) 方法为 no-op、snapshot 为空；现在还直接传 FrameState 指针 | 选真实 Runtime 或上游明确的帧输入接口；检查快照所有权和生命周期。接入真实库时删除同名替身，避免类定义/元对象不一致 |
| Web 工具链不一致 | MiaView 固定 Qt 6.8.3/Emscripten 3.1.56；上游最低 Qt 6.10，桌面 CI 使用 6.11.1 | 选定并锁定匹配的 Qt WASM/host/Emscripten。先真实编译及浏览器 smoke，再建立 CI；桌面产出的静态库不能直接供 Web 链接 |
| dev API 改动与两仓发布 | 阶段二播放内核仍待拆；目前公开源码 include 面很大 | 不承诺所有 src 头文件为稳定公共 API；逐步界定实际消费接口。上游候选提交用固定 MiaView 测试工程验证，Web release 固定已验证提交 |
| JS/WASM/资源混版 | 现有 build identity 和协议检查相互关联 | SDK、renderer 与资源整套验证并原子部署；同时记录上游 SHA、宿主 SHA、工具链和资源清单 |
| SDK 包体与资源范围 | 当前 wasm 32,428,960 字节，约 32.4 MB 未压缩；package files 包含 native | 网站消费者优先拿完整 sdk+renderer 产物，源码另发。拆源码仓不会自动缩小 WASM；字体/皮肤资源可选化另行验证字形与 URI |

Qt 官方说明，每个 Qt 次版本对应特定 Emscripten，Emscripten 不保证跨版本 ABI 兼容，见 [Qt for WebAssembly](https://doc.qt.io/qt-6/wasm.html)。所以“独立 SDK 仓发布一个通用 .a”不能替代工具链验证；二进制 SDK 必须标明目标平台和完整构建配置。

资源与源码的分发范围也不能随拆仓自动统一。[上游 LICENSE_SCOPE](C:/Users/admin/Desktop/MiaCode/LICENSE_SCOPE.md) 明确区分自有源码与字体、音效、皮肤等第三方资源；发布包应保留其声明与清单。这一工作对所有仓库方案都需要。

## 推荐落地顺序

1. **先做好单仓里的 SDK。** 补 library-only 构建、必要的资源/媒体端口，复用 base/chart/analysis/scene/preview_quick；首期保留 WebAudio、HTMLVideo 和 Blob/URL 宿主。用当前 Web 与桌面共同验证解析、Muri、SFX 和画面行为。
2. **跑通真实 Web。** 明确工具链、线程与资源配置，完成最小加载/播放/seek/销毁 smoke；这是选择仓库方案之前都必须完成的工作，不依赖整个阶段二。
3. **按当前两仓组织接入固定引用。** 开发允许显式指定本地上游源码；发布只消费已推送且干净的固定提交。移除复制清单、同名 shim 和生成副本补丁，公共修复回到上游。
4. **独立发布 MiaView 产品。** 完整静态包或 npm 包可以从 MiaView 发布；若未来转成 apps/web，也可以继续独立发布。先规定 wrapper/renderer 兼容，再决定是否拆 JS 包。
5. **逐步形成外部 CMake 包。** 若有消费者需要安装式 C++ SDK，补公共 headers、BUILD_INTERFACE/INSTALL_INTERFACE、install(EXPORT)、Config/Version、Qt find_dependency 和 QML/资源消费测试。相关机制由 [CMake 导出指南](https://cmake.org/cmake/help/latest/guide/importing-exporting/index.html) 提供，不需要独立源码仓。
6. **阶段二继续减少行为分叉。** 在上游拆 workspace/playback 的真正共享内核，桌面编辑器/timeline 扩展留给桌面宿主；Web 接入对应后端。不要为了本轮迁移先复制 PlaybackCoordinator。

两仓 CI 可采用一个明确的兼容验证组合：上游 PR 用固定版本的 MiaView 测试工程 + 当前候选上游源码验证；MiaView 发布用固定上游 SHA + 当前宿主验证。两边都要记录对方版本，避免递归互相触发或使用浮动 HEAD 得到不可复现结果。

## 什么时候重新考虑独立 SDK 仓

以下是决策依据，不是要求满足任意固定数量的打分规则：

- 已有相对稳定的公共消费接口，外部干净工程不依赖 app 路径或隐式桌面全局状态。
- 存在明确的 SDK 维护负责人，要承担 API 文档、兼容支持、版本与发布责任。
- 消费者或团队需要独立权限、治理与稳定分支；SDK 发布节奏与产品长期冲突。
- 真实外部消费者需要轻量源码仓，而发行包/单仓 targets 已不足以满足。
- 桌面和 Web 都能以消费者身份验证同一核心，团队接受三仓协调的持续成本。

不必等到“第三个消费者”才能拆仓，两个独立团队也可能有充分理由；但目前已知诉求是减少复制、跟进 dev，这些并不要求新增第三仓。先稳定消费边界，后续再迁出单独仓库，代价会更可控。

本次结论修订了原计划中的两点：submodule 的首选地位以保留独立 MiaView 源码仓为前提；Web 宿主并入上游是合理的长期候选。UI 方案和已有可交互原型不受这项仓库决策影响。

# dev 迁移实现与验收

当前产物策略已于 2026-10-11 改为 [CI 构建](ci-artifacts.md)：生成播放器不再提交 Git。以下为迁移当时的实现与验收记录。

日期：2026-10-10。实施用户确认的“两仓 + 固定提交 submodule”方案，暂不新增 SDK 仓库。

## 源码与状态

| 对象 | 基线 / 当前提交 | 本机分支 |
| --- | --- | --- |
| MiaView 原始 main | `8539dab658e3d764f7c9b6000d53272d4d2afe2c` | 新实现位于 `feat/dev-preview` |
| 刷新后的 MiaCode origin/dev | `8770413f965084f2e0567ae44c235b8a34377861` | 保留原本地 dev 引用 |
| 可被 Web 消费的 MiaCode | `54880613efbf89ca9a603da9a43c27b6f30d600f` | `feat/web-preview-modules` |
| MiaView submodule | 固定上述 `54880613`，不是移动的 dev 分支 | `vendor/MiaCode` |

上游改动已在本机提交；两仓尚未推送。当前电脑可以从本机 Git 对象构建与验证，其他电脑在上游提交发布前无法仅靠 GitHub 初始化该 submodule。
发布顺序：先让共享改动进入可长期获取的 MiaCode 引用，再发布 Web。若上游以 squash / rebase 合并，必须用最终提交更新 gitlink、重建并验收，不能沿用旧 SHA。

后续更新：上游 `54880613` 已发布并合入 dev；本仓当前升级到 dev 头 `fb6fcd9eee1e92f2668e4e883db4567eff91006e`，已重建 WASM 并通过源码一致性与浏览器检查。新增 GitHub Pages 展示页，只加载用户本地文件，无内置示例或大型 PV；项目路径、本地 PV/音乐替换、难度保持、移除 PV 与无上传请求检查通过。上述“尚未推送”描述保留首次迁移时的历史状态。

2026-10-11 整合组件重构：播放器保留 engine/controller/controls 与共用 SDK bridge，PV 改为 DOM 视频置于透明 Qt 画布下方；上游记录的 external media 模式用于遮罩与场景。dev 上传/后台日志与纯静态 Pages 分别使用独立入口。产物同步统一生成身份、JS/WASM 压缩与完整清单，并记录原生输入指纹以防 JS-only 同步误标旧二进制。

## 上游改动

- `MIACODE_BUILD_APP=OFF` 提供最小构建入口，共用原模块清单，直接产出 base、chart、analysis、scene、preview_quick。
- Qt Multimedia 可选；Web 封面输入走图像帧通道，PV 在组件整合后使用 external media 模式与浏览器合成。该构建不配置编辑器、时间轴、BASS、FFmpeg、导出与桌面媒体工具。
- `AssetPaths` 支持宿主注入绝对根目录、Qt 资源路径与恢复桌面发现，拒绝相对路径；应在创建宿主前设置。
- Qt 无线程配置采用现有同步皮肤加载、同步日志路径，关闭不能工作的 GUI 看门狗；桌面线程路径保留。
- QSG 背景纹理的 sourceRect 使用像素坐标，修复二次归一化；共享着色器加入 GLSL ES 300，同时保留桌面默认版本。
- 复用既有 Spec 注册工具，最小配置可以单独运行 Web 模块边界规格；音频由音频 / Android 规格继续覆盖。

这些调整位于 MiaCode 唯一实现中，Web 没有额外 C++ 源码列表、字符串替换补丁或同名 shim。

## Web 改动

- 删除原 `native/upstream`、`native/shims`、源码存档清单与手动 source list，使用 `add_subdirectory(vendor/MiaCode)` 链接共享库。
- 浏览器宿主适配 dev 的解析器与 include 路径，注入 `/assets`，保留 WebAudio / HTMLVideo、确定帧时间与公共 JS 协议。
- Qt / Emscripten 固定为 6.11.1 / 4.0.7。默认构建拒绝上游源码修改及 gitlink 不一致；本地联调须显式指定 `--development`。
- `build-identity.json` 记录上游提交、tree、源码身份、开发状态、工具链；版本还绑定宿主代码和渲染文件。`check:source` 会发现修改代码后仅重写哈希清单的情况。
- 网页深浅主题从上游 `Theme.qml` 提取生成；若 token 结构改变，构建明确报错，要求审查适配器。
- 保持嵌入播放器定位：80px 播放区含时间、主题和全屏控制。桌面设置侧栏，窄屏设置在画面下方展开；SDK 新增可选 `theme`，其他 API 与协议 v1 保持兼容。
- 预编译静态部署仅需 `sdk/`、`renderer/`，不需要 C++ 源码或 submodule。新增 CI 分别验证已提交播放器和从固定源码重新构建的播放器。

## 本机验收

| 检查 | 结果 |
| --- | --- |
| 上游 module_layering 分层检查、Spec catalog 一致性 | 通过 |
| MiaCode 原桌面配置 Release 应用目标 | 构建通过 |
| 桌面配置 web_module_boundary_spec | CTest 1/1 通过 |
| APP=OFF / Multimedia=OFF 最小配置边界规格 | 构建及 CTest 1/1 通过 |
| Qt 6.11.1 / Emscripten 4.0.7 真实 WASM | 从固定且干净的 submodule 构建通过 |
| SDK / 协议 / 帧率单元测试 | 13/13 通过，含主题参数验证 |
| TypeScript 5.9.3 接口检查 | 严格模式通过，含主题合法值及非法值验证 |
| 产物哈希、源码提交与源码树、宿主版本一致性 | 通过 |
| 发布构建防护 | 未显式启用开发模式的本机源码覆盖被拒绝 |
| 静态包检查 | 38 个文件，包含 SDK layout；不包含 native / vendor 源码 |
| 浏览器功能检查 | 实际 Edge/Chromium + WebGL 2，非模拟渲染 |
| 浏览器界面检查 | 深浅主题、全屏、桌面侧栏、320px 窄屏、设置展开与位置保持 |

浏览器检查在 DPR 1 / 2 下运行，覆盖音视频、网络与 Blob 输入、三种预览模式、皮肤、难度、帧率、16:9 / 1:1、跨域嵌入、多实例隔离及销毁。截图由 `npm run test:ui` 生成于 `artifacts/ui/`，README 使用其中的真实截图。

Linux 主机 Qt 下载元数据检查通过；GitHub Actions 工作流已提供，但尚未在远程 runner 上执行。实际本机编译环境为 Windows；浏览器验收使用软件 WebGL。macOS、Android、Safari、Firefox 和真实 GPU 尚未在本次验收中运行。

## 维护流程

1. 共享解析、场景、资源或跨平台问题先在 MiaCode 修改，验证桌面与最小预览配置，发布上游提交。
2. 在 Web 仓执行 `git -C vendor/MiaCode fetch origin dev`，选择具体候选 SHA，并 `git -C vendor/MiaCode checkout --detach <SHA>`。
3. `git add vendor/MiaCode` 记录候选，默认构建检查使用暂存的 gitlink。执行 `npm run build:native`、`npm test`、`npm run check:source`、`npm run test:browser`、`npm run test:ui`。
4. 审查 UI 截图、构建身份与许可文件后，一起提交 gitlink 和产物。回退时一起还原上一个 Web 提交中的 gitlink、SDK 和 renderer，避免混用。

不要将 `git submodule update --remote` 作为发布流程：默认配置只记录 SHA，没有设置自动跟踪分支。跟进 dev 表示有意选择并验证候选，而不是用户安装时自动拉取最新 dev。

## 已知权衡

当前 WASM 为 51,496,842 字节，旧版为 32,428,960 字节。升级 Qt 和直接消费真实共享模块增加了体积；部署时应启用服务器压缩、完整缓存版本并评估低内存手机。当前引擎缓存预算仍能容纳该 WASM，但多实例会各自占用运行内存。

两仓仍需协调共享接口变化和发布顺序；单线程皮肤加载可能暂时阻塞 UI。主题转换是构建时的明确适配边界，不是直接运行 QML UI；只有在 API 稳定、出现更多外部消费者时再评估独立 SDK 发布或拆仓。

# Stage1 界面与浏览器布局交付

日期：2026-10-14。分支：`feature/web-editor-migration`。UI 基准：`8770413f965084f2e0567ae44c235b8a34377861`；预览源码：`ff9f65856b8591589aba0582ac867220202a44c6`。

## 实现与原生组件映射

| 区域 | v2 来源 | 网页实现 |
| --- | --- | --- |
| 工作台与分栏 | MainView、MainSplitView、CompactPanelLayer | `ui/workbench/workbench.mjs`、`page.css`、`services/view-state.mjs` |
| 顶部菜单、工具栏与状态栏 | MainMenu、MainToolBar、StatusBar | `ui/workbench/workbench.mjs`；设置入口、面板状态、页面状态、公共边界 |
| 活动栏与谱面侧栏 | ActivityBar、ChartFieldSidebar、DifficultyList、BookmarkList | `ui/workbench/chart-sidebar.mjs`、`bookmark-list.mjs`；工作台活动入口 |
| 编辑标签与正文 | EditorTabBar、SourceEditor、ScintillaDslStyler | `editor-tabs.mjs`、`source-editor.mjs`、`services/source-styles.mjs` |
| 查找、补全与名义管理 | FindReplaceBar、CompletionPopup、DesignerSlotsDialog | `find-replace.mjs`、`completion-popup.mjs`、`designer-slots.mjs` |
| 元数据与难度字段 | EditorPane | `metadata.mjs`、`difficulty-header.mjs`；原生 ChartWorkspace 快照 |
| 时间轴与分析 | BottomPanel、BottomTabBar、TimelineQuickItem | `timeline-view.mjs`、`timeline-controls.mjs`、`analysis-panel.mjs`；原生场景构建与素材 |
| 预览控制与统计 | PreviewPane、PreviewTransport、NoteStatistics | `preview-transport.mjs`、`note-statistics.mjs`；现有 SDK 与原生统计缓存 |
| 设置与辅助页面 | PreferencesDialog、PreviewSettingsDialog、AudioSettingsDialog、LatencyPage、AboutDialog | `preferences.mjs`、`preview-settings.mjs`、`audio-settings.mjs`、`latency.mjs`、`about.mjs` |
| 导出与封面 | ExportVideoPage、ExportRangeSelector、CoverExportPage、CoverLayerList | `video-export.mjs`、`export-range.mjs`、`cover-editor.mjs`、`cover-canvas.mjs` |

主入口为 `index.html`；`app.mjs` 装配工作台与 SDK。预览沿用 iframe、Qt Quick/WASM/WebGL 2 与 WebAudio。独立编辑器雏形位于 `editor/`，由 `scripts/sync-products.mjs` 复制公共源文件、资源、配置与运行时。

## 验收证据

页面继承所显示的公共工作台与页面组件，相关组件最低分作为保守页面分数；16 个页面与设置子页等权计算。汇总结果为 91.44，最低页面 89。评分来源、差异与原生截图位于 `.assets/ui-reference/`；生成记录位于 `artifacts/stage1/ui-acceptance.json`。

| 验证项 | 结果与证据 |
| --- | --- |
| 页面布局 | Chromium、Firefox、WebKit 各 23 个视口 × 9 个页面，合计 621 个用例；含 14 个计划尺寸及宽高断点前后采样；`tests/workbench-smoke.mjs` |
| 密度与缩放尺寸 | Chrome、Edge、Firefox、WebKit 的五组 DPR、六组有效 CSS 尺寸，共 120 组；输入、绘制、行号与滚动对齐；`tests/workbench-density-smoke.mjs` |
| 原生编辑度量 | 固定版本 ScintillaQuick、文档适配器、着色器与完整 Maple 字体；29px 行高、35px 正文边距；四主题与两尺寸；`tests/native-source-editor-reference.py`、`tests/source-editor-visual-smoke.mjs` |
| 中文输入 | Chromium IME 组合与提交、原生正文更新、输入焦点与光标；360×800 收缩至 360×360；`tests/editor-ime-smoke.mjs` |
| 文件夹素材 | 完整文件清单与同目录谱面、音轨、背景、PV；播放、波形与素材归属；`tests/workbench-folder-smoke.mjs` |
| 预览与封面 | 倍率、跳转、区间、自由比例、原生时间轴与定位、代码跟随、封面尺寸及图层字段；对应 transport、timeline、cover 脚本 |
| 构建与类型 | `build-devtools/` 的 Release 原生构建；运行时 `miaview-web-2-aa1fa8581659`；源码身份、资源哈希与 SDK 严格类型检查 |
| 单元测试 | 59 项，涵盖协议、资源关系、播放时钟、调度、主题、字体、源配置、构建身份与 DSL 着色 |
| 静态部署 | 域名根入口及 `/MiaView_Web/` 子路径、音乐与 PV、`file://` 服务提示；`tests/pages-smoke.mjs`；阶段包 `artifacts/stage1/pages/` |
| 编辑器雏形 | 子目录使用自身入口、模块、配置与运行时；复制至仓库外部目录后载入原生示例；`tests/editor-template-smoke.mjs` |

## 提交前审阅

审阅覆盖主入口、工作台状态与焦点、文件夹归属、SDK 协议与类型、renderer 命令、原生文档与预览桥接、构建配置、复制规则和静态打包。正文快照更新保留输入节点；文档事件加入 SDK 受信任事件集，并由实际文档用例验证。

格式、源码边界、资源体积、运行时与固定源码身份、严格类型、单元与相关浏览器用例通过。生成运行时由构建和打包输出管理；源码提交包含公共组件、原生桥接、独立模板与验收基准。

阶段提交与远端记录写入 `artifacts/stage1/publish.json`，对应本文件的交付内容与运行时身份。

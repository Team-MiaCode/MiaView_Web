# 网页编辑器 UI 验收计划

记录日期：2026-10-13。阶段与功能范围见[网页编辑器迁移计划](WEB_EDITOR_MIGRATION_PLAN_ZH.md)。本文件定义界面基准、评分、浏览器布局条件和迭代记录。

本轮局部验收记录：

| 项目 | 证据 | 结果 |
| --- | --- | --- |
| 四主题公共控件 | `.assets/ui-reference/{theme}.png`、`reference.json`、`gallery-verdict.json`；`artifacts/workbench-ui/gallery/comparison.json` | 控件矩形、字体参数和背景色逐项匹配；视觉评分 92 |
| 欢迎页 | `.assets/ui-reference/welcome-{theme}.png`、`welcome-verdict.json`；浏览器同名截图 | 800×420 原生页面对照；视觉评分 94 |
| BPM 与延迟页 | `.assets/ui-reference/latency-{theme}.png`、`latency-verdict.json`；浏览器同名截图 | 输入行、试听区、细分和音量控件对照；视觉评分 91 |
| 预览设置 | `.assets/ui-reference/preview-settings-{video,gameplay,skin}-{theme}.png`；对应 `preview-*-verdict.json`；浏览器画廊同名截图 | 原始设置弹窗、内容区坐标与四主题对照；视频 93、玩法 90、皮肤 90 |
| 音频设置 | `.assets/ui-reference/audio-settings-{theme}.png`、`audio-settings-verdict.json`；浏览器画廊同名截图 | 十一通道、静音、尾判开关和默认设置入口对照；视觉评分 92 |
| 关于页面 | `.assets/ui-reference/about-{theme}.png`；对应 verdict 文件；浏览器画廊同名截图 | 四主题原始表单对照；关于 94 |
| 难度信息栏 | `.assets/ui-reference/difficulty-header{,-narrow}-{theme}.png`、`difficulty-header-verdict.json`；浏览器画廊同名截图 | 四主题 480 与 240 像素宽度的原始字段布局；视觉评分 96 |
| 谱师名义管理 | `.assets/ui-reference/designer-slots-{theme}.png`、`designer-slots-verdict.json`；浏览器内容区截图 | 七个字段、统一名义选择与原始表单对照；视觉评分 95 |
| 元数据页面 | `.assets/ui-reference/metadata{,-narrow}-{theme}.png`、`metadata-verdict.json`；浏览器画廊同名截图 | 四主题 800 与 360 像素宽度的页面边界、封面与表单对照；视觉评分 94 |
| 谱面侧栏 | `.assets/ui-reference/chart-sidebar-{theme}.png`、`chart-sidebar-verdict.json`；浏览器同名截图 | 分组、两种难度、书签与选择状态对照；视觉评分 93；键盘折叠与焦点保留纳入布局脚本 |
| 偏好五页 | `.assets/ui-reference/preferences-{page}-{theme}.png`、对应 `preferences-*-verdict.json`；浏览器与原生内容区截图 | 界面 92、背景 95、编辑器 93、性能 95、快捷键 92；25 项快捷键依据固定源码定义，列表提供自身滚动区域 |
| 视频导出 | `.assets/ui-reference/export-{output,intro,batch}-{theme}.png`、`export-verdict.json`；浏览器画廊同名截图 | 输出、片头、批量三页与四主题对照，91 分；输出参数、区间、播放指针、片头字段、字体与批量列表对应原始 QML；区间键盘、拖动和最短区间纳入布局脚本 |
| 浏览器布局与输入 | `tests/workbench-smoke.mjs`；`artifacts/workbench-ui/results.json`、`capabilities.json` | Chromium、Firefox、WebKit 各 207 个页面布局用例；包含偏好、预览与导出子标签、封面检查器及菜单的控制项边界；五组有效 CSS 尺寸覆盖换行、滚动和输入层对齐；菜单与查找栏键盘操作通过 |
| 补全弹窗 | `ui/workbench/completion-popup.mjs`；`tests/workbench-smoke.mjs` | 三引擎、二十三窗口尺寸的候选列表边界、键盘选择、编辑器焦点与关闭操作通过；编辑器视口高度逐项验证 |
| 像素密度与有效 CSS 缩放尺寸 | `tests/workbench-density-smoke.mjs`；`artifacts/workbench-ui/density-results.json` | Chrome 155.0.8059.40、Edge 155.0.4283.45、Firefox 153.0、WebKit 26.5；DPR 1、1.25、1.5、2、3 与六组有效 CSS 尺寸，共 120 组输入、换行、行号和滚动对齐通过 |
| 编辑器雏形模板 | `editor/`、`source-config.json`；`tests/editor-template-smoke.mjs` | 复制至仓库外部目录，使用自身入口、模块、服务与运行时加载 17 音符示例 |
| 文件夹载入 | `services/chart-folder.mjs`、`tests/workbench-folder-smoke.mjs`；`artifacts/folder-import/results.json` 与元数据截图 | 文件夹选择、同目录 `bg/PV/track/maidata`、完整资源清单、实际播放、音轨波形、封面与 PV 信息、多谱面选择与素材归属通过 |
| 时间轴画布 | `tests/native-timeline-reference.py`、`tests/timeline-visual-smoke.mjs`、`tests/timeline-smoke.mjs`；`artifacts/timeline/`、`timeline-canvas-verdict.json` | 原生场景、音符素材、轨迹、长条、波形、文本定位、缩放与滚动；四主题 × 两尺寸 × 三状态，共 24 个画布组合，94 分 |
| 时间轴控件 | `tests/native-timeline-controls-reference.py`、`tests/timeline-controls-smoke.mjs`；`timeline-controls-verdict.json`、`artifacts/timeline-controls/` | 四主题缩放与亮度菜单，94 分；七档缩放、两项亮度、代码高亮、编辑选区、CRLF 与缩进位置映射、焦点恢复通过 |
| 原生封面参考 | `tests/native-cover-reference.py`、`tests/native-reference/`；`.assets/ui-reference/cover-{canvas,card,image,text}-{theme}.png` | `build-devtools/native-reference/` 的 Release 宿主复用 C++ CoverLayoutModel 与 Preview 类型，载入固定版本合成器、原始图像和字体，生成四主题属性页与画布参考 |
| 封面四状态 | `.assets/ui-reference/cover-verdict.json`；原生与网页画板、难度卡、图片、文字页面 | 四主题、1200×720 三栏及画布对照；视觉评分 89；输出宽高、图层文字与播放区切换验证通过 |
| 预览控制与统计 | `tests/native-preview-controls-reference.py`、`tests/preview-transport-smoke.mjs`；`.assets/ui-reference/preview-controls-*`、`preview-controls-verdict.json`；`artifacts/preview-controls/results.json` | 四主题、600px 与 340px、空项目与载入项目共 16 状态；70px 控制区及 55/96px 统计区、图标边界对照；视觉评分 92；实际倍率、进度、区间和自由画布比例通过 |
| 单元验证 | `npm test` | 59 项通过，覆盖原有协议与文件夹资源关系、播放边界、音频倍率时钟与判定调度、主题、系统主题选择、字体资源、源配置、文本换行和二进制构建身份 |
| 原生文档快照 | `native/document-bridge.*`、`tests/document-smoke.mjs`；`artifacts/document/results.json` | 原始 `ChartWorkspace` 单一所有者，正文与字段映射；分段保存、扩展字段、难度切换、保存点、非法文本输入与修正通过 |
| 分析面板 | `tests/native-analysis-reference.py`、`tests/analysis-visual-smoke.mjs`；`analysis-verdict.json`、`artifacts/analysis/` | 原始 BottomPanel 的语法与 Muri 内容；四主题 × 三状态 × 两面板，共 24 个组合，94 分；摘要、结果列表、紧凑字体和居中提示对应参考 |
| 编辑器标签 | `tests/native-editor-tabs-reference.py`、`tests/editor-tabs-smoke.mjs`；`editor-tabs-verdict.json`、`artifacts/editor-tabs/` | 原始 EditorTabBar 的四主题与两种宽度，92 分；色块、图标、修改标记、关闭与溢出入口；标签及菜单激活对应原生难度和正文 |
| 音符统计数据 | `native/browser-host.cpp`、`tests/document-smoke.mjs` | 原始 PreviewProgressStatsCache 的六类统计；载入、时间跳转、正文修正与解析状态同步到公共预览状态及工作台数值 |
| 工具栏与状态栏 | `tests/native-workbench-chrome-reference.py`、`tests/workbench-chrome-smoke.mjs`；`workbench-chrome-verdict.json`、`artifacts/workbench-chrome/` | 四主题原始组件对照，93 分；30px 与 23px 高度、图标与状态、设置文字、页面状态和抽屉相邻边界 |
| 谱面正文 | `tests/native-source-editor-reference.py`、`tests/source-editor-visual-smoke.mjs`；`source-editor-verdict.json`、`artifacts/source-editor/` | UI 基准提交的 ScintillaQuick、ScintillaDocumentAdapter、ScintillaDslStyler 与 Maple 字体；四主题与两尺寸，94 分；原生 29px 行高、35px 正文边距、行号、当前行和语法着色 |
| 中文组合输入 | `tests/editor-ime-smoke.mjs`；`artifacts/editor-ime/results.json` | Chromium IME 组合、提交、原生正文回写、光标与焦点；360×800 收缩至 360×360 后的输入与绘制层对齐通过；正文快照更新保留输入节点 |

以上评分适用于对应画廊或页面。像素差异记录用于定位字形、颜色和控件绘制差异；页面总验收采用本文件的加权条目与逐页记录。原生参考采用固定提交的 QML 和中文翻译，使用 Qt 6.11.1 软件渲染；Qt Linguist 6.10.3 编译中文翻译。中文界面字体依据 `src/app/main.cpp` 的启动选择，使用 Microsoft YaHei UI；代码字体使用原始 Maple Mono Normal NL CN，14pt。浏览器依据相同语言选择字体系列。浏览器能力记录注明 Windows WebKit 的 WebAudio 能力；该端的输入布局使用界面模型，Chromium 与 Firefox 的示例加载使用原生预览。

偏好、预览与音频参考保存完整原生弹窗，`reference.json` 的 `bodyBounds` 记录内容区坐标。浏览器画廊中的 `native-*.png` 按该坐标采样原生画面，保留弹窗背景、控件色彩和文字绘制。主项目与 `editor/` 共用源组件、主题与资源生成脚本；独立目录包含自身的副本。

辅助页面参考由 `tests/native-page-reference.py` 消费固定的共享 QML 模块和翻译包，记录关于页面、难度信息栏、谱师名义管理与书签列表。难度信息栏使用原始 `EditorPane.qml` 的两个源码区域，其余页面使用原始组件。关于页面的应用图标通过同一原始 PNG 解析 qrc 路径，资源哈希记录于 `reference.json`。谱师弹窗的尺寸、控制项边界、Esc 关闭与入口焦点恢复，以及矮窗口的底部抽屉与分析标签纳入布局脚本。像素密度脚本改变实际 DPR；缩放列使用对应的有效 CSS 视口尺寸。

视频导出参考由 `tests/native-export-reference.py` 生成。输出和批量页使用提交 `8770413f965084f2e0567ae44c235b8a34377861`；片头页使用固定上游提交 `ff9f65856b8591589aba0582ac867220202a44c6`，对应 `introPvPreview` 及片头 PV/音乐选段字段。该组件基准采用自身版本的 QML、公共控件、主题与中文翻译，隔离于共享参考模块；`reference.json` 为各页登记组件提交与源码、主题、翻译、会话头文件和字体资源哈希。字体使用上游 Resource Han Rounded CN Heavy/Bold 的完整字形，WOFF2 转换验证字符映射、轮廓与度量，资源清单记录字节数及哈希。

本地入口使用 HTTP/HTTPS。`file://` 入口显示服务启动命令与打开链接；静态网站脚本验证该提示与 `/MiaView_Web/` 子路径下的编辑器、谱面、音乐和 PV 加载。

时间轴参考使用固定上游提交 `ff9f65856b8591589aba0582ac867220202a44c6` 的场景构建器与 QSG 图层，色板沿用 UI 基准 `8770413f965084f2e0567ae44c235b8a34377861`。Qt 6.11.1 的 `QQuickRenderControl` 在离屏纹理上绘制参考，Windows 使用 Direct3D 11；画布截图包含音符、长条、滑动轨迹、标尺与波形。`reference.json` 登记源码哈希与 24 个采样组合；标尺字体沿用原生桥接器的 11pt，页面正文使用既有代码字体配置。

## 1. 验收目标与稳定基准

Stage1 的页面汇总由 `tests/stage1-acceptance.mjs` 生成，记录于 `artifacts/stage1/ui-acceptance.json`。公共工作台与页面组件分别采用对应原生参考的评分；页面继承已显示的公共工作台，以相关组件最低分作为保守页面分数。16 个页面与设置子页等权计算整体分数。布局记录覆盖三引擎的 23 个视口组合，共 621 个页面用例；像素密度与缩放尺寸记录为 120 组。输入区域的原生度量、组合输入、焦点与视口收缩构成独立必过条件。

UI 准确度采用 100 分加权评分：布局 35 分、字体 20 分、色彩 15 分、控件 20 分、图标 10 分。每页得分与总分达到 85 分；关键布局、输入层对齐、可操作区域逐项通过。主编辑器、独立编辑器与独立预览构成三个产品入口，共享视觉基准与对应功能结果。功能验收按主计划清单逐项记录入口、操作和结果。

| 基准 | 固定内容 | 用途 |
| --- | --- | --- |
| MiaCode_v2 | 提交 `8770413f965084f2e0567ae44c235b8a34377861`；本机源码根目录 `D:/STUDY/Project_Work/MiaCode_dev2/MiaCode_v2` | 外观、字段、图标、控件、布局与功能状态 |
| QML 主题 | `src/app/ui/theme/Theme.qml`；`activeThemeToken` 为 `dark`、`light`、`legacy`、`legacy_light` | 色板、排版、间距、圆角、分隔线和难度颜色 |
| 浏览器工作台参考 | [VS Code 官方界面说明](https://code.visualstudio.com/docs/editing/getting-started/userinterface)，记录读取日期 2026-10-13 | 活动栏、主侧栏、编辑区、底部面板、状态栏的浏览器组织 |
| 网页架构 | 原生 HTML/CSS、ES modules、iframe SDK、Qt Quick/WASM/WebGL 2、WebAudio | 实现与运行边界 |
| 构建 | `build-devtools/`，Release | 验收构建的统一来源 |

基准包记录 v2 提交、网页提交、构建身份、浏览器版本、操作系统、可用视口、浏览器缩放、设备像素比例、字体配置、主题、素材哈希和页面状态。参考画面采用 v2 `MainView` 的应用内容范围，网页画面采用对应工作台内容范围；二者使用相同逻辑尺寸。预览固定谱面、难度、素材、设置和显式时间点；弹窗与控件在过渡动画完成后采样。

基准版本变更形成独立记录，写明提交、受影响项和对应参考。每轮迭代引用固定基准编号，评分条目和权重随该基准冻结。

## 2. 页面与状态清单

下表的源码路径均相对于 v2 源码根目录；同组后续文件采用首项的目录。每个页面继承所显示的公共工作台、公共控件和主题条目，页面内的标签与设置子页分别登记。三个产品入口分别展开适用页面清单，每个入口的页面形成独立评分记录。

| 页面或区域 | QML 依据 | 必验状态 |
| --- | --- | --- |
| 欢迎页与主工作台 | `src/app/ui/layout/WelcomePage.qml`、`MainView.qml`、`MainSplitView.qml`、`CompactPanelLayer.qml`；`src/app/ui/chrome/MainToolBar.qml`、`MainMenu.qml`、`StatusBar.qml` | 欢迎内容；文档打开；菜单展开；侧栏与底部面板展开/折叠；左右交换；分栏边界 |
| 活动栏与谱面侧栏 | `src/app/ui/sidebar/ActivityBar.qml`、`Sidebar.qml`、`ChartFieldSidebar.qml`、`DifficultyList.qml` | 活动项选择；多难度；长字段；分组展开/折叠；难度颜色；抽屉 |
| 谱面编辑器 | `src/app/ui/editor/EditorPane.qml`、`SourceEditor.qml`、`EditorTabBar.qml`、`FindReplaceBar.qml`、`CompletionPopup.qml`、`BookmarkList.qml` | 多标签；编辑与选区；行号；换行；滚动；查找替换；补全；书签；中文组合输入；诊断装饰 |
| 元数据与难度设置 | `src/app/ui/editor/EditorPane.qml`、`DesignerSlotsDialog.qml`；`src/app/ui/components/DifficultySelector.qml` | `metadata` 标签；`title`、`artist`、`first`、谱师、等级、扩展字段；封面与视频素材；长文本 |
| 时间轴与分析 | `src/app/ui/timeline/BottomPanel.qml`、`BottomTabBar.qml`、`TimelineZoomMenu.qml`、`TimelineBrightnessMenu.qml` | 时间轴/分析切换；波形；播放指针；缩放与滚动；空结果、检测中与结果列表；定位 |
| 工作台预览 | `src/app/ui/preview/PreviewPane.qml`、`PreviewTransport.qml`、`NoteStatistics.qml`、`PreviewCanvasMenu.qml` | 载入；播放/暂停/停止；跳转；区间；倍率；统计；画布比例；左右交换；预览设置 |
| 独立编辑器 | 与主编辑器相同的工作台、编辑器、功能页和公共组件 | 对应主编辑器的全部页面、状态与创作流程；隔离部署后的入口、资源与配置 |
| 独立预览与嵌入 | 工作台预览的公共控件；主计划的独立预览布局规格 | 方形、横向、竖向、矮容器；难度选择；播放与设置；全屏；连续缩放 |
| 预览与音频设置 | `src/app/ui/preview/PreviewSettingsDialog.qml`、`PreviewAppearancePages.qml`、`AudioSettingsDialog.qml`、`PreviewRenderModeMenu.qml` | 各设置子页；滑块、开关、选择器；皮肤、背景、音量与音效；弹窗滚动 |
| 偏好与快捷键 | `src/app/ui/preferences/PreferencesDialog.qml` | 布局、四种主题、字体、编辑选项、快捷键页；设置滚动；快捷键录入；配置恢复 |
| BPM 与延迟 | `src/app/ui/latency/LatencyPage.qml` | `latency` 标签；BPM、`clockCount`、`offsetSeconds`；检测、试听、波形和字段回写 |
| 编写辅助 | 编辑器菜单与补全组件 | Touch 编写；变换命令与撤销结果 |
| 视频导出 | `src/app/ui/export/ExportVideoPage.qml`、`ExportRangeSelector.qml`；`src/app/ui/sidebar/ExportSidebarPage.qml` | 难度；输出参数；区间；片头；批量列表；任务进度；取消；完成结果 |
| 封面编辑与导出 | `src/app/ui/export/CoverExportPage.qml`、`CoverLayerList.qml`、`CoverExportWindow.qml` | 图层增删与顺序；图像、文字、谱面卡片；属性；预设；布局导入/保存；输出 |
| 公共弹窗与任务提示 | `src/app/ui/components/AppDialog.qml`、`ChoiceDialog.qml`、`AboutDialog.qml`、`JobProgressOverlay.qml`、`Tooltip.qml` | 标题与按钮；内容滚动；确认；焦点；进度与消息；边缘定位 |

页面记录复用 `activeEditorKey`、`openEditorTabs`、`editorHistory`、`activeSidebarView`、`sidebarVisible`、`bottomPanelVisible`、`compactPanel` 和 `activeDifficultyId`。布局记录复用 `sidebarWidth`、`previewWidthRatio`、`bottomPanelHeightRatio`、`previewOnLeft`、`previewCanvasFreeAspect`。标签沿用 `difficulty:<id>`、`metadata`、`latency`；文档与 SDK 的字段映射采用主计划中的同名接口。

## 3. 参考布局与浏览器适配

参考布局按 v2 的主题、组件最小尺寸与偏好计算几何。`EditorPane.minimumWidth` 为 384；`MainSplitView.minimumWorkspaceWidth` 依据编辑区、预览区及分隔线计算，基础下限为 620；侧栏空间单独计入。分栏目标采用 `sidebarWidth`、`previewWidthRatio`、`bottomPanelHeightRatio`，比较时使用相同配置与容器。

浏览器适配按可用内容尺寸选择布局。尺寸落在 v2 并列布局可容纳范围时，使用参考布局计分；空间达到折叠条件时，使用下表的适配规格计分，同时保留 v2 的内容、字体、色彩、控件与图标评分。每项适配记录触发尺寸、入口、焦点路径、滚动区域和恢复状态。

| 尺寸条件 | 适配规格 | 验收依据 |
| --- | --- | --- |
| 宽度容纳各面板最小尺寸 | 活动栏、侧栏、编辑区、预览并列；底部面板归属编辑区 | v2 分栏几何与布局偏好 |
| 宽度达到侧栏折叠条件 | 侧栏使用抽屉；工具入口保留在顶部或活动入口 | `CompactPanelLayer.qml` 的侧栏组织与浏览器入口规格 |
| 宽度达到编辑/预览切换条件 | 编辑区与预览使用同一区域切换；两者保留独立滚动、选区和播放状态；预览入口可操作 | 固定适配布局图与状态表 |
| 高度达到底部面板折叠条件 | 时间轴/分析使用可展开面板；编辑内容和播放控制保留空间 | 固定适配布局图与展开后最小可用高度 |
| 窄屏弹窗、菜单和设置 | 内容限制在可用视口；设置内容滚动；操作按钮可到达；靠边菜单调整展开位置 | 弹层边界、内容滚动与键盘焦点 |
| 独立预览与嵌入容器 | 按实际容器宽高拟合舞台；播放区按内容换行；方形与 16:9 画面保持比例 | 容器布局规格、同一 SDK 的画布变换 |

适配断点由组件最小尺寸和实际控件宽度推导，记录确切数值。浏览器缩放使用变化后的可用 CSS 尺寸。舞台尺寸扣除标题、播放控件、统计及必要间距，控制区高度采用实际布局值。

| 矩阵 | 必验样本 |
| --- | --- |
| 窄屏与竖屏 | 320×568、360×800、390×844、768×1024、1080×1920 |
| 小窗口与矮屏 | 640×360、800×600、1024×600、1280×720 |
| 桌面与超宽 | 1366×768、1920×1080、2560×1080、2560×1440、3440×1440 |
| 浏览器缩放 | 50%、75%、100%、125%、150%、200% |
| 设备像素比例 | 1、1.25、1.5、2、3 |
| 浏览器 | 验收时的稳定版 Chrome、Edge、Firefox、Safari；登记版本及运行系统 |
| 独立容器 | 320×320、640×360、360×640、800×240、1280×720；方形与 16:9 画面；连续缩放 |
| 状态组合 | 侧栏与底部面板展开/折叠、左右交换、分栏极限、长标题、多标签、主题、菜单和弹窗 |

布局用例覆盖全部尺寸及断点前后各 1 CSS px。视觉评分在各页面的必验状态覆盖桌面、窄屏、矮屏、四种主题和 100%/200% 缩放；字体与输入对齐补充其余缩放和设备像素比例。组合矩阵记录页面、状态和运行配置，公共布局变更复验全部页面的相关组合。

## 4. 100 分评分办法

测量单位为 CSS px，参考 QML 逻辑像素在相同逻辑尺寸下映射为 CSS px。截图设备像素按设备像素比例换算；文字与图标测量边界、基线和中心。每个采样配置形成一份 100 分评分表。

每个评分条目在基准包列出观测点及数量，同一条目内观测点等权。数值型观测点的误差在满分容差内取 1，介于满分容差与其两倍之间取 0.5，其余取 0；具有多项数值的观测点使用最低系数。类别、顺序、字段、图标身份及状态规则相符取 1，其余取 0。条目得分为“条目分值 × 观测点系数平均值”，页面配置得分为全部条目之和，保留两位小数，门槛判断采用原始数值。

各条目按固定角色列表抽样：布局覆盖所显示区域的四边、中心、分栏与滚动口；字体覆盖页标题、分组标题、正文、辅助文字、数值、代码和行号；色彩覆盖各语义角色；控件覆盖该页所用组件类型及必验状态；图标覆盖可见命令。公共工作台计入该页。相同类型的重复行依据基准固定首行、中间行、末行，按角色等权统计。

### 布局：35 分

| 条目 | 分值 | 观测内容 | 满分容差 |
| --- | ---: | --- | --- |
| 区域组织与顺序 | 10 | 活动栏、侧栏、编辑标签、正文、预览、底部面板、状态栏；功能页分组与弹层；适配入口 | 区域、顺序、归属、展开状态符合对应规格 |
| 面板边界与分栏 | 10 | 区域四边、标题高度、分栏位置、左右交换、预览中心 | 面板边界 ≤1；分栏比例换算后的尺寸误差 ≤2 |
| 间距与对齐 | 8 | 面板内边距、标题与内容、字段标签、行间距、按钮组、图层列表 | 位置、间距与对齐误差 ≤2 |
| 内容与滚动区域 | 7 | 标签溢出、长文本、设置页、列表、弹层、舞台拟合与播放区高度 | 滚动口和内容边界误差 ≤2；换行、截断与滚动归属符合规格 |

### 字体：20 分

| 条目 | 分值 | 观测内容 | 满分容差 |
| --- | ---: | --- | --- |
| 字体与字形 | 4 | `uiFontFamily`、`codeFont`、中文、英文、数字与符号 | 字体映射与字形符合固定基准；代码字符使用对应等宽度量 |
| 字号与字重 | 6 | 正文 13；标题 `uiFontSize + 2`；分组标题 `sectionTitleFontSize`、`sectionTitleFontWeight`；辅助文字 `uiFontSize - 1`；紧凑文字 `uiFontSize - 2` | 字号误差 ≤0.5；字重映射符合基准 |
| 行高与基线 | 6 | 标签、输入框、菜单、数值、代码、行号；`editorBlockSpacing` | 单行基线误差 ≤1；行高误差 ≤0.5；整屏累计误差 ≤1 |
| 文本宽度与呈现 | 4 | 固定中文/英文文本、代码字符、字段值、标题、长路径 | 文本宽度误差 ≤2%；可见文本、换行和省略方式符合规格 |

### 色彩：15 分

| 条目 | 分值 | 观测内容 | 满分容差 |
| --- | ---: | --- | --- |
| 主题语义颜色 | 7 | `colors.background`、`border`、`text`、`accent`、`scroll`、`previewHud`；每个角色等权 | 红、绿、蓝单通道误差 ≤3/255；透明度误差 ≤0.02 |
| 控件与状态颜色 | 5 | `toggle`、`slider`、`state`、`listState`、`activityState`；悬停、按下、选择、焦点、禁用、文字选区 | 同上；颜色角色和状态对应基准 |
| 难度与编辑色彩 | 3 | `difficultyColors`、`difficultyColorFallback`；编辑正文、行号、高亮和诊断 | 同上；难度及语义映射符合基准 |

颜色以声明值与固定背景下的合成色核对，采样采用角色代表点。面积和背景像素数量在各观测点中使用相同权重；页面评分由上述角色、布局、文字、控件和图标条目形成。

### 控件：20 分

| 条目 | 分值 | 观测内容 | 满分容差 |
| --- | ---: | --- | --- |
| 尺寸与内边距 | 6 | `AppButton`、`AppTextField`、`AppComboBox`、`AppCheckBox`、`AppSwitch`、`AppSlider`、菜单、标签、滚动条 | 高度、宽度与内边距误差 ≤1；标准最小高度 30、紧凑高度 24 |
| 边框与圆角 | 4 | 常规圆角 8、紧凑 6、小控件 5、弹层 16、工作区 14；边框 1 | 圆角误差 ≤1；边框宽度误差 ≤0.5 |
| 状态呈现 | 5 | 常态、悬停、按下、焦点、选择、禁用、展开、检测中与任务进度 | 文本、标记、启用状态、进度和状态转换符合基准 |
| 控件内容与交互位置 | 5 | 标签、值、单位、下拉项、滑块端点、菜单锚点、弹窗按钮、滚动条 | 内容与对应命令相符；内容及锚点误差 ≤1 |

### 图标：10 分

| 条目 | 分值 | 观测内容 | 满分容差 |
| --- | ---: | --- | --- |
| 图标身份与状态 | 6 | 活动栏 `file`、`export`、`settings`；播放、暂停、停止、区间、预览设置；各页命令；实心/描边状态 | 对应同一 v2 SVG 或相同路径；图标、命令、方向与状态相符 |
| 图标尺寸 | 2 | 活动栏 22；品牌图标 17；`IconButton` 常规 16、紧凑 14；页面组件声明的尺寸 | 可见边界误差 ≤1 |
| 图标位置与着色 | 2 | 中心、文字间距、难度色块、选中图标颜色 | 位置误差 ≤1；色彩使用对应主题角色及色彩容差 |

图标文件路径与哈希记入基准包，页面显式设置的图标尺寸优先于组件默认值。主题间距同样以所在组件声明为依据：`panelPadding = 8`、`dialogPadding = 16`、`settingsRowSpacing = 10`、`settingsLabelSpacing = 4`、`workspaceHeaderHeight = 34`、`activityButtonSize = 48`、`splitDividerThickness = 1`、`splitHandleHitExtent = 9`。

每页得分取该页全部必验配置得分的最低值；每个产品入口的总分为其页面得分的等权平均值；三个入口的整体总分取各入口总分的等权平均值。每页、各入口总分及整体总分均 ≥85，连同三组必过条件，构成 UI 完成条件。各分项得分与观测值同时保存，支持按相同基准计算复核结果。

## 5. 独立必过条件

必过条件采用逐项通过记录，评分表同时保留各项结果。

| 条件 | 通过标准 | 必验样本 |
| --- | --- | --- |
| 关键布局 | 每个区域边界位于所属容器；相邻面板边界误差 ≤1 CSS px；菜单、弹窗与控制区位于可用视口；文本和列表具备规定滚动；窄屏入口可达；画面比例误差 ≤0.5%；舞台、PV、HUD 与操作坐标共用变换 | 全部尺寸、缩放、分栏边界、左右交换、弹层边缘、连续缩放 |
| 输入层对齐 | 输入层、绘制文字、行号、光标、选区和诊断装饰共用字体与滚动坐标；基线与光标误差 ≤1 CSS px；单屏顶部/中部/底部累计误差 ≤1；点击字符位置、中文组合输入与换行结果对应正文位置 | 全部缩放与设备像素比例；长行、自动换行、中文组合输入、选区、查找、补全、横向/纵向滚动 |
| 可操作区域 | 显示的按钮、标签、输入框、滑块、菜单与图层操作可由鼠标或触控到达；命中区域覆盖控件可见范围；分隔线命中宽度 ≥9 CSS px；Tab 焦点顺序与视觉顺序对应；弹层关闭后焦点回到入口；主要确认和取消操作可到达 | 窄屏、矮屏、200% 缩放、虚拟键盘、靠边菜单、滚动弹窗、分栏拖动 |

主编辑器、独立编辑器、独立预览与嵌入示例的 SDK 和公共模块来自同一权威源码，生成包的公共文件版本、哈希及构建身份同步。使用相同 `maidata`、`audio`、`cover`、`video`、`difficulty`、`currentTime`、`settings` 和 `resolution` 验证画布与状态；操作链路沿用 `createPreview()`、`load()` 和主计划中的控制及事件接口。

## 6. 阶段验收

| 阶段 | 验收对象 | 完成条件与记录 |
| --- | --- | --- |
| 前置可运行雏形模板 | 入口、工作台框架、编辑区域、iframe 预览、播放控制、共享主题和 SDK | Release 构建运行；固定谱面完成载入与基础播放；布局状态和页面入口可操作；基准包、页面清单和评分表具备复核数据；模板组件持续用于正式工作台 |
| Stage1 UI | 页面清单、公共控件、四种主题、浏览器适配 | 每页与总分 ≥85；三组必过条件逐项通过；页面、状态和矩阵结果归档 |
| Stage2 功能 | 主计划功能清单与完整创作流程 | 各入口完成相应业务结果；字段、文档、保存、分析、播放与导出按主计划逐项通过；业务状态变化对应的页面得分 ≥85，必过条件通过 |
| Stage3 预览优化 | 音符、轨迹、效果、HUD、PV、播放同步与性能 | 同谱面、设置、时间的画面及同步达到主计划标准；公共预览采用共同规则；受影响页面复验 ≥85，必过条件通过 |
| Stage4 独立编辑器与独立预览拆分 | 主编辑器原入口；`editor/` 独立编辑器；`preview/` 独立预览；公共源码和生成规则 | 三个产品入口分别通过布局、功能与视觉验收；两个独立子项目自包含；隔离安装、构建与运行通过；公共文件版本与哈希同步；页面、状态与功能结果符合既有基准 |

雏形模板至 Stage3 沿用根目录的 `sdk/`、`renderer/`、`native/`、`backend/`。Stage4 的主项目 `app.mjs`、`page.css`、`ui/`、`services/` 与现有运行目录继续服务主入口。从主项目的同一权威源码复制或生成 `editor/` 与 `preview/`；复制模块保留主文件名和字段，公共算法、接口与视觉规则共用。

功能结果使用 v2 的字段、命令和相同输入对照；UI 分数与功能结果分别记录。页面入口、核心编辑、保存、解析、播放和导出共同形成验收结果。

### Stage4 自包含与隔离验收

| 验收项 | 通过标准与证据 |
| --- | --- |
| 子项目文件范围 | `editor/` 和 `preview/` 各自包含代码、SDK、renderer、WASM、UI、主题、图标、媒体、配置、构建入口和依赖清单；记录完整文件清单和哈希 |
| 上游与依赖 | 源代码构建读取子项目内固定提交的上游源码及自身依赖配置；依赖安装进入对应子项目；登记固定提交、依赖版本和构建命令 |
| 引用解析 | 运行、构建和打包使用的项目文件及依赖引用在解析、规范化和链接目标解析后均处于对应子目录；登记脚本、导入、资源、配置和构建输入的解析结果 |
| 权威源码同步 | 公共源文件与接口从主项目复制或生成；三个入口的公共文件版本、哈希与构建身份一致；生成清单记录源文件、生成文件及版本关系 |
| 外部隔离安装与构建 | 单独复制一个子文件夹到固定外部隔离目录，仅以该子项目为工作目录执行自身安装和 Release 构建；构建目录为其内部 `build-devtools/`；记录绝对目录、命令与产物 |
| 隔离加载与入口 | `editor/`、`preview/` 分别加载入口、资源、主题、图标、媒体和 WASM；域名根路径与项目子路径均可运行；记录资源请求的解析路径 |
| 隔离功能与视觉 | 独立编辑器复验主编辑器适用的页面及完整创作流程；独立预览复验加载、播放、跳转、难度、设置、事件与销毁；每页和入口总分 ≥85，三组 UI 必过条件及对应功能用例通过 |

两个子项目分别形成隔离验收记录，主编辑器按原入口完成相同基准的复验。三个产品入口的适用功能结果、公共文件哈希和视觉得分共同形成 Stage4 验收依据。

## 7. 迭代与复验记录

实现阶段按“固定配置采样 → 标注观测值 → 计算评分和必过条件 → 修改对应公共组件或页面 → 复验受影响组合”的循环迭代。迭代沿用当前基准、字段和公共接口，记录变化与测量结果。

| 记录项 | 内容 |
| --- | --- |
| 迭代身份 | 日期、轮次、阶段、产品入口、基准编号、网页提交或工作树差异身份、Release 构建身份 |
| 受影响范围 | 修改文件、公共组件、页面、子页、状态、尺寸、主题和关联功能 |
| 采样配置 | 浏览器与系统版本、视口、缩放、设备像素比例、字体、主题、布局偏好、素材哈希、固定时间 |
| 对照证据 | 参考画面、网页画面、关键区域、几何观测表、颜色声明、图标路径、交互结果 |
| 评分 | 布局/字体/色彩/控件/图标分值、配置分数、页面最低分、各入口总分、整体总分、三组必过条件结果 |
| 修正与复验 | 对应观测点、修改原因、修改前后测量值、复验配置、关联功能结果 |
| 阶段结论 | 通过条目、验收依据、基准变更记录及阶段产物 |

布局和字体改动复验全部受影响页面、缩放、断点与输入对齐；主题改动复验四种主题和全部相关状态；公共控件改动复验使用该控件的页面；预览或 SDK 改动复验主编辑器、独立编辑器、独立预览及嵌入示例；子项目生成规则改动复验三个产品入口、两份子项目的隔离安装与构建、资源路径及公共文件哈希。记录保留相同观测点的修改前后数据，以差异定位复验范围。

每轮结果写入连续记录，页面清单与功能清单共用现有页面和命令标识。达到门槛的页面仍参与公共变更对应的复验，阶段验收使用该阶段最终构建的结果。

## 8. 执行与授权规则

验收构建统一使用 `build-devtools/` 和 Release。代码提交与推送前按工作区规则检查差异、潜在问题、格式，并按风险完成相应构建和测试。

布局、视觉和交互测试按用户授权的页面、浏览器和操作范围执行；记录授权范围与验收结果。读取源码、字段、接口、样式和构建信息采用 API、连接器、CLI 或文件工具。Computer Use 操作需要说明必要性、目标应用与页面、操作范围，并取得用户的明确同意。

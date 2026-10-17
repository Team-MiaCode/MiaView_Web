# Stage2 功能接入记录

记录日期：2026-10-16。工作分支：`feature/web-editor-migration`。命令与验收入口见 [工作台命令清单](WEB_EDITOR_COMMANDS_ZH.md)。

## 阶段验收与提交审阅

Release 构建、104 项 Node 用例及 SDK 严格类型检查通过。Chromium 的 32 项与 Firefox 的 19 项功能验收通过，清单覆盖目录导入、编辑保存、素材、分析、设置、封面、片头、单视频导出和分离窗口；逐项日志与源码指纹记录于 `artifacts/stage2/<browser>/results.json`。视频导出页面提供输出和片头两个标签。

界面回归通过 621 项布局、120 项显示密度组合、8 组原生编辑指标及中文组合输入验证。视觉评分整体为 91.4375%，最低页面为 89%。外部目录中的编辑器副本和 `/MiaView_Web/feature/` 静态路径通过入口、弹窗、音乐与 PV 播放验证。

提交审阅覆盖文档代数与保存点、异步资源事务、窗口所有权、原生封面播放时钟、视频画面几何、编码任务释放、公共类型、产品同步和部署门槛。功能验收运行时为 `miaview-web-2-f4350191cdf9`；文件尾部格式整理后的发布运行时为 `miaview-web-2-bc0d2ad434cf`，WASM SHA256 保持 `fe48ad5c6e4646985faaf954c02610ecdd2eb249c36a57457c32be634c6aac89`。格式整理后通过 Node、类型、Chromium/Firefox 快捷键、外部副本及 feature 路径复验，记录于 `artifacts/stage2/format-followup.json`。

## 文档字段

文档所有者沿用固定上游的 `ChartWorkspace`。谱师名义管理使用 `document.applyDesignerSlots`，支持分难度名义、统一名义广播与模式切换。`clock_count` 按上游的大小写规则读取，并在扩展字段修改后保留。`wholeBpm` 从 `wholebpm` 扩展字段读取，供 BPM 补全使用。

`tests/document-fields-smoke.mjs` 通过真实管理窗口验证字段写入、窗口持续操作、统一名义、独立名义和扩展字段保存；主入口与 `editor/` 使用相同接口。

## 编辑事务与编写辅助

`native/editor-bridge.cpp` 接入固定上游的 `EditorController`、`SimaiTextEditPolicy`、`SimaiCompletionCatalog`、`TouchPadAuthoringEdit`、`BookmarkCommentSyntax`、`ChartBatchTransform` 和 `ChartSelectionBeatSummary`。SDK 的 `editorCommand()` 返回文本替换范围、替换内容、UTF-16 选区及补全状态。浏览器输入缓冲应用事务，通过文档公共接口更新原生所有者。文档写入携带 documentOpenGeneration 与难度标识；文档切换重置原生补全会话。保存、切换与撤销等待输入队列完成。

| 功能 | 命令与实现 | 验证 |
| --- | --- | --- |
| 半角输入、括号配对、换行 | `edit.processKey`；输入队列消费原生文本策略 | 全角标点、配对删除、右括号跳过、选区替换 |
| 时值与 BPM 补全 | `edit.acceptCompletion`、`edit.selectCompletionIndex`、`edit.updateCompletion` | 候选顺序、键盘选择、确认位置、闭合字符、`wholeBpm` |
| Touch 编写 | `edit.touchPadAuthoring` | 空拍插入、已有触摸切换、指令后的插入位置 |
| 书签 | `edit.createBookmark`、`edit.renameBookmark`、`edit.deleteBookmark` | 行偏移、标题写入、侧栏导航；控制注释按上游规则处理 |
| 选区变换 | 上游 `transform.*` 标识 | 镜像、旋转、Break 切换、完整元素清空与选区上下文 |
| 选区拍数 | `edit.selectionBeats` | 细分拍分组、逗号计数、状态栏结果 |
| 撤销与难度缓冲 | `services/text-history.mjs` | 难度间撤销记录、选区与滚动；批量编辑与组合输入按事务撤销 |
| 查找替换 | `services/text-search.mjs`、现有 `edit.findNext/findPrevious/replaceAndFind/replaceAll` | Unicode、大小写、全词、边界循环、字面替换与批量撤销 |

`tests/editor-core-smoke.mjs` 验证 33 次 SDK 调用及工作台键盘补全、快速输入、难度切换、书签窗口、状态栏拍数、查找替换和文档正文同步。`tests/editor-ime-smoke.mjs` 验证中文组合输入、标点半角转换、单次撤销、光标和窄屏输入对齐。

构建采用 `build-devtools/`、Release 与 4 个编译任务。运行时版本记录于 `renderer/build-identity.json`，上游提交为 `ff9f65856b8591589aba0582ac867220202a44c6`。编辑区视觉验证保留 8 个与原生行高、边距及字体相符的样本。

## 文件保存与恢复

浏览器文件服务保留目录文件清单和文件句柄，写入经 createWritable/write/close 提交。原生保存点使用写入时捕获的 sourceText，保存期间输入保留对应脏状态。保存请求按顺序执行。

ProjectStore 使用 IndexedDB 保存谱面、保存点、素材、文件句柄和编辑标签。编辑后采用两秒自动保存，页面隐藏与关闭时写入恢复记录。最近项目入口、恢复入口和关闭提示接入同一项目记录。

tests/project-files-smoke.mjs 使用真实 OPFS 目录和文件句柄验证分段保存、保存期间输入、保存全部、取消另存为、刷新恢复、保存期间切换项目以及关闭确认；tests/browser-files.spec.mjs 验证目录遍历、提交、取消与写入失败。

## 语法检查与无理分析

getAnalysis 通过 WASM 调用上游 SimaiParser、MuriAnalyzer、MuriStaticChecker 与 MuriPanelEntries，返回带文档代数、版本和难度的行数据。工作台在编辑后 180 毫秒接入分析结果，行激活按版本定位源码；无理结果同时定位播放时间。

tests/analysis-core-smoke.mjs 验证错误谱面打开、中文与英文诊断、语法位置、无理条目、播放定位及难度切换。主项目和 editor 副本通过同一验证。

## 预览参数与触区编写

`preview.values` 将亮度、布局比例、流速、叠放顺序、判定效果、中心显示、判定文字距离、皮肤、判定线和暂停显示选项映射到原生场景字段。SDK 使用同一 `setSettings` 接口，原生宿主在参数校验后更新场景。偏好配置保存到浏览器本地存储，尺寸切换和刷新恢复对应值。

触区输入使用上游场景几何、触区命中和手势事务，事件携带文档代数及难度。Ctrl 点击切换触摸，Ctrl+Shift 点击插入同时触摸，Ctrl 右键插入新拍。事件仅在对应源码编辑标签激活时应用。方形和自由比例画布共用逻辑坐标；Qt 窗口的显示尺寸与调用者画布尺寸一致。

`tests/preview-settings-core-smoke.mjs` 验证原生画面变化、21 个参数、流速范围、参数校验、尺寸切换与刷新恢复。`tests/touch-authoring-smoke.mjs` 使用鼠标操作验证三种浏览器比例、方形与自由比例画布、触区切换、同时触摸、右键新拍、离开触区取消及按压期间文档切换。

## 音频通道

音量和静音语义复用上游 `PreviewAudioSettings`。`audioCommand` 返回各通道百分比、静音状态、原生配置与音效种类的有效增益。WebAudio 将音乐、判定音效、Touch Hold 持续音送入对应增益节点，参数更新作用于播放中的音源。Break 星形尾部静音使用上游时间线聚合规则生成的音效序列。

音频设置页面支持 11 个通道、静音恢复、设置本地默认值和恢复默认值。`tests/audio-settings-core-smoke.mjs` 验证原生默认值、全部通道的百分比与静音恢复、全局静音联动、输入校验、本地配置刷新恢复、WebAudio 输出采样与播放期间尾部静音切换。

## 素材替换接口

SDK 的 `setResources` 按 `audio`、`cover`、`video` 更新素材，`null` 对应移除素材。解码阶段保留活动素材，全部输入就绪后提交替换。音乐更新重建波形，PV 更新保留播放时间和倍率；替换释放对应的旧 Blob URL。原生文档代数、版本、编辑正文、难度和保存点沿用当前文档。

`document.metadataVideoPath` 使用上游 `ChartWorkspaceDocumentField::VideoPath` 写入 `&video`。`tests/resources-core-smoke.mjs` 验证真实素材解码、波形、播放期间替换、批量解码失败时的原素材、文件保存点、PV URL 释放、素材移除和视频字段序列化。

## 工程素材与保存

工作台的封面、PV 和音乐入口使用 `setResources`。素材按现有资源命名关系进入项目文件清单，替换和移除生成对应的 `_bak` 备份。`&video` 使用解析后的字段，在上传目录内解析相对路径；显式路径优先，默认命名提供回退。

资源修改参与工程脏状态及元数据标签提示，记录保留素材路径、待写入项和保存点。保存全部将资源写入目录，在谱面提交后清理替换项。目录写入后刷新文件快照，播放资源接入保存后的文件。另存为选择目标目录，复制文件树、素材与谱面；浏览器下载路径输出包含完整文件树的 ZIP。

磁盘原文与解析后的保存点分别记录。刷新恢复沿用媒体、待写入项和相对路径，文件内容变动提示依据磁盘原文；正文保存点复用原生文档模型。

`tests/project-media-smoke.mjs` 验证工作台按钮、显式 PV 路径、备份、目录提交、取消移除、完整工程另存为、待保存素材刷新恢复和 ZIP 下载。Python `zipfile` 验证下载文件的目录、CRC 与载荷。`tests/project-files-smoke.mjs` 包含目录另存为期间输入、后续保存、附属文件复制及保存期间项目切换。

## BPM 与延迟校准

BPM 和偏移检测消费固定上游 `LatencyAnalysis` 的起音包络、瞬态包络、拍号与偏移算法。浏览器通过 WebAudio 解码，将各声道平均为单声道，以 24000 Hz 向原生桥传入样本；包络按音乐对象缓存。BPM、`first` 和 `clock_count` 写入现有文档字段。

试听使用上游 `LatencyTestChartBuilder` 生成节拍场景，支持 1/4、1/8、1/16。页面切换恢复真实谱面，试听场景保留原生文档和保存点。播放中修改节拍、偏移、细分与判定音量沿用音乐时钟，音乐音源持续播放；试听音量复用上游 `makePreviewLatencyAuditionLevels`。

`tests/latency-core-smoke.mjs` 验证检测、文档写回、试听、播放期间调整、恢复场景和三分钟音频。`tests/latency-reference/` 通过 Qt Core 与上游 BASS 解码器构建命令行基准，输出记录于 `tests/fixtures/latency-reference.json`；样本 SHA256、BPM、拍号和偏移与浏览器结果对应。构建目录采用 `build-devtools/latency-reference/`，配置采用 Release。

## 从音频读取信息

`readAudioInfo` 复用上游 `Id3TagReader`，读取标题、艺术家、专辑及内嵌图片。原生图像接口将封面转换为 JPEG。工作台的“读取音频信息”入口选取文件、应用非空字段，封面替换经确认进入工程素材事务和备份清单。

`tests/audio-info-core-smoke.mjs` 验证 ID3v2.3/v2.4、Latin-1、UTF-8、UTF-16、UTF-16BE、扩展头、内嵌封面转换、替换确认、截断标签和封面解码失败。读取 SDK 接口与文档修改接口分别消费对应的原生所有者。

## 快捷键

快捷键沿用 25 个现有命令标识与默认序列。`normalizeShortcuts` 消费上游 `InputShortcutGesture`，返回 Qt 键值、修饰键、滚轮方向及显示文本；`setInputShortcuts` 将绑定接入预览 iframe，`shortcutInput` 事件经 SDK 会话回传宿主。工作台在来源编辑区、时间轴与预览区按命令上下文触发操作。

偏好页面支持录制、取消、清除、单项恢复和全部恢复，设置保存于本地 `shortcuts` 字段。配置事务按请求顺序应用。编辑器变换、覆盖输入、字号、播放控制、倍率、时间轴缩放和按住显示判定区复用现有命令；按住显示通过原生暂停判定线选项与临时按压状态计算。

`tests/shortcuts-core-smoke.mjs` 验证键盘与滚轮输入、编辑变换、播放和预览区键盘路由、录制、刷新恢复、清除与重置；`tests/shortcuts.spec.mjs` 验证 Qt 键值转换、加号键及滚轮修饰键匹配。

## 应用背景与字体素材库

应用背景的默认值、透明度、模糊、面板遮罩、缩放模式及位置消费固定上游 `AppBackgroundSettings`。背景图片使用浏览器解码，CSS 图层承载图片和材质遮罩。`PreferenceAssets` 将图片与字体保存到 IndexedDB；本地偏好保留对应设置和显示名称。图片替换在解码与存储提交后生效，刷新恢复原素材，清除释放 Blob URL。背景参数事务按调用顺序合并。

`importFont` 将 TTF/OTF 字节导入原生字体库，文件路径按内容 SHA256 和字体格式确定，字体解析与注册复用上游 `previewHudFontFamilyForFile`。`hudFontPaths` 对应 `chart_info`、`timestamp`、`center_display`、`object_stats`、`debug_info` 五个区域；选择、还原和刷新恢复保留其他区域的配置。工作台字体样例通过 FontFace 消费同一文件，字体按工作台实例释放。

`tests/preferences-core-smoke.mjs` 验证原生默认值与范围、五种背景缩放、图片透明度、模糊、材质开关、替换失败、存储恢复、五区域 HUD 字体、画面变化、单区还原、非法字体和内容去重。应用字体状态与背景状态沿用偏好和公共预览接口。

## 编辑器滚动与概览标尺

`editorScrollPastEnd` 控制末行下方的滚动空间，`editorOverviewRulerEnabled` 控制概览标尺。标尺显示当前位置、书签及语法诊断，支持点击、拖动、方向键与 Home/End；源码装饰层和输入层共用尺寸与滚动坐标。`editorInputHandlingMode` 沿用三个值：全角更正、拉丁键盘提示与全角更正、保留输入字符。键盘松开后清理临时键码，后续输入事件按自身字符处理。

`tests/editor-preferences-smoke.mjs` 验证滚动空间、标尺书签、定位和键盘操作、显示开关、输入提示和字符模式；中文组合输入沿用 `tests/editor-ime-smoke.mjs` 验证。

## 性能偏好与视频呈现

性能页面沿用 `canvasFrameRateMode`、`stageMediaFrameRateMode`、`timelineFrameRateMode` 和 `videoDecodePrefersSoftware`。帧率模式对应 30、60、120 FPS 与显示器刷新率。SDK `setPerformance` 控制预览画布、PV 显示与解码偏好；宿主时间轴使用独立的播放时钟更新指针。配置事务按请求顺序应用，成功后持久化；刷新、分离预览和视频导出消费同一配置。

浏览器视频提供硬件选项的解码路径，软件选项使用 Mediabunny `VideoSampleSink` 的 `prefer-software` 配置。帧游标保留当前帧与下一帧，连续播放复用解码器，跳转重建游标，帧尾按末个视频包的时间定位。文件的色彩元数据作用于软件解码输出；像素缓冲按尺寸复用。普通 PV、片头、封面 PV 与视频导出共享这组取帧规则。接口依据见 [Mediabunny 视频数据接收器](https://mediabunny.dev/guide/media-sinks)。

PV 使用独立显示层按所选帧率呈现，画布与时间轴的刷新时钟分别运行。`getState().videoPresentation` 返回解码路径、已呈现帧数和源帧时间；封面场景补充请求时间、等待状态与拒收帧数。媒体源关闭时释放解码器、视频帧与媒体 URL；解码库的共享工作线程代码 URL 随渲染文档持有。

PV 的填充、适应、方形适应及内圈适应模式从原生 `PreviewSceneGeometry` 读取位置，实时画面与编码文件共用绘制入口。内圈裁切沿用原生的 96 段边界，尺寸与比例由原生渲染设置决定。隐藏 PV 时恢复封面对应的图像媒体状态。`tests/video-geometry-smoke.mjs` 比较原生封面与相同视频帧的像素，覆盖四种模式、方形/横向/纵向/自由画布和两种解码路径。

`tests/performance-core-smoke.mjs` 覆盖性能页、播放期间连续配置、解码偏好、PV 像素、画布、PV 与时间轴刷新、配置恢复和解码资源释放。`tests/performance-settings.spec.mjs` 与 SDK/控制器用例验证字段、范围、协议和片头试听期间的设置事务。封面、片头与文件导出脚本通过 `MIACODE_SOFTWARE_VIDEO=1` 验证软件路径。

## 异步状态验收

`tests/helpers/wait-async.mjs` 等待浏览器异步条件返回真值，并限制等待时长。涉及 SDK 状态的验收采用该接口；DOM 条件沿用 Playwright 的同步条件接口。`tests/wait-async.spec.mjs` 验证异步假值、错误与超时，保证业务状态作为验收依据。

画布尺寸切换通过 Qt 实例的 `qtResizeContainerElement` 更新屏幕尺寸，再提交原生窗口尺寸；逻辑尺寸、WebGL 画布像素尺寸和外层显示比例分别核对。三种窗口比例下的方形与自由画布通过触区命中、同时触摸、右键新拍、手势取消和文档切换验证。Qt 实例接口见 [Qt for WebAssembly](https://doc.qt.io/qt-6/wasm.html#using-the-qt-instance-api)。

## 视频导出任务

视频画面消费 Qt Quick 的逐帧交换回调，编码器在 WebGL 缓冲区释放前捕获对应帧。片头使用固定上游 `IntroOverlay.qml`、模板、字体和着色器。音轨计划消费上游 `VideoExportAudioRenderPlan`，PCM 分块合成保留预载区间、音乐源位置、判定音有效增益、触摸长按的声音所有权及片头音量包络。计拍数和 BPM 使用 `ChartClockCount` 的文档与当前难度规则。

浏览器编码固定使用 Mediabunny 1.61.4，依赖与 MPL-2.0 许可证位于 `renderer/vendor/mediabunny/`。`npm ci` 与 `npm run sync:media` 从锁定依赖同步浏览器包。编码能力查询决定 MP4（AVC/AAC）或 WebM（VP9/VP8 与 Opus）；尺寸、帧率、音频码率、质量与体积预设沿用导出页面字段。

工作台为任务建立独立预览实例，读取启动时的正文、难度、素材、外观、音频及字体快照。主工程支持导出期间编辑。视频按选定难度与区间输出，支持文件句柄写入及 Blob 下载。文件句柄在编码成功后提交，取消时终止当前写入。进度更新作用于导出页页脚，任务结束释放导出实例。

`tests/video-export-core-smoke.mjs` 解码生成文件，核对帧数、预载静音、音乐接入、画面内容、经典片头、PV 片头、预览状态恢复与文件取消。30 FPS 的样本中，选定区间生成 60 帧，经典片头全曲在 48 kHz 音频时钟下生成 355 帧，在 44.1 kHz 下按实际解码时长生成 354 帧，PV 片头全曲生成 452 帧；MP4 与 WebM 通过验证。`tests/video-export-workbench-smoke.mjs` 验证主工程并行编辑、独立导出实例、选定难度、帧数与单视频下载。SDK 类型验收采用 `tests/tsconfig.json`，浏览器环境声明由 TypeScript 的 DOM 库提供。

`tests/video-export-long-smoke.mjs` 在 Chromium 中导出三分钟音轨，采用 128×128、30 FPS；含两秒预载的文件时长为 182 秒，逐帧解码得到 5460 帧。验证覆盖连续时间戳、音频末尾时间、预载静音、音乐首段/中段/尾段的能量，以及导出后的播放位置、倍率与画布恢复。编码文件和采样记录位于 `artifacts/video-export-long/`。

`tests/creation-workflow-smoke.mjs` 从目录导入素材，执行分难度编辑与撤销、单难度保存、保存全部、刷新恢复、版本对应的分析、区间播放及视频输出，并解码输出的视频和音轨。`npm run test:stage2` 顺序运行功能清单中的验收脚本，记录源码指纹、运行时身份、各项退出码与日志；Chromium 与 Firefox 各自形成验收记录。

## 片头试听

`setIntroAudition` 在当前预览实例内使用相同的原生片头场景与音轨规划。试听消费 `IntroConfig` 的片段长度、PV 起点、音乐包络和样式。播放期间保留谱面位置与倍率，音乐以正常倍率试听；结束与暂停停留在片头静帧，循环从选定起点续接。修改起点刷新对应声音源，窗口缩放保留试听状态。离开导出页、切换文档或执行编辑事务时恢复谱面预览。

试听增益消费上游 `IntroRegion.cpp` 的 smoothstep 与 1/32 量化规则；文件导出的淡入淡出消费 `BassExportAudioBackend.cpp` 的 16 段 smoothstep 包络节点，PCM 分块边界沿用同一包络。`tests/intro-audition.spec.mjs` 验证增益、循环、静帧与声音源释放；`tests/intro-audition-core-smoke.mjs` 验证实际试听按钮、音乐源起点与倍率、自动结束、循环、起点修改、自由比例窗口缩放和预览状态恢复。

## 分离预览窗口

`preview.detach` 通过 `preview-window.html` 承载播放控制、统计和预览 SDK。主编辑器的原生文档所有者处理编辑、保存、分析和时间轴；窗口中的原生实例接收正文事务和当前难度，并持有活动播放与素材。嵌回时恢复位置、倍率、区间及片头试听经过时间，文档代数与编辑记录沿用主实例。窗口尺寸变化按方形或自由比例更新 Qt 逻辑画布。

SDK 的 `audioContextOwner` 对分离窗口指定同源 opener，音频实例消费发起窗口的文档权限，实例释放时关闭所属音频上下文。浏览器对 AudioContext 的文档关系与启动权限采用 [Web Audio 规范](https://webaudio.github.io/web-audio-api/#AudioContext) 的规则。窗口退出前捕获播放状态，pagehide 负责释放实例与恢复主预览。

`tests/preview-window-smoke.mjs` 验证音乐、封面和 PV 传入、播放控制、快捷键、编辑同步、窗口尺寸、文档代数、片头试听及关闭后的播放恢复。窗口关闭沿浏览器的 beforeunload 与 pagehide 生命周期执行；关闭工程同步释放分离窗口。`tests/intro-audition.spec.mjs` 包含试听经过时间对应的声音起点、剩余时长和画面帧。

## 封面图层事务

`coverCommand` 将图层新增、复制、删除、上移、下移、拖动排序、选择、属性修改与布局重置交给上游 `CoverLayoutModel`。复制保留文字、图片路径、锁定和外观；谱面帧新增消费上游模板继承规则。删除后由原生模型选择相邻图层，列表保留键盘焦点。图层字段在整笔事务校验后调用原生 setter，范围约束沿用上游模型。

封面画布将设置更新与图层命令按请求顺序提交，后续操作消费当前原生模型。切换难度更新卡片数据与按钮状态。`tests/cover-canvas-smoke.mjs` 验证界面按钮、连续属性操作、可见性和锁定、复制、键盘连续删除、排序、非法事务保存原状态、谱面帧参数继承、布局重置及预览返回。

图片导入消费 Qt 图像解码器，文件路径由内容 SHA256 确定，图层比例由上游图像读取接口计算。工具链包含同版本 Qt Image Formats，静态图像插件按用途登记，WebP 消费该模块的原生编解码器，见 [Qt Image Formats](https://doc.qt.io/qt-6/qtimageformats-index.html)。输出通知保留 libwebp 的 BSD 许可证。自定义背景、图片替换、卡片字体与文字字体使用当前封面实例的文件系统；字体选项读取本地字体素材库，并向封面实例导入对应字节。卡片的字体、长文字模式和等级文字设置进入原生模板与曲目信息。

封面自动模式消费所选难度的原生解析结果和上游 `detectedIntroBannerMode`，根据触摸、EX、Break 长按及轨迹特征选择 SD/DX。布局保存用户选择的 `auto` 或手动模式，场景获得解析后的 `trackOverrides.mode`；同一正文和难度复用判定结果。`tests/cover-canvas-smoke.mjs` 核对难度切换、手动覆盖、模式持久化以及 SD/DX 导出图片的对应关系。

布局文件消费上游 `CoverCompositionState` 的 `miacode-cover-composition` 与版本字段。共享布局保留背景、卡片样式、尺寸和图层；`assets` 字段携带所引用图片与字体的原始字节，导入时按当前实例返回的内容路径重映射。布局下载与用户预设保留同一格式，预设支持保存、重命名、删除与应用。输出文件名随工程记录保存。

封面图片消费 Qt 逐帧交换回调，在 WebGL 缓冲区释放前复制输出尺寸的画面。捕获期间通过上游 `editable` 隐藏选框，结束后恢复编辑。PNG 保留 Alpha，JPEG 使用黑色底图。工程恢复记录保留 `coverExport` 下的封面设置、图层和素材文件，新的封面实例从记录恢复文件系统。素材库以 `kind` 索引查询字体与预设。

`tests/cover-files-core-smoke.mjs` 验证 PNG/JPEG/WebP/BMP 解码、工作台图片导入与原始比例、背景替换、字体导入、PNG 透明像素、JPEG 底色、选中图层变化时的导出像素一致性、图片下载、附带素材的布局文件、432×288 自定义尺寸、预设管理及刷新后的画面哈希，并验证素材库索引升级保留原文件字节。`tests/cover-files.spec.mjs` 验证素材字节、引用去重、路径重映射和尺寸字段。

## 封面谱面画面

`setCoverChart` 复用 Native 文档解析与 `PreviewFrameState`，载入封面所选难度及预览外观。每个谱面画面图层拥有独立的 `PreviewQuickSceneRoot` 与时间位置，音符、轨迹和判定效果采用现有渲染层。封面场景通过 v2 的 `CoverFramePlaybackController` 控制播放、暂停、单步定位与按住方向键定位；画布和图层面板使用同一组命令。`coverPlaybackChanged` 每 100 毫秒更新控件，渲染时间由原生经过时间驱动。导出图片时暂停图层播放，保留当前帧。

`tests/cover-chart-frame-smoke.mjs` 在 Chromium 与 Firefox 中验证原生场景像素、指定帧时间、多图层位置、播放按钮、画布空格和方向键，以及页面切换时的实例释放。画布点击获取 iframe 内的键盘焦点，Qt 指针事件与快捷键共享同一预览实例。

屏外 iframe 的 Qt 定时器在 Firefox 中存在暂停情形。SDK 在播放事件间隔超过 250 毫秒时读取原生状态；原生桥接按经过时间调用 `CoverFramePlaybackController::advanceForElapsed`，重置其计时参考，后续 Qt tick 接续剩余时间。暂停、配置与输出读取对应时刻的状态。验收隐藏 iframe 后通过工作台时间控件观察播放，覆盖宿主续时、暂停与键盘恢复；SDK 用例核对事件续期、暂停及销毁时的计时器释放。

### 封面 PV 图层

封面 PV 使用浏览器视频解码，RGBA 帧送入 v2 `CoverLayoutModel::setLayerPvFrame` 与 `registerCoverChartImageProvider`。圆形裁切、填充、适应与乘法亮度使用上游 `CoverComposer.qml`。播放中的图层按原生时钟对齐 PV，各静态图层按自身时间取帧；导出按图层的输出尺寸取帧。视频源与原生像素缓冲由预览实例持有，返回普通预览时释放 PV 素材。

`tests/cover-pv-smoke.mjs` 通过文件夹导入验证 PV 载入；在 Chromium 与 Firefox 中比较导出像素与浏览器解码帧，覆盖填充、适应、亮度、指定时间、播放、导出暂停、多图层时间与素材释放。

## 皮肤与判定线素材库

`skin.import` 选择包含 `tap.png` 的 v2 皮肤目录。SDK `importSkin` 保留 PNG 的相对路径，按路径与内容生成 `skinDirectoryName`；原生导入分为创建、提交及中止事务，完成后供 `PreviewSceneAssetLoader` 加载。音符与判定文字采用所选目录的共享加载实现。

`preview.importJudgeLine` 导入 PNG，返回上游同名字段 `customOutlineFileName`。自定义判定线、内置判定线和暂停时显示区域标签使用 `PreviewSceneAssetLoader::loadAssetState`；暂停合成使用 `PausedJudgeAreaComposite`。

`UserAppearance` 将原始素材存入 IndexedDB，保存显示名称和稳定标识。下拉列表提供内置及导入选项；刷新后按当前选择载入，切换到素材库中的其他选项时载入对应素材。封面和视频导出实例从同一素材记录恢复所选外观。封面按上游 `SceneFrameRenderer` 的静态画面规则使用所选判定线；主预览的暂停提示保留其交互语义。设置通过差量交给原生所有者合并。

`tests/appearance-core-smoke.mjs` 在 Chromium 与 Firefox 中验证目录与 PNG 导入、素材库选择、刷新后切换、导入失败时的当前状态、封面颜色和编码视频。`tests/user-appearance.spec.mjs` 验证 v2 相对路径、路径边界、重名及标识规则。

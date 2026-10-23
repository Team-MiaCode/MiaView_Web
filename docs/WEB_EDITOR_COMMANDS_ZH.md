# 工作台命令与验收入口

工作台由 `app.mjs` 协调浏览器业务，`ui/workbench/workbench.mjs` 管理页面与布局，SDK 将文档、场景和导出操作交给原生所有者。下表中的标识与代码保持同名；验证入口位于 `tests/`。

| 功能与网页入口 | 命令或公共接口 | 实现依据 | 验证入口 |
| --- | --- | --- | --- |
| 文件菜单、欢迎页、拖放 | `file.new`、`file.demo`、`file.open`、`file.openFolder`、`file.close` | `BrowserFiles`、`inspectChartFolder`、`ChartWorkspace` | `workbench-folder-smoke.mjs`、`document-smoke.mjs` |
| 保存、保存全部、另存为 | `file.save`、`file.saveAll`、`file.saveAs`；`getDocumentSaveText()` | `ChartWorkspace::textForSectionSave`、文件句柄提交、ZIP 输出 | `project-files-smoke.mjs`、`project-media-smoke.mjs` |
| 最近项目、恢复 | `file.openRecent`、`file.removeRecent`、`file.restore`、`file.flushRecovery` | `ProjectStore`、IndexedDB、文档保存点 | `project-files-smoke.mjs` |
| 谱面信息 | `document.metadataTitle/metadataArtist/metadataDesigner/metadataFirst/metadataClockCount/metadataVideoPath/metadataExtraText`、`document.wholeBpm` | `ChartWorkspaceDocumentField`、`SimaiDocument`、`ChartClockCount` | `document-fields-smoke.mjs`、`resources-core-smoke.mjs` |
| 难度与谱师 | `document.addDifficulty/removeDifficulty/selectDifficulty/currentDifficultyLevel/currentDifficultyDesigner`、`document.designerSlots/applyDesignerSlots` | `ChartWorkspace`、谱师槽位与统一名义 | `document-smoke.mjs`、`document-fields-smoke.mjs` |
| 输入、补全与覆盖 | `edit.processKey/updateCompletion/triggerCompletion/selectCompletionIndex/acceptCompletion/dismissCompletion`、`editor.overwrite_mode` | `EditorController`、`SimaiTextEditPolicy`、`SimaiCompletionCatalog` | `editor-core-smoke.mjs`、`editor-ime-smoke.mjs`、`editor-preferences-smoke.mjs` |
| 编辑菜单 | `edit.undo/redo/copy/cut/paste/selectAll`、`edit.find/findNext/findPrevious/replaceAndFind/replaceAll` | `SourceEditor`、`TextHistory`、`TextSearch`、Clipboard API | `editor-core-smoke.mjs`、`text-history.spec.mjs`、`text-search.spec.mjs` |
| 书签与选区拍数 | `edit.bookmark/createBookmark/renameBookmark/deleteBookmark/selectionBeats`、`document.navigateToBookmark` | `BookmarkCommentSyntax`、`ChartSelectionBeatSummary` | `editor-core-smoke.mjs` |
| 谱面变换 | `transform.mirror_lr/mirror_ud/rotate_180/rotate_ccw_45/rotate_cw_45/random_rotate`、`transform.subdivision_up/subdivision_down/subdivision_half_up/subdivision_half_down`、`transform.toggle_break/toggle_ex/toggle_firework/reset_tap_notes/clear_complete_elements` | `ChartBatchTransform`、`ChartTransformCommands` | `editor-core-smoke.mjs`、`shortcuts-core-smoke.mjs` |
| 触区编写 | `edit.touchPadAuthoring`、`touchPadAuthoring` 事件 | `TouchPadAuthoringEdit`、原生触区几何 | `touch-authoring-smoke.mjs` |
| 诊断与无理列表 | `getAnalysis()`、`analysis.activateRow` | `SimaiParser`、`MuriAnalyzer`、`MuriStaticChecker`、`MuriPanelEntries` | `analysis-core-smoke.mjs` |
| 时间轴 | `timeline.viewport/settings/scroll/zoom/navigateAtPoint`、`timeline.zoom_in/zoom_out`；`getTimeline()`、`navigateTimeline()` | `TimelineData`、`TimelineMarkerOffset`、`TimelineQuickModel` | `timeline-smoke.mjs`、`timeline-controls-smoke.mjs`、`timeline-visual-smoke.mjs` |
| 播放控制 | `preview.toggle/pause/stop/seek/rate/rangeMode`、`preview.stop_or_play/play_pause_global/speed_down/speed_up`；`setPlayback()` | `PreviewAudio`、`player-engine`、区间时间基准 | `preview-transport-smoke.mjs`、`shortcuts-core-smoke.mjs` |
| 画布与媒体显示 | `preview.toggleFreeAspect/toggleHidePv`；`setCanvasSize()`、`setMediaSettings()` | Qt 逻辑画布、自由比例设置、浏览器视频 | `preview-transport-smoke.mjs`、`touch-authoring-smoke.mjs` |
| 分离预览 | `preview.detach` | `PreviewWindow`、原文档所有者、独立 SDK 实例 | `preview-window-smoke.mjs` |
| 预览外观 | `preview.values/settings/pause_display_hold`；`setSettings()` | `PreviewSceneAssetLoader`、原生场景与暂停显示规则 | `preview-settings-core-smoke.mjs`、`shortcuts-core-smoke.mjs` |
| 皮肤、判定线、HUD 字体 | `skin.import`、`preview.importJudgeLine/importHudFont/resetHudFont`；`importSkin()`、`importJudgeLine()`、`importFont()` | `UserAppearance`、`PreferenceAssets`、原生字体与资源库 | `appearance-core-smoke.mjs`、`preferences-core-smoke.mjs` |
| 音频设置 | `audioCommand()`、`audio.saveAsSoftwareDefault/restoreSoftwareDefault` | `PreviewAudioSettings`、WebAudio 通道与增益节点 | `audio-settings-core-smoke.mjs` |
| 音乐、封面、PV | `media.audio/cover/video/removeVideo/audioInfo`；`setResources()`、`readAudioInfo()` | `chart-resources`、`Id3TagReader`、素材备份与项目事务 | `audio-info-core-smoke.mjs`、`resources-core-smoke.mjs`、`project-media-smoke.mjs` |
| BPM 与延迟页 | `latency.bpm/clockCount/offsetSeconds/subdivision/sfxVolumePercent/detectBpm/detectOffset/toggleAudition`；`setLatency()`、`detectLatency()` | `LatencyAnalysis`、`LatencyTestChartBuilder` | `latency-core-smoke.mjs`、`latency-reference/` |
| 偏好页面 | `preferences.background/performance`、`background.choose/clear`、`shortcut.capture/reset/resetAll`、`editor.font_decrease/font_increase`；`setPerformance()` | `ViewState`、`AppBackgroundSettings`、`WorkbenchShortcuts`、独立刷新时钟与视频解码器 | `preferences-core-smoke.mjs`、`performance-core-smoke.mjs`、`editor-preferences-smoke.mjs`、`shortcuts-core-smoke.mjs` |
| 标签页与布局 | `page.*`、`view.sidebar/bottom/swap/preview`、`editor.activate/close` | `ViewState`、工作台标签与响应式布局 | `workbench-chrome-smoke.mjs`、`editor-tabs-smoke.mjs`、`stage1-acceptance.mjs` |
| 封面图层与谱面帧 | `coverCommand()`、`setCoverComposition()`、`setCoverChart()` | `CoverLayoutModel`、`CoverFramePlaybackController`、共享预览场景 | `cover-canvas-smoke.mjs`、`cover-chart-frame-smoke.mjs`、`cover-pv-smoke.mjs` |
| 封面素材、布局、预设与输出 | `cover.browseOutputFile/importLayout/saveLayout/managePresets/export`、`importCoverImage()`、`exportCover()` | `CoverCompositionState`、原生图像编码、`CoverCanvas`、素材库 | `cover-files-core-smoke.mjs`、`cover-files.spec.mjs` |
| 单视频导出与片头 | `export.video/settings/setExportRangeSeconds/browseOutputPath/browseIntroBackground/importIntroFonts/resetIntroFonts/toggleIntroAudition/introScrubbing`、`job.cancel`；`startExport()`、`cancelExport()`、`setIntroAudition()`、`setExportPreview()` | `VideoExportAudioRenderPlan`、`IntroOverlay.qml`、独立导出实例、Mediabunny | `video-export-core-smoke.mjs`、`video-export-workbench-smoke.mjs`、`video-export-long-smoke.mjs`、`intro-audition-core-smoke.mjs`、`export-preview-smoke.mjs` |

协议、类型与纯逻辑验证采用 `npm test`、`tests/tsconfig.json`。原生源码与运行时一致性采用 `npm run check:source`，目录和文件归属采用 `npm run check:repo`。浏览器脚本使用本地 HTTP 服务及项目的 WASM 产物。

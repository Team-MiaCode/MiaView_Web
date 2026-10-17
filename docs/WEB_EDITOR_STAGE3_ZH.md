# Stage3 预览与响应验收

记录日期：2026-10-17。预览源码固定为 `ff9f65856b8591589aba0582ac867220202a44c6`，Release 构建目录为 `build-devtools/`。

## 实现

预览 HUD 使用 Qt Quick 的 FBO 绘制目标。原生呈现回调提供场景时间，PV 保留三个原生解码帧，按帧自身的时间戳选择接近场景时间的图像。WebAudio 负责音乐与音效时钟，视频解码在音乐启动时间到达后开始，倍率修正处理媒体时钟漂移。

谱面分析使用独立的 Qt Core/WASM Worker，复用同版本 SimaiParser、MuriAnalyzer、StaticChecker 与面板条目生成器。请求携带文档版本、打开代次、难度与语言快照，分析期间的状态与编辑命令保持可用。

源码编辑器复用行、行号与换行几何，可见区域及预留区域建立语法高亮 Range。视口和可见行的尺寸监听更新正文与行号几何，字体加载触发换行重算。输入提交文档事务，预览解析合并到输入间隙；读取预览状态、播放及相关命令消费待更新文档。工作台控件按值变化更新。

## 原生画面对照

`tests/preview-parity-smoke.mjs` 使用同版本 Qt Quick 原生离屏渲染与网页 WASM 渲染，保存 31 组对应截图。样本覆盖 SD/DX 皮肤、三种显示模式、三个时间点、烟花、方形/宽屏/自由画布和 HUD。音符数量与六项统计逐项相等。

`tests/compare-preview.py` 验证 25 组场景的音符与轨迹几何在 1px 内，逐像素平均色差小于 3；六组 HUD 按对应文字区域核对边界和颜色，准确度达到 85%。截图、原生参数、统计与比较结果位于 `artifacts/preview-parity/chromium/`。

## 性能参考配置

参考设备为 Intel Core i5-12500H、NVIDIA GeForce RTX 3060 Laptop GPU、Windows 10.0.26200。参考浏览器使用 Playwright Chromium 151，启动参数为 `--enable-gpu --use-angle=d3d11`，WebGL2 为 ANGLE D3D11 物理 GPU。采样采用 1080 逻辑像素短边、DPR 1、60 FPS 设置，包含 1.2 秒预热及 5 秒统计。

运行 `MIACODE_BROWSER=chromium node tests/preview-benchmark.mjs --verify-reference`，覆盖普通、密集、8192 音符长曲、烟花、16:9、自由画布及 PV 七组样本。门槛分别为原生呈现数量和画布捕获帧率达到 57 FPS、RAF 观测到的呈现帧变化间隔 p95 小于等于 20ms、原生渲染提交耗时 p95 小于等于 20ms。

采样保留 Qt `frameSwapped` 计数、RAF 观测间隔、画布捕获帧的原生时间戳、原生呈现回调间隔及 `beforeSynchronizing` 至 `frameSwapped` 的耗时。不同计时定义各自记录，原始报告位于 `artifacts/preview-benchmark/stage3-reference/chromium/results.json`。Chrome 155 对照采样位于 `artifacts/preview-benchmark/stage3-final/chrome/results.json`。

有窗口 Chrome 155 的七组采样位于 `artifacts/preview-benchmark/stage3-visible/chrome/results.json`。呈现与捕获约 60 FPS，RAF 观测间隔 p95 为 20.9ms；普通场景渲染提交 p95 为 7.6ms，长曲为 10.9ms。该浏览器的有窗口采样记录保留 20ms 门槛与实测间隔的差值。

## PV 时间与输入响应

`tests/pv-sync-smoke.mjs` 生成含帧编号条码的 60 FPS 视频，读取实际合成图像中的编号，与 Qt 呈现回调的场景时间比较。帧覆盖区间与场景时间的距离按播放倍率换算为显示时间。0.25×、0.5×、0.75×、1×、1.25×、1.5×、1.75×、2× 八种倍率的最大偏差均在 16.67ms 内，暂停及跳转核对通过。报告保留预期 tick 时间、实际呈现场景时间与实际图像编号。

`tests/editor-input-benchmark.mjs` 对 512 与 8192 音符谱面各输入 40 个字符，核对可见正文及原生文档一致。可见响应 p95 分别为 17.3ms、22.6ms，文档命令 p95 分别为 23.6ms、41.5ms，门槛为可见响应 p95 小于 100ms。结果位于 `artifacts/editor-input-benchmark/chrome/results.json`。

## 生命周期与回归

时间轴采用 v2 `TimelineQuickStateBridge::centerOnSecond` 的小数坐标与视口居中规则：播放进度线居中，刻度、波形、音符及标记随播放移动，暂停保留滚动位置；场景越过预留裁切范围时补充原生场景。`tests/timeline-playback-smoke.mjs` 在 Chromium 与 Firefox 覆盖四种帧率模式、四种缩放和 0.5×/1×/2× 播放，中心位置最大误差小于 0.17px，并核对暂停与关闭跟随的状态。

`tests/preview-resources-smoke.mjs` 执行四轮媒体加载、播放、分析与销毁，以及四轮启动取消。宿主记录使用弱引用，核对音频上下文的实际关闭状态、VideoFrame 的关闭状态、Worker 终止、URL 撤销及消息监听移除。Chrome 的四轮 WASM 堆均被垃圾回收，活动 iframe、Blob URL 与实例消息监听回到基线；原始堆和 DOM 计数随报告保存。

`tests/preview-lifecycle-smoke.mjs` 核对引擎清理后宿主帧回调、待执行帧与诊断状态；Chromium、Firefox、WebKit 分别为 0 次回调、0 个待执行帧及关闭的诊断状态。`tests/loading.spec.mjs` 与 `tests/animation-frame.spec.mjs` 覆盖启动取消和监听释放。

功能回归使用 `tests/stage2-acceptance.mjs` 的 Chromium 与 Firefox 清单，共通过 53 项。布局与输入回归通过工作台 621 组布局、120 组密度/缩放、963 组源码换行宽度、八组原生文本几何及中文输入用例。UI 总评分 91.44，最低页面评分 89。116 项 Node 用例、SDK 严格类型检查、运行时资源哈希及固定源码核对通过。报告入口沿用 `artifacts/stage2/` 与 `artifacts/stage1/ui-acceptance.json`。

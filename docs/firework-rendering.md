# Touch 烟花渲染

Web 使用 MiaCode v2 `dbfb93b1` 的烟花渲染器、着色器与素材。标准样式持续 1.50 秒，现代样式持续 1.10 秒。带烟花标记的 Touch 在音符时间触发，Touch Hold 在结束时触发。重叠时显示最近触发的一发。烟花覆盖圆形舞台，皮肤按素材透明度遮挡烟花。

## 预览和导出

`setSettings({ fireworkStyle, fireworkBrightness })` 接受 `fireworkStyle: 0`（标准，默认）或 `1`（现代），亮度为 0.5–1.2，默认 1。编辑器保存这两个字段，视频导出任务与封面谱面帧使用相同的预览设置。

`native/browser-host.cpp` 把设置写入 `PreviewFrameState.render`。标准样式读取 `standard/emitters.json` 和配套贴图。现代样式复用发射器数据计算彩虹波形，使用自己的彩球纹理与后处理。两种样式使用谱面触发数据计算星星布局，同一时间点的重播和导出使用同一布局。

## 预热和节点复用

`native/CMakeLists.txt` 将 v2 的烟花绘制源编译为内部类，`native/firework-layer.cpp` 用原接口委托绘制并管理 Web 生命周期。空闲且当前样式尚未提交过绘制时，适配层按上游约定生成透明的合成 Touch marker。首次 `frameSwapped` 确认绘制提交后，SDK 发出就绪事件。初始化诊断记录引擎加载、Qt 初始化和烟花预热耗时。

同一资源代次内，适配层保留当前样式的节点，空闲时屏蔽其子树。切换样式或刷新素材时确认新资源的绘制提交。现代彩球的 mipmap 由上游纹理仓库管理。

## 回归

`npm run test:firework` 在无头 Chromium 中验证两套着色器的透明预热、空闲绘制、Touch 和 Touch Hold 触发、同帧重播、亮度、视频编码帧和封面导出。它也验证 WASM 下载失败时 SDK 收到具体错误。Release 构建和产物校验使用 `npm run build:native` 和 `npm run check:source`。

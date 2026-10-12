# Touch 烟花渲染开发说明

更新日期：2026-10-12。

烟花固定启用预热和跨触发资源复用。SDK、URL 参数和 C++ 层均不提供关闭这两项优化的开关。MiaCode 仍通过 Git submodule 引用，优化代码只在本项目维护，子模块内容和指针保持原样。

## 职责与上游继承

实际烟花绘制直接调用上游的 `PreviewQuickJudgeFireworkLayer::updateNode()`。本项目的 `native/firework-layer.cpp` 是生命周期适配层，只负责透明预热、保存节点、空闲时屏蔽绘制，以及查询预热是否完成。

| 上游负责 | 本项目负责 |
| --- | --- |
| 烟花 shader、颜色、星星布局、运动及动画曲线 | 让上游提前提交一次透明烟花 |
| 材质、纹理创建和 mipmap 生成 | 保留上游创建的节点与其资源 |
| 几何和 uniform 更新、舞台裁剪 | 在空闲时屏蔽整个节点子树 |
| 触发变化或动画重启时的随机角度 | 独立烟花之间让上游识别一次新触发 |

本项目不再维护上游烟花绘制实现的完整副本，也不定义材质 uniform、星星坐标、颜色或几何算法。更新子模块并重新构建后，上游烟花 C++ 绘制代码、shader、素材和动画曲线的更新都会用于 Web。若上游调整接口、预热 marker 约定或节点所有权契约，需核对适配层。

## 构建接入

`native/CMakeLists.txt` 保留上游烟花源文件作为编译输入，并且：

1. 仅对该源文件设置编译宏，将其公开类名改为内部使用的 `MiaViewUpstreamJudgeFireworkLayer`。
2. 从当前上游头文件生成同名的内部接口头文件，输出到构建目录。
3. 将本项目适配层编译进去，由它实现原始类名的 `updateNode()`，再委托给内部上游渲染器。

因此上游场景根节点仍调用原来的接口，而绘制代码仍来自子模块。这个过程不写入子模块，不复制上游绘制代码到本仓，也不向上游类添加方法。配置阶段要求匹配恰好一个上游烟花源文件；接口头文件变动会触发重新配置。

生成的接口头文件是构建产物。其来源由子模块提交确定，本项目 CMake 配置及适配层源码同时纳入原生输入指纹。

## 播放前预热

每个 renderer 文档拥有独立的 WASM 实例和一个预览窗口。Web 通过上游现有的 `setFrameState()` 提供场景状态，没有绑定负责原生播放的 `PreviewRuntime`。

1. 资源尚未完成预热且没有真实烟花时，创建一个临时帧状态，将其中的 marker 替换为上游约定的合成烟花。触发时间位于当前播放头之前 0.15 秒。
2. 把临时状态交给上游渲染器，使用上游预热标记绘制舞台中心一个半径 1 像素的小矩形。上游 shader 输出完全透明，同时实际材质、纹理和大彩球 mipmap 得到准备。
3. 适配层在收到包含这次绘制的 `frameSwapped` 后，通过原子状态发布完成。Web 宿主请求下一次场景同步，使空闲节点进入屏蔽状态。
4. JavaScript 启动流程等待 `miacode_firework_ready()` 成功，再将播放器标记为就绪。

临时状态不写回谱面，也不改变真实场景的 revision。`miacode_firework_ready()` 通过本项目的 `miaview::firework::ready()` 查询完成状态，仅查询而不控制是否启用优化。不能仅因创建了节点就提前宣告完成。

## 节点保留与重播

适配层返回一个自己的容器节点，由它持有上游创建的烟花节点。有真实烟花时，将这个上游节点传回原渲染器更新；烟花结束时，仍返回容器并用 `isSubtreeBlocked()` 屏蔽整个子树。

这样外层不会因“当前没有烟花”而删除上游节点，其材质、大彩球纹理和 mipmap 可以跨触发复用。纹理创建、图片处理、几何更新和视觉合成仍由上游完成，适配层不接管它们的实现。

源彩球图像的 `cacheKey()` 改变时，再交给上游准备和提交新资源。场景纹理 generation 重置时，适配容器及其子节点按现有场景生命周期销毁，新容器重新预热。容器销毁时断开帧提交回调并清除完成状态。

独立烟花之间，如果保留节点直接重播同一触发时间，上游可能无法仅凭时间变化识别一次新烟花。适配层会先更新一次临时的透明烟花状态，再更新真实状态，借助上游现有的触发变化逻辑重新选择随机星星角度。这两个状态更新最终只提交真实烟花绘制，不会增加可见效果或额外绘制。重播恰好位于预热的 0.15 秒时，临时触发时间会避开真实触发时间。

带烟花标记的 touch 在音符时间触发，touch hold 在结束时间触发；当前上游生命周期为 1.10 秒，同时活跃时选择最近触发的一发。适配层复用上游场景状态函数判断活跃状态，不独立维护动画参数。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| [firework-layer.cpp](../native/firework-layer.cpp) | 生命周期适配、节点保留和上游渲染委托 |
| [firework-layer.h](../native/firework-layer.h) | 本项目的预热完成状态查询 |
| [CMakeLists.txt](../native/CMakeLists.txt) | 编译上游渲染器、生成内部接口并接入适配层 |
| [PreviewQuickJudgeFireworkLayer.cpp](../vendor/MiaCode/src/preview/quick_scene/PreviewQuickJudgeFireworkLayer.cpp) | 实际烟花绘制、纹理和几何更新 |
| [PreviewJudgeFireworkLayerState.cpp](../vendor/MiaCode/src/core/scene/PreviewJudgeFireworkLayerState.cpp) | 触发选择、动画曲线、位置和裁剪状态 |
| [PreviewFireworkWarmupPolicy.h](../vendor/MiaCode/src/core/scene/PreviewFireworkWarmupPolicy.h) | 合成 marker 的身份及时间策略 |
| [PreviewFireworkMaterial.frag](../vendor/MiaCode/src/preview/quick_scene/shaders/PreviewFireworkMaterial.frag) | 视觉合成及透明预热分支 |
| [browser-host.cpp](../native/browser-host.cpp) | Web 完成状态查询及提交后的场景同步 |
| [player-engine.mjs](../renderer/player-engine.mjs) | 播放器启动时等待预热完成 |
| [build-identity.mjs](../scripts/build-identity.mjs) | 将本地适配层纳入原生输入指纹及构建版本 |

## 构建与验证

工具链安装和 Release 构建目录约定见现有 [README 构建说明](../README.md#开发与构建)。保持子模块干净，在本项目修改适配层后直接构建：

```sh
npm run build:native
npm test
npm run check:repo
npm run check:source
npm run test:firework
```

构建会重新生成本地 JS/WASM、压缩文件、构建身份和哈希清单。上游来源仍是干净的固定子模块提交，本项目的适配层、宿主和 CMake 配置一起纳入原生输入指纹；`check:source` 会发现源码与产物不一致。

`test:firework` 用真实 WebGL 调用验证：

- 播放器就绪前已编译烟花程序、提交透明预热绘制并生成大彩球 mipmap。
- 空闲时不产生烟花绘制。
- 中心 touch、偏心 touch、touch hold 结束和向后跳转正常渲染。
- 多次触发及重播保持同一份彩球 mipmap，并复用已经编译的程序。
- 同一烟花在相同时间点独立重播时，实际上传的星星随机角度仍会变化，包含预热时间相等的边界情况。

固定跳转序列通常输出 `{ "mipmaps": 1, "draws": 7, "links": 1 }`。该计数验证资源生命周期；测试读取 uniform 以检查随机重启，不用于衡量 GPU 耗时。

已有环境可通过 `MIACODE_PLAYWRIGHT_MODULE` 和 `MIACODE_CHROMIUM` 指定 Playwright 模块及 Chromium 可执行文件。未安装时按现有 README 的浏览器验证步骤准备依赖。

手动检查可运行 `npm run dev`，选择 `tests/fixtures/firework/` 文件夹（[测试谱面](../tests/fixtures/firework/maidata.txt)）。三发烟花分别在 2、4、6.5 秒触发，各发之间均有空档。

观察日志中的实际 FPS 和宿主 tick 间隔 `p95/max`。`WASM 场景更新`、`主线程帧工作` 仅覆盖同步宿主调用，不包含后续 Qt 渲染和 GPU 工作。活跃烟花仍执行上游每帧的绘制、几何及 uniform 更新；优化减少首次和跨触发创建资源的开销。

## TODO

TODO: 将来最好在miacode本体加上烟花优化。

未来可由 MiaCode 本体提供透明预热、空闲节点保留和完成状态查询。上游具备这些能力后，Web 可直接使用原接口并移除本项目的编译重命名及生命周期适配层。本次不修改上游。

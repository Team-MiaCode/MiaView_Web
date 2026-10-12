# Touch 烟花渲染开发说明

更新日期：2026-10-12。

烟花采用固定启用预热和跨触发资源复用的渲染路径。SDK、URL 参数和 C++ 层均不提供关闭这两项优化的开关。

## 渲染策略

Web 宿主复用 `vendor/MiaCode` 的 Qt Quick 烟花层。CPU 根据播放头计算动画状态和 32 颗星星的位置，GPU 在一个四顶点矩形上通过自定义材质合成射线、星星、大小彩球和辉光。

带烟花标记的 touch 在音符时间触发，touch hold 在结束时间触发，生命周期为 1.10 秒。同一帧有多发活跃烟花时，仅渲染最近触发的一发；触发时间相同时，选择后遍历到的音符。

爆炸中心位于 touch 位置，展开半径按舞台大小缩放，再裁剪到舞台中心的圆内。预热和复用保留原有 shader、动画曲线、颜色、星星布局及随机旋转规则。

## 播放前预热

Web 通过 `setFrameState()` 直接提供场景状态，没有绑定负责原生播放的 `PreviewRuntime`。因此预热由烟花层自身完成，适用于直接提供帧状态的宿主。

1. 没有真实烟花活跃、且资源尚未完成预热时，构造一个局部的合成 marker，触发时间位于当前播放头之前 0.15 秒。该 marker 不写入谱面，也不改变场景内容 revision。
2. 使用实际烟花材质、圆形裁剪和三份纹理绑定，提交舞台中心一个半径 1 像素的小矩形。shader 的预热标记使输出完全透明。
3. 这次绘制会创建烟花管线，准备彩球和亮点纹理，并生成大彩球的 mipmap。
4. 收到 `frameSwapped` 后，将管线标记为已提交。Web 宿主请求下一次场景同步，发布预热完成状态并屏蔽空闲节点。
5. JavaScript 启动流程等待 `miacode_firework_ready()` 返回成功，再将播放器标记为就绪。

`miacode_firework_ready()` 仅查询完成状态，不控制预热是否启用。完成判断以包含烟花节点的帧提交为依据，不能仅因构建了节点就提前放行。

## 节点、纹理和几何复用

烟花结束后，层仍返回原有根节点，并通过 `isSubtreeBlocked()` 屏蔽整个子树。空闲时保留节点、材质和纹理，停止烟花绘制；下一发解除屏蔽并更新动画状态。

资源归属如下：

| 资源 | 生命周期与更新条件 |
| --- | --- |
| 小彩球、亮点遮罩纹理 | 由 `PreviewTextureRepository` 缓存，按图像查找并复用 |
| 大彩球纹理及 mipmap | 由烟花节点持有；仅首次创建或源图像 `cacheKey()` 改变时重新处理图像并创建纹理 |
| 圆形裁剪几何 | 中心或半径变化时更新 |
| 烟花矩形几何 | 矩形位置或尺寸变化时更新 |
| 动画 uniform、星星状态 | 活跃烟花每帧更新 |

独立烟花之间、触发时间变化和向后跳转时仍更新星星随机角度，避免节点保留后每发重复同一个方向。

场景纹理 generation 重置时，原节点及纹理按现有场景生命周期销毁，新节点重新准备资源。烟花根节点销毁时断开其帧提交回调。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| [PreviewJudgeFireworkLayerState.cpp](../vendor/MiaCode/src/core/scene/PreviewJudgeFireworkLayerState.cpp) | 触发选择、动画曲线、位置和裁剪状态 |
| [PreviewFireworkWarmupPolicy.h](../vendor/MiaCode/src/core/scene/PreviewFireworkWarmupPolicy.h) | 合成 marker 的身份及时间策略 |
| [PreviewQuickJudgeFireworkLayer.cpp](../vendor/MiaCode/src/preview/quick_scene/PreviewQuickJudgeFireworkLayer.cpp) | 预热、节点保留、纹理和几何更新 |
| [PreviewQuickSceneRoot.cpp](../vendor/MiaCode/src/preview/quick_scene/PreviewQuickSceneRoot.cpp) | 场景集成及预热完成状态发布 |
| [PreviewFireworkMaterial.frag](../vendor/MiaCode/src/preview/quick_scene/shaders/PreviewFireworkMaterial.frag) | 烟花视觉合成及透明预热分支 |
| [browser-host.cpp](../native/browser-host.cpp) | Web 完成状态查询及提交后的场景同步 |
| [player-engine.mjs](../renderer/player-engine.mjs) | 播放器启动时等待预热完成 |

## 构建与验证

工具链安装和 Release 构建目录约定见现有 [README 构建说明](../README.md#开发与构建)。本地修改子模块但尚未提交时，使用开发构建：

```sh
npm run build:native -- --development
npm test
npm run check:repo
npm run test:firework
```

开发构建会重新生成本地 JS/WASM、压缩文件、构建身份和哈希清单。正式构建要求子模块源码已提交且匹配记录的提交；开发产物不满足发布用的干净源码检查。

`test:firework` 使用 Playwright 和真实 WebGL 调用验证：

- 播放器就绪前已编译烟花程序、提交透明预热绘制并生成大彩球 mipmap。
- 空闲时不产生烟花绘制。
- 中心 touch、偏心 touch、touch hold 结束和向后跳转均正常渲染。
- 多次触发及重播保持同一份大彩球 mipmap，并复用已经编译的烟花程序。

测试通过时，受控的跳转序列通常输出 `{ "mipmaps": 1, "draws": 5, "links": 1 }`。这组计数验证资源生命周期，不表示 GPU 渲染耗时。

已有浏览器环境可通过 `MIACODE_PLAYWRIGHT_MODULE` 和 `MIACODE_CHROMIUM` 指定 Playwright 模块及 Chromium 可执行文件。未安装时按现有 README 的浏览器验证步骤准备依赖。

手动检查可运行 `npm run dev`，选择 [tests/fixtures/firework/](../tests/fixtures/firework/maidata.txt) 文件夹。三发烟花分别在 2、4、6.5 秒触发，各发之间均有空档。

观察播放日志中的实际 FPS 和宿主 tick 间隔 `p95/max`。`WASM 场景更新`、`主线程帧工作` 仅覆盖同步宿主调用，不包含后续 Qt 场景渲染和 GPU 工作。预热与复用减少首次和重复创建资源的开销；活跃烟花的片元 shader 计算仍需每帧执行。

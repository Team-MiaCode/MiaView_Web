# 预览 SDK 接入测试

左侧打开谱面文件夹或单独选择谱面、音乐、封面和 PV。右侧播放器由 `createPreview()` 挂载。文件由浏览器读取，播放控制和设置位于播放器内。

测试页使用 `layout: "fit"` 和 SDK 默认的 `panelLayout: "proportional"`，播放器面板按 741∶865 显示。

左侧「画面比例」通过 `setCanvasSize()` 切换与视频导出对应的 1:1、4:3、16:9 画布，三种尺寸均为 1080 像素高。

下载并解压 `miaview-sdk-preview-demo`。修改示例后，可在发布分支运行 `npm run build:sdk-preview-demo -- build-devtools/miaview-preview-standalone`，从解压的 SDK 包生成 `build-devtools/sdk-preview-demo/`。将整个测试站目录复制到静态服务器，访问目录下的 `examples/sdk-preview/`。

在构建输出目录中，可使用 Python 启动本地静态服务：

```sh
python examples/sdk-preview/serve.py
```

打开 [本地独立测试页](http://127.0.0.1:3031/examples/sdk-preview/)。

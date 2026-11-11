# 预览 SDK 接入测试

左侧打开谱面文件夹或单独选择谱面、音乐、封面和 PV。右侧播放器由 `createPreview()` 挂载。文件由浏览器读取，播放控制和设置位于播放器内。

测试页使用 `layout: "fit"` 和 `panelLayout: "fill"`，播放器填满右侧容器的宽度和高度。

在源码仓库运行 `npm run dev`，打开 [SDK 接入测试页](http://127.0.0.1:3030/examples/sdk-preview/index.html)。

需要单独部署时，在运行时已就绪的仓库执行 `npm run build:sdk-preview-demo`。构建输出为 `build-devtools/sdk-preview-demo/`，含测试页和同版本的 SDK 与运行资源。将整个目录复制到静态服务器，访问目录下的 `examples/sdk-preview/`。

在构建输出目录中，可使用 Python 启动本地静态服务：

```sh
python examples/sdk-preview/serve.py
```

打开 [本地独立测试页](http://127.0.0.1:3031/examples/sdk-preview/)。

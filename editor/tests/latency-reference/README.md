# 原生延迟检测基准

本目标使用固定上游的 `LatencyAnalysis`、BASS 解码器和 Qt Core。输入音频以单声道 24000 Hz 解码，输出 BPM、拍号和偏移 JSON。

在项目根目录配置 Release 构建；`CMAKE_PREFIX_PATH` 指向 Qt 6.11.1 的桌面开发包。Windows 使用 MSVC 开发命令行，Ninja 位于 PATH。

```sh
cmake -S tests/latency-reference -B build-devtools/latency-reference -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="<QtHost>"
cmake --build build-devtools/latency-reference --parallel 4
```

`tests/latency-core-smoke.mjs` 生成 24 秒和三分钟样本。把 Qt 的 `bin` 目录加入运行环境 PATH，执行基准：

```sh
build-devtools/latency-reference/miaview-latency-reference artifacts/latency-core/pulse.wav artifacts/latency-core/long.wav
```

Windows 的可执行文件后缀为 `.exe`。BASS 运行库由目标复制到可执行文件目录。浏览器用例将样本 SHA256、BPM、拍号和偏移与 `tests/fixtures/latency-reference.json` 对照。

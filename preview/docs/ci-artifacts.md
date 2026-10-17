# CI 构建与源码提交策略

2026-10-11：当前 PR 分支改为源码仓库，播放器产物不再提交 Git。

## 构建流程

`Web preview` 的 source-checks 先运行仓库策略、44 项单测和严格 TypeScript；build-preview 从固定 MiaCode 子模块、Qt 6.11.1 / Emscripten 4.0.7 构建 Release。

构建同步音效、主题、许可证、WASM、生成 JS 和 Qt loader，再生成原生指纹、构建身份、预压缩文件和完整哈希清单。运行产物/source 检查与 browser/UI/Pages 后才上传：

- `miaview-preview`：SDK、完整 renderer、后台日志模块和 README。
- `miaview-pages`：可直接静态托管的网站。
- `ui-screenshots`：浏览器验收截图。

主要分发产物保留 14 天。从对应提交的 Actions 运行下载；本地开发可将完整 renderer 复制到同一提交的源码 checkout，再启动 dev。也可自行安装工具链构建。

main 的成功构建可部署 Pages；其他分支与 PR 不部署。产物不会由机器人提交回仓库。

## Git 与历史

以下路径退出 Git 跟踪，但保留在本地作为忽略的构建文件：生成 JS/WASM、.br/.gz、qtloader、theme.css、sfx、构建身份/清单和生成的许可副本。

仓库策略禁止上述路径被重新提交，并拒绝超过 5 MiB 的跟踪文件。音效从固定子模块的 assets/SFX 复制，不再重复存入 Web 仓库。

原本含生成产物的目标分支提交与合并提交不再作为当前 PR 分支的祖先；main 之后重建为一个包含完整整合结果与本次 CI 迁移的源码提交。旧本地历史备份保存在忽略目录 artifacts/pre-ci-history.bundle，供恢复使用，不属于推送引用。

这次停止推送后远端没有收到合并结果；没有改写 main 或其他远端分支。本地目标历史重写后，后续若决定更新同名远端分支，需要基于最新远端值使用 force-with-lease。本次不推送。

## 本机验证

不含生成播放器的暂存源码快照通过 44/44 单测和严格 TypeScript。仓库产物策略、工作流 YAML 与依赖解析、Release 重建、产物/source 与压缩回验、Edge browser/UI/Pages 三组验证和静态打包均通过。构建生成的文件仍被 Git 忽略。

因为已停止推送，本次未触发远端 Linux Actions；远端 CI 的实际运行结果需要以后推送后确认。

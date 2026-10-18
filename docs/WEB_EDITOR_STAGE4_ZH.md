# Stage4 独立编辑器与预览

记录日期：2026-10-17。固定上游：`ff9f65856b8591589aba0582ac867220202a44c6`。

## 交付与同步

主编辑器使用根目录的 `index.html`、`app.mjs` 和 `page.css`。`editor/` 包含同版本工作台、服务、主题、SDK、渲染宿主、native 桥接、测试与构建脚本；`preview/` 包含独立预览入口、同版本预览 SDK、渲染宿主、native 桥接与配套资源。

`node scripts/sync-products.mjs --runtime` 从主项目源码和 `products/` 入口模板生成两种产品。公共文件采用对应文件名、字段和接口。各产品的 `source-config.json` 固定自身上游源码，`.deps/`、`vendor/MiaCode/` 和 `build-devtools/` 均以产品目录为根。预览产品按自身渲染文件清单生成构建身份和资源哈希，native 输入身份与主项目一致。

`npm run build:pages` 生成主站及 `editor/`、`preview/` 的静态交付目录。Feature 站点入口分别为 `/MiaView_Web/feature/`、`/MiaView_Web/feature/editor/` 和 `/MiaView_Web/feature/preview/`。README 区分 Main 与 Feature 链接。

## 编辑器接入

`sdk/editor.mjs` 的 `createEditor` 沿用 iframe 传输、来源校验、会话、请求标识与构建身份，加载 `renderer/editor.html`。该页面使用主项目的 `createWorkbench` 装配工作台，命令通过 `workbenchCommand` 转发到原工作台接口，文档、保存、状态与事件复用配套预览 SDK。

接口包含 `ready`、`load`、`command`、`getDocument`、`getDocumentSaveText`、`getState`、`on` 与 `destroy`，类型位于 `sdk/editor.d.mts`，接入示例位于 `examples/editor.html`。编辑器包默认导出编辑器 SDK，`./preview` 导出预览 SDK。窄容器启动阶段显示预览初始化画面，原生场景就绪后呈现工作台。

独立预览使用同版本 `createPreview`。页面通过文件夹输入接收谱面和素材，谱面集合使用列表切换；浏览器资源接口、控件和播放时钟沿用主项目。跨来源编辑器的文件选择使用浏览器文件夹输入，保存使用下载接口；同来源目录句柄继续沿用原文件服务。

独立预览的文件选择器在 HTML 中标记初始化状态，应用绑定事件并等待渲染器就绪后启用。静态前缀验收通过阻塞应用模块下载，核对初始化期间的控件状态、就绪后的文件夹选择及难度载入。

## 验证

`tests/product-closure.mjs` 检查 265 项编辑器路径和 230 项预览路径，覆盖模块、类型、HTML、CSS、静态 URL、源版本与运行时身份。相对文件路径均解析至对应产品内。

`tests/products-smoke.mjs` 在 Chromium、Firefox 验证主编辑器 SDK、独立编辑器 SDK 与独立预览，覆盖跨来源宿主、双实例隔离、File/Blob 输入、正文编辑、命令、保存、播放、事件、销毁及四种容器尺寸。窄容器实例加载 PV，独立预览页面载入文件夹中的谱面、音乐、背景和 PV。

两种浏览器下，主编辑器与独立编辑器的对应预览截图逐像素相等；独立预览与编辑器对应画面的平均像素差低于 1.5。采样使用相同谱面、600×600 逻辑画布、DX 皮肤、显式时间 0.5 秒及相同 HUD 设置，报告位于 `artifacts/products/`。

Feature 子路径的静态页面、分离预览、音乐、PV 和难度切换通过 `tests/pages-smoke.mjs` 验证。单元用例共通过 120 项，编辑器与预览 SDK 的严格类型检查通过。

工作台组件沿用 Stage3 的 UI 基准：总评分 91.44，最低页面评分 89；预览画面对照与帧率记录见 [Stage3](WEB_EDITOR_STAGE3_ZH.md)。

## 隔离构建

两个产品分别复制至工作区外的 `D:/STUDY/Project_Work/MiaCode_Product_Verification/editor` 和 `preview`。各目录执行 `npm ci`，使用自身 `.deps/qt/6.11.1/`、`.deps/emsdk/`、`.deps/ninja/`、固定上游 Git 克隆和 `build-devtools/` 完成 Release 构建。

`tests/product-builds.mjs` 核对 CMake 记录的源码、编译器、Qt、Ninja、工具链和构建目录，路径均属于对应产品；上游 Git 数据目录位于产品内。独立编辑器构建身份为 `miaview-web-2-2568e408f6cd`，独立预览为 `miaview-web-2-20e516738e37`。

两个隔离目录分别通过 120 项 Node 用例、各自安装的 TypeScript 严格检查、源码边界检查、资源与上游身份核对，以及原生分析 Worker 的快照、响应和销毁用例。重建产物通过 Chromium、Firefox 的跨来源接入与画面对照。构建路径记录位于 `artifacts/products/builds.json`，浏览器记录位于 `artifacts/products/results.json`。

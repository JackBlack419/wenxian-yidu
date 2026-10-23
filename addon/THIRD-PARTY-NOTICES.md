# 文献译读 — 来源和第三方许可

本插件基于 Liozhang/z-transplit 的 a5e807ec5232d842806d723e291ea473a93b87c9 提交改造，保留作者署名，采用 AGPL-3.0-only。完整许可见 LICENSE.txt；对应源码与构建说明随本版本提供。

- 基础项目：https://github.com/Liozhang/z-transplit
- 翻译适配参考：https://github.com/windingwind/zotero-pdf-translate （AGPL-3.0-or-later，固定参考提交见源码 UPSTREAM.md）
- pdf-lib 1.17.1、@pdf-lib/fontkit 1.1.1、zod 3.25.76：MIT，许可文本见 licenses/。
- 英文内容删除器：源码随包源码目录 java/region-text-remover/ 提供；使用 Apache PDFBox、FontBox 和 commons-logging，保留 JAR 内 META-INF/LICENSE 与 NOTICE。
- OpenDataLoader PDF CLI：独立本地子进程组件，Apache-2.0 及其第三方许可，随 JAR 的 META-INF/THIRD_PARTY/licenses/ 保留；来源与 SHA-256 见 core/pdf/lib/PROVENANCE.json。
- Eclipse Temurin JRE：按需安装，保留其 LICENSE、NOTICE 和 legal/ 文件夹。
- 系统中文字体从用户本机读取，不随插件分发。

插件免费；翻译服务商独立收取 API 费用或提供限额试用。没有任何服务商密钥随本插件分发。

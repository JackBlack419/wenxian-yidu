# 上游和第三方组件

本项目以 Z-Transplit 为基础，并保留上游来源注释、`LICENSE` 与二进制溯源文件。固定基础提交见根目录 `UPSTREAM.md`。接口适配参考项目的具体提交由接入代码记录。

| 组件 | 用途 | 本版本记录的许可/来源 |
| --- | --- | --- |
| Z-Transplit | Zotero 阅读和 PDF 翻译基础 | AGPL-3.0-only；上游仓库 `Liozhang/z-transplit`。 |
| Translate for Zotero | 翻译服务适配参考 | AGPL-3.0-or-later；上游仓库 `windingwind/zotero-pdf-translate`。 |
| pdf-lib 1.17.1 | PDF 绘制与组合 | MIT；文本附于 `licenses/pdf-lib-MIT.txt`。 |
| @pdf-lib/fontkit 1.1.1 | 字体处理 | 包元数据声明 MIT；保留包内来源记录。 |
| zod 3.25.76 | 返回数据校验 | MIT；文本附于 `licenses/zod-MIT.txt`。 |
| OpenDataLoader PDF CLI 2.5.0 | 本地版面解析 | 项目 Apache-2.0，含其他第三方依赖；完整清单及许可文本在 JAR 内 `META-INF/THIRD_PARTY/licenses/`，版本与 SHA-256 在 `src/core/pdf/lib/PROVENANCE.json`。 |
| Z-Transplit Original-Text Remover 1.0.0 | 译文页面中的英文内容处理 | 自有代码 AGPL-3.0-only，依赖 Apache PDFBox、FontBox、commons-logging；源码位于 `java/region-text-remover/`，溯源位于对应 PROVENANCE 文件。 |
| Eclipse Temurin JRE | 按需安装的本地 Java 运行时 | 按所下载分发包携带的 LICENSE、NOTICE 和 legal 目录提供许可；安装器保留发行包中的文件。 |

系统字体只从用户本机读取，不随插件打包。提供独立离线字体包时，应另外附上该字体对应的许可。

构建工具与测试工具不作为运行时模块全部打入插件；源码包保留依赖锁文件，便于核对实际版本。源码分发、修改记录与第三方许可应和安装包同时提供。

## 0.2.0 可选离线组件

| 组件 | 固定版本和来源 | 许可及溯源 |
| --- | --- | --- |
| MTranServer | npm 5.0.1，与 GitHub 5.1.0 桌面版分开 | Apache-2.0；锁文件、npm integrity 和来源检查位于 `addon/content/offline/`。依赖原许可保留在安装目录各包中。 |
| Node Windows x64 | 24.22.1 官方便携 ZIP | 原 ZIP 的 LICENSE（含依赖许可）完整保留；整包及可执行文件 SHA-256 位于离线 PROVENANCE。 |
| Mozilla translations-models-v2 | en→zh-Hans 3.0，冻结四份模型记录 | 保留来源、哈希及生成的模型 manifest；引擎 Apache 许可不替代模型自身许可。 |

运行 `node scripts/check-offline-provenance.mjs` 检查锁文件与构建复制。插件只打包锁、冻结记录和适配代码；用户主动准备时才下载运行库、依赖和模型，不修改系统 PATH。

托管离线另锁定 Koffi 2.15.1（MIT）：在本插件进程内用完整 Unicode 路径预载 npm 锁定的 ONNX DLL，避免 Windows 系统旧版冲突。其完整性包含在 npm 锁文件中，不修改系统 DLL。npm 下载缓存同样位于插件离线数据目录。

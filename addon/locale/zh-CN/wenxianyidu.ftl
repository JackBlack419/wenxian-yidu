## 文献译读 — 核心文案。
##
## 消息 id 一律不带 `wenxianyidu-` 前缀：构建时由 zotero-plugin-scaffold 的
## build.fluent（prefixFluentMessages，默认开启）统一加上，src/utils/locale.ts
## 也按同样规则读取。详见 en-US/wenxianyidu.ftl 顶部说明。
##
## 本目录的键集合必须与 en-US 完全一致——Zotero 按文件粒度选择插件 locale，
## 缺失的文件会回落到 en-US。

## 通用标题（进度窗 headline / 对话框标题）
app-title = 文献译读

## 引擎错误与提示（src/core/translation/translationEngines.ts）
## 键名沿用 leadero 的 translation-error-* 命名。ai-prompt-* 同时是
## src/core/translation/promptTemplate.ts 的模板拒绝原因：每条规则一个文案，
## 运行时报错与设置面板的即时提示共用同一套措辞。
translation-error-google-empty = Google 翻译返回了空结果
translation-error-bing-empty = Bing 翻译返回了空结果
translation-error-deepl-empty = DeepL 返回了空结果
translation-error-custom-empty = 自定义接口返回了空结果
translation-error-google-failed = Google 翻译失败
translation-error-bing-failed = Bing 翻译失败
translation-error-deepl-failed = DeepL 翻译失败
translation-error-custom-failed = 自定义接口翻译失败
translation-error-pdf-translate-failed = zotero-pdf-translate 翻译失败
translation-error-bing-not-configured = Bing 翻译未配置 API 密钥
translation-error-deepl-not-configured = DeepL 翻译未配置 API 密钥
translation-error-custom-url-missing = 自定义翻译接口地址未配置
translation-error-unknown = 未知错误
translation-error-bing-token-unavailable = 无法获取 Bing 翻译令牌（页面结构可能已变化）
translation-error-bing-rejected = Bing 拒绝了请求（{ $status }）
translation-error-pdf-translate-missing = 未安装或未启用 zotero-pdf-translate 插件。请在 Zotero 的插件管理器中安装并启用。
translation-error-ai-empty = AI 翻译返回了空结果
translation-error-ai-failed = AI 翻译失败
translation-error-ai-url-missing = AI 翻译接口地址未配置
translation-error-rate-limited = 翻译服务触发限流：已自动等待并重试，仍被拒绝。免注册试用接口每分钟只能翻译少量文本（有道试用约 6 次）；请稍后重试，或在设置中改用必应试用、官方接口或自己的 AI API。

## AI 引擎提示词模板的拒绝原因（src/core/translation/promptTemplate.ts）
translation-error-ai-prompt-too-long = AI 提示词模板过长（最多 4000 个字符）。
translation-error-ai-prompt-unknown-placeholder = AI 提示词模板包含未知占位符：只支持 {"{{"}text{"}}"}、{"{{"}sourceLang{"}}"}、{"{{"}targetLang{"}}"}（双花括号）。
translation-error-ai-prompt-missing-text = AI 提示词模板缺少 {"{{"}text{"}}"}：它是待翻译原文所在的位置。
translation-error-ai-prompt-duplicate-text = AI 提示词模板里 {"{{"}text{"}}"} 出现了多次：待翻译原文只能发送一次。
translation-error-ai-prompt-missing-source-lang = AI 提示词模板缺少 {"{{"}sourceLang{"}}"}：它是源语言名称所在的位置。
translation-error-ai-prompt-missing-target-lang = AI 提示词模板缺少 {"{{"}targetLang{"}}"}：它是目标语言名称所在的位置。
translation-error-ai-prompt-unbalanced-braces = AI 提示词模板的花括号不成对：占位符用双花括号（{"{{"}text{"}}"}），公式标记用单花括号（{"{"}v0{"}"}）。

## 翻译功能就绪判定（src/core/translation/featureReadiness.ts）
readiness-reason-engine-key = 缺少翻译引擎 API 密钥
readiness-reason-engine-url = 缺少自定义翻译接口地址
readiness-reason-engine-plugin = 未安装或未启用 zotero-pdf-translate 插件
readiness-reason-ai-prompt = AI 引擎的提示词模板不合法，请在设置面板中修正
readiness-reason-unknown = 未知原因

## 分屏菜单（src/core/pdf/splitview/splitViewFactory.ts）
splitview-menu-root = 文献译读
splitview-menu-compare = 分屏阅读
splitview-menu-translate = 分屏翻译
splitview-menu-interleave = 对照翻译
splitview-menu-trans-only = 仅译文
splitview-menu-cancel = 取消进行中的翻译

## 阅读器工具栏（src/modules/registerReaderToolbar.ts）
toolbar-title = 翻译
toolbar-status = 引擎：{ $engine } · 目标：{ $lang }
toolbar-lang-zh-cn = 简体中文
toolbar-lang-zh-tw = 繁體中文
toolbar-lang-en = English
toolbar-lang-ja = 日本語
toolbar-lang-ko = 한국어
toolbar-selection = 划词翻译
toolbar-input = 输入翻译
toolbar-tasks = 翻译任务…
toolbar-settings = 翻译设置…
toolbar-pdf-only = 首版只支持文字型 PDF：EPUB、快照和网页附件不能用分屏翻译。
toolbar-no-reader = 请先在阅读器中打开一篇 PDF。
toolbar-reuse-title = 已有译文
toolbar-reuse-body = 这篇文献在当前引擎与目标语言下已有完整译文。直接复用可以立刻打开分屏，重新翻译会用新结果替换旧译文。
toolbar-reuse-accept = 复用译文
toolbar-reuse-retranslate = 重新翻译
toolbar-reuse-cancel = 取消
toolbar-progress-running = 翻译中 { $done }/{ $total }
toolbar-progress-starting = 翻译中…
toolbar-progress-failed = 失败 { $failed } 段
toolbar-resume = 继续翻译
toolbar-progress-hint = 当前任务：{ $title }

## OpenDataLoader 流水线错误（src/core/pdf/splitview/splitViewFactory.ts）
odl-error-java-missing = 翻译需要 Java 11 或更高版本。
odl-error-jar-missing = OpenDataLoader 解析组件缺失（未找到 jar 文件），请重新安装插件。
odl-error-jar-unreadable = 解析组件无法读取（Java 无法访问 jar 文件）。请检查文件是否被杀毒软件隔离，确认文件权限，或重新安装插件。
odl-error-jar-download-failed = 解析组件自动下载失败。请检查网络后重试；若反复失败，可改用内置解析组件的完整版安装包。
odl-jar-download-window = 正在下载 OpenDataLoader 解析组件
odl-jar-download-probe = 正在测试可用镜像…
odl-jar-download-downloading = 正在下载（{ $percent }%）
odl-jar-download-verifying = 校验并安装…
err-jar-load = 无法读取解析组件 jar 文件（路径非法）：{ $path }（{ $message }）
odl-error-file-path = 文件路径无效：PDF 或 Java 路径不合法。请检查 Zotero 数据目录权限，或重启 Zotero。
odl-error-network = { $detail }
odl-error-not-configured = 未配置翻译。请在 Zotero 设置的 文献译读 中选择翻译引擎并填写其配置。
odl-error-parse-empty = { $detail }
odl-error-http-auth = 翻译服务拒绝了请求（HTTP { $code }）：API 密钥无效或没有访问权限，请检查 文献译读 设置中的密钥。
odl-error-http-rate = 翻译服务繁忙或配额不足（HTTP { $code }），请稍后重试。
odl-error-http-other = 翻译服务返回错误（HTTP { $code }）：{ $detail }

## 分屏错误与进度（splitViewFactory / readerPaneAdapter / splitViewCleanup）
splitview-error-dialog-title = 分屏对照 (文献译读)
splitview-error-open = 无法打开分屏：{ $detail }
splitview-error-tab-create = 分屏标签页创建失败（容器未就绪）。
splitview-error-container-timeout = 分屏容器（{ $tabID }）在 2 秒内未出现在 DOM 中。
splitview-error-reader-timeout = 阅读器未在 10 秒内完成初始化，分屏中止。
splitview-error-scroll-timeout = 分屏阅读器的滚动区域未在限定时间内就绪，页面同步不可用。
splitview-error-no-item = 无法确定当前阅读器对应的 PDF 附件，请重新打开该文献后重试。
splitview-error-in-flight = 已有翻译正在进行，可在阅读器右键菜单选择「取消进行中的翻译」。
splitview-tab-title = { $left } | { $right }

## 文献树右键菜单进度（src/modules/registerItemTreeMenu.ts）
itemtree-progress-attachment = 文献译读: 正在翻译全文…
itemtree-open-failed = 无法自动打开译文附件，请在该条目下手动打开。
itemtree-interleave = 对照翻译
itemtree-trans-only = 仅译文
itemtree-launch-progress = 文献译读: 正在准备双语阅读…
itemtree-launch-done = 双语阅读已就绪
itemtree-launch-no-reader = 无法确定当前阅读器，请重新打开该 PDF 后重试。

## 译文附件（src/core/pdf/translation/translatedAttachment.ts）
translated-tag = 译文

## Java 运行时安装流程（splitViewFactory / JavaRuntimeManager）
java-dialog-title = 需要安装 Java
java-dialog-body =
    需要 Java 11+ 才能使用「翻译并分屏」。

    「自动下载安装」：下载约 40MB 的 Java 运行时并解压到插件数据目录，无需管理员权限；
    「打开下载页」：在浏览器中打开 https://adoptium.net，由你手动下载安装；
    「取消」：本次不做任何处理。
java-dialog-button-download = 自动下载安装(&D)
java-dialog-button-openpage = 打开下载页(&O)
java-dialog-button-cancel = 取消
java-progress-install = 正在安装 Java 运行时…
java-progress-download-prepare = 准备下载…
java-progress-retry = ✓ Java 安装完成。请再次点击「翻译并分屏」。
java-install-failed =
    Java 安装失败：{ $detail }
    请手动从 https://adoptium.net 下载安装后重试。
java-progress-already-installed = Java 运行时已安装。
java-progress-self-heal = 检测到已损坏的 Java 运行环境，正在自动重新安装…
java-progress-download-start = 下载 Java { $version } JRE（{ $archive }）…
java-progress-downloading = 下载中 { $percent }%
java-progress-reuse-archive = 已有下载完成的安装包（校验通过），跳过下载…
java-error-download-failed = 下载失败：{ $detail }
java-error-download-http = 下载失败：HTTP { $status }
java-error-checksum-mismatch = 安装包校验失败（SHA-256 不匹配），已丢弃，请重试。
java-progress-extracting = 解压中…
java-progress-verifying = 验证安装…
java-error-extract-failed = 解压失败：{ $detail }
java-error-exe-not-found = 解压后未找到 java 可执行文件（在 { $dir }）。请手动从 https://adoptium.net 安装。
java-error-probe-failed = 下载的 Java 无法运行：{ $detail }
java-progress-done = Java 安装完成

## OpenDataLoader 流水线进度与错误
## （opendataloaderSplitAdapter / splitViewFactory / registerItemTreeMenu）
odl-progress-translating = 文献译读: 正在翻译全文…
odl-error-dialog-title = 翻译并分屏 (OpenDataLoader)
odl-progress-done-split = 完成：已分屏打开「{ $title }」
odl-progress-cancelled = 翻译已取消
odl-error-engine-not-ready = 翻译引擎尚未配置完成：{ $gaps }。请先在 文献译读 设置中补齐后重试。
odl-progress-parsing = 正在解析 PDF 版面…
odl-error-source-path = 无法获取原文 PDF 路径。
odl-error-parse-failed = 解析失败：{ $detail }
odl-error-parse-no-pages = PDF 解析未返回任何页面（PDF 可能是空文件或扫描件）。
odl-error-parse-no-text = 解析完成但未提取到任何文本段落（PDF 可能是纯图片）。
odl-progress-formula-vlm = 正在用视觉模型提取公式（{ $count } 段）…
odl-progress-formula-novlm = 检测到 { $count } 段公式，但未配置视觉模型，公式将随正文翻译（可能不准确）。
odl-progress-font-missing = ⚠️ 未找到 { $fontFile } 或系统默认字体 — 译文将显示为问号。请将字体放入 { $assetsDir }
odl-progress-overlay = 正在叠加译文到原 PDF（保留原图/表格/版式）…
odl-progress-remove-original = 正在删除已翻译段落的原文…
odl-progress-render-white = 正在渲染译文（白底模式）…
odl-error-render-empty = 渲染阶段未产出任何页面。
odl-progress-summary = 完成：{ $pages } 页，{ $paragraphs } 段
odl-progress-summary-failed = ，{ $failed } 段翻译失败已保留原文
odl-progress-summary-nosplit = 完成：{ $pages } 页，{ $paragraphs } 段（译文已生成，但分屏打开失败）
odl-progress-opening-split = 正在打开分屏…
odl-error-no-split-opener = 分屏打开器不可用（内部错误：split 流程缺少 openSplitView）。
odl-error-reader-pdf-timeout = reader pdf.js 未在 15 秒内就绪。
odl-progress-crop-reader-missing-skip = 无法打开 reader 进行公式截图，跳过公式提取。
odl-progress-crop-reader-missing-text = 无法打开 reader 进行公式截图，公式将以文本形式处理。
odl-progress-crop-progress = 公式提取进度：{ $current }/{ $total }
odl-progress-crop-done = 公式提取完成：{ $ok } 段成功
odl-progress-crop-fallback = ，{ $count } 段回退为截图
odl-progress-crop-failed = ，{ $count } 段失败已保留原文
odl-progress-shot-progress = 公式截图进度：{ $current }/{ $total }
odl-progress-shot-done = 公式截图完成：{ $ok } 段成功
odl-progress-shot-failed = ，{ $count } 段失败

## 版式保留渲染器（LayoutPreservingRenderer.ts）
render-error-rotated-page = 暂不支持旋转页面（/Rotate { $angle }°）。请先将 PDF 转正再翻译。

## 词典卡片查询链（src/core/translation/dictionaryCard.ts）
dictionary-error-all-failed = 词典查询失败：词典与可用的翻译引擎都没有返回结果（{ $error }）。
dictionary-error-unavailable = 词典查询失败：{ $error }

panel-close = 关闭翻译面板
panel-resize = 调整翻译面板宽度
models-unsupported = 当前接口不支持模型列表，请继续手动输入。
models-empty = 当前接口没有返回可用模型，请继续手动输入。
split-return-original = 关闭译文，返回原文

engine-label-mtranserver = MTranServer 离线翻译
offline-process-failed = 离线进程启动或运行失败，请重新准备后重试。
offline-download-failed = 运行库下载失败，请检查网络后重试。
offline-checksum-failed = 离线组件校验失败，请重新准备。
offline-prepare-failed = 离线准备失败：{ $error }
offline-timeout = 离线准备或启动超时，请取消后重试。
offline-platform = 离线准备首版支持 Windows x64。
offline-dependencies-failed = 离线依赖下载失败，请检查网络后重试。
offline-language = 目前仅准备英语到简体中文，请选择对应语言。
offline-not-ready = 请先到翻译设置点击“准备离线翻译”，试译完成后再使用。
offline-translation-failed = 离线翻译失败，请重新准备后重试；文本未发送到在线服务。

toolbar-reuse-partial = 此译文仍有失败段落，继续时复用已完成段落。
toolbar-reuse-different = 此译文与当前源文件或翻译配置不同。可打开旧译文，或按当前配置重新翻译。
toolbar-retry-failed = 重试失败段落（{ $failed }）

engine-label-google = Google 翻译
workspace-offline-notice = 准备完成后由本机 CPU 翻译；失败不会改用在线服务。首次使用请在设置中准备离线翻译，重要译文仍需核对。

engine-selection-required = 首次使用请先选择翻译引擎。接下来将打开设置；可选择免注册在线引擎，或准备本机离线引擎。

offline-stage-missing = 尚未准备
offline-stage-downloading = 下载运行库
offline-stage-verifying = 校验运行库
offline-stage-extracting = 解压运行库
offline-stage-dependencies = 准备服务依赖
offline-stage-models = 下载英中模型
offline-stage-verifying-model = 校验模型
offline-stage-model-extracting = 解压模型
offline-stage-initializing = 初始化引擎
offline-stage-trial = 正在试译
offline-stage-ready = 离线翻译已就绪
offline-stage-cancelling = 正在取消
offline-stage-cancelled = 准备已取消
offline-stage-failed = 准备失败
offline-stage-working = 正在准备离线引擎
offline-progress-title = 离线引擎准备
offline-progress-hint = 显示当前阶段的进度；下载后还需校验、解压和试译，通过后才会提示就绪。
offline-progress-details = 查看详情
offline-progress-cancel = 取消准备
offline-progress-retry = 重试准备
offline-progress-settings = 打开设置
offline-progress-dismiss = 收起提示

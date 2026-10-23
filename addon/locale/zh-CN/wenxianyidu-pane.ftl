## 文献译读 — 阅读器面板文案。
##
## 消息 id 不带 `wenxianyidu-` 前缀：构建时统一加上（见 wenxianyidu.ftl 顶部
## 说明），src/utils/locale.ts#getLocaleID 读取时再补回同一前缀。
##
## 使用方：
##   - src/modules/registerTranslateUI.ts — 条目面板 section 的 header/sidenav
##     （注意：该模块传的是**带完整前缀**的 id，如 `wenxianyidu-pane-translate`，
##     因为它走 Fluent 的 DOM overlay（data-l10n-id），不经过
##     src/utils/locale.ts）。
##   - src/ui/translatePane.ts — 面板内所有按钮 / 占位符 / 状态行
##     （传裸 id，getString 负责加前缀）。
##
## 本目录的键集合必须与 en-US 完全一致——Zotero 按文件粒度选择插件 locale，
## 缺失的文件会回落到 en-US。

## 面板外壳
pane-translate = 翻译

workspace-engine = 翻译引擎
workspace-settings = 设置
workspace-modes = 翻译方式
workspace-mode-split = 双栏对照
workspace-mode-paragraph = 对照翻译
workspace-mode-selection = 划词翻译
workspace-mode-input = 输入翻译
engine-label-youdao = 有道 · 免注册试用
engine-label-bing-web = 必应 · 免注册试用
engine-label-niutrans = 小牛 · 官方接口
engine-label-youdao-official = 有道智云 · 官方接口
engine-label-ai = AI · 自己的 API
workspace-trial-notice = 插件免费。待译文本将发送给所选服务商；试用接口可能限流或失效。持续全文阅读建议在设置中配置小牛、有道官方接口或自己的 AI API。
workspace-provider-notice = 插件免费。待译文本将发送给所选服务商，接口费用以服务商规则为准。AI 引擎可在设置中自定义翻译提示词。
workspace-paragraph-hint = 在重排阅读视图中，每段英文下显示中文。先开启“双语阅读”，默认优先翻译眼前内容，也可翻译全文。
workspace-split-hint = 左侧为英文原 PDF，右侧为中文全文译文。首次使用自动准备本地处理组件；译文另存为附件，原文与批注保留。
workspace-open-split = 翻译全文并打开双栏
workspace-open-pdf = 请先打开一篇文字型 PDF。输入翻译无需打开 PDF。
workspace-preparing-split = 正在准备全文翻译，请查看任务进度…
workspace-split-finished = 全文任务已结束。请查看译文、任务状态或阅读器中的错误提示。
workspace-translate-all = 翻译全文
workspace-return-pdf = 返回原 PDF
workspace-start-paragraph = 请先开启当前文献的“双语阅读”。
workspace-all-queued = 已将全文加入翻译队列，完成的段落可立即阅读。
tools-input-translation = 文献译读 · 输入翻译
input-source-label = 原文
input-result-label = 中文译文
input-placeholder = 输入或粘贴英文单词、句子或段落…
input-translate = 翻译为中文
input-cancel = 取消
input-shortcut = Ctrl+Enter 翻译；直接回车换行。
input-disabled = 翻译功能已关闭，请在设置中重新启用。
input-empty = 请输入需要翻译的内容。
input-progress = 已完成 { $done }/{ $total } 段
input-paragraph-error = 【本段翻译失败：{ $error }】
input-partial = 有 { $failed } 段翻译失败。已完成的译文保留，可点击翻译重试。
input-complete = 翻译完成。
input-edited = 原文已修改，点击“翻译为中文”更新译文。
input-cancelled = 已取消。已显示的译文保留。
input-copy-error = 复制失败，请手动选择并复制译文。

## ─── 阅读器翻译面板（src/ui/translatePane.ts）─────────────────────────────
## 三段式布局：源文本 → 语言栏 → 结果区。

## 第 1 段 — 源文本
pane-translate-source = 源文本
pane-translate-refresh = 刷新选区
pane-translate-placeholder = 在 PDF 阅读器中选中文本后，这里会显示原文。
pane-translate-empty-selection = 当前阅读器没有选中文本。请选中后点击「刷新选区」。
pane-translate-no-reader = 未检测到当前阅读器：请打开一篇 PDF 后再使用本面板。
pane-translate-selection-unsupported = 当前 Zotero 版本未开放阅读器选区接口（_selectionRanges），无法读取选中文本。请升级 Zotero 10。

## 第 2 段 — 语言栏
pane-translate-lang-auto = 自动检测
pane-translate-auto = 自动翻译
pane-translate-target-placeholder =
    .placeholder = 目标语言，如 zh-CN

## 第 3 段 — 结果区（四态：loading / error / success / idle）
pane-translate-action = 翻译
pane-translate-result-placeholder = 翻译结果将显示在这里。
pane-translate-translating = 正在翻译…
pane-translate-copy = 复制译文
pane-translate-copied = 已复制
pane-translate-retry = 重试
pane-translate-copy-failed = 复制失败：{ $error }
pane-translate-error = 翻译失败：{ $error }
pane-translate-error-empty = 译文为空：翻译服务没有返回可用内容。请重试，或更换目标语言后再试。
pane-translate-error-service = 翻译服务不可用：无法加载翻译引擎模块（{ $error }）。请重启 Zotero 后重试；若仍失败，请查看 Zotero 调试输出。
pane-translate-error-not-ready = 翻译未就绪：{ $reason }。请在设置中补齐后重试。
pane-translate-error-too-long = 选中文本为 { $count } 字符，超过每次请求的 { $max } 字符上限。请缩小选区后重试。

## 单词查询（词典卡片）与最近查词词块行
pane-translate-lookup-action = 查询
pane-translate-looking-up = 正在查询…
pane-translate-recent = 最近查词
pane-translate-card-source-youdao = 释义来源：有道词典
pane-translate-card-source-model = 释义来源：模型引擎
pane-translate-card-source-mt = 释义来源：翻译引擎

## ─── 词卡标签页（src/ui/wordCardsTab.ts + src/modules/registerWordCardsUI.ts）
tools-wordcards = 生词本
wordcards-tab-title = 词卡
wordcards-toolbar-tooltip = 词卡（查过的单词）
wordcards-search-placeholder =
    .placeholder = 搜索单词或释义
wordcards-sort-recent = 最近查询
wordcards-sort-alpha = 字母顺序
wordcards-clear = 清空
wordcards-clear-confirm = 确认清空全部词卡？
wordcards-count = 共 { $count } 张词卡
wordcards-empty-title = 还没有词卡
wordcards-empty-hint = 在 PDF 阅读器中选中一个单词，查过的词会自动积累成词卡。
wordcards-disabled-hint = 词卡记录已在设置中关闭；重新开启后，查过的单词会继续积累。
wordcards-history = 查询历史
wordcards-speak = 朗读
wordcards-speak-examples = 朗读例句
wordcards-stop = 停止
wordcards-delete = 删除
wordcards-detail-empty = 选择左侧一张词卡查看详情。
wordcards-no-match = 没有匹配的词卡。

## ─── 条目右键菜单（src/modules/registerItemTreeMenu.ts）──────────────────
itemtree-menu = 文献译读
itemtree-translate-attachment = 翻译全文（生成译文附件）
itemtree-translate-split = 分屏翻译

## ─── 双语对照阅读（src/ui/bilingualControl.ts + src/core/pdf/sdt/）────────
bilingual-enable = 双语阅读
bilingual-mode-interleave = 对照翻译
bilingual-mode-trans-only = 仅译文
bilingual-peek-hint = 点击查看本段原文
bilingual-progress = 已译 { $done }/{ $total } 段
bilingual-progress-failed = 已译 { $done }/{ $total } 段，{ $failed } 段失败：{ $error }（可点击失败段落重试）
bilingual-placeholder = 翻译中…
bilingual-block-failed = 翻译失败
bilingual-retry = 重试
bilingual-sdt-loading = 正在准备文档结构…
bilingual-sdt-unavailable = 双语对照需要 Zotero 10 的阅读模式。当前版本可用：分屏对照（左右）、全文翻译附件。
bilingual-sdt-missing = 文档结构会话未能建立：这份 PDF 可能没有可提取的文字（扫描件、轮廓化文字），或阅读视图尚未就绪。首版不包含 OCR，请确认使用的是带文字层的 PDF。分屏对照与全文翻译附件同样需要文字层。
bilingual-sdt-unpack-failed = 文档结构不可用（{ $error }）。分屏对照与全文翻译仍可使用。
bilingual-no-text = 这份 PDF 没有可提取的文字，可能是扫描件或文字层异常。首版不包含 OCR：请改用带文字层的 PDF，或先用其他工具完成 OCR。分屏对照与全文翻译附件同样需要文字层。
bilingual-toolbar-tooltip = 切换双语阅读
bilingual-section-title = 双语阅读

## ─── 朗读（src/core/readAloud/）───────────────────────────────────────────
readaloud-original = 朗读原文
readaloud-translation = 朗读译文
readaloud-pause = 暂停
readaloud-resume = 继续
readaloud-prev = 上一句
readaloud-next = 下一句
readaloud-stop = 停止
readaloud-unsupported = 当前环境不支持朗读（缺少语音接口）。请安装系统语音包后重试。
readaloud-no-content = 没有可朗读的文本。
readaloud-start-failed = 朗读启动失败：{ $error }

# 全文流水线进度 / 错误（批量翻译 + ODL 客户端）。
pdf-progress-batch-start = 正在批量翻译 {count} 段（分 {chunks} 块）{cache}…
pdf-progress-batch-cache = ，缓存命中 {hit} 段
pdf-progress-batch-progress = 批量翻译进度：{done}/{total} 块
pdf-warn-vlm-unconfigured = 公式视觉提取不可用：未配置 OpenAI 兼容端点（translate.custom.apiUrl）。
err-vlm-empty = 视觉模型返回空结果
err-java-unavailable = Java 不可用：{detail}
err-parse-no-pages = 解析完成但无页面
err-java-too-old = 检测到 Java {version}，但 OpenDataLoader 需要 Java 11+。请从 https://adoptium.net 安装较新版本。
err-jar-load = 无法加载 JAR 文件 ({path}): {message}
input-engine-changed = 翻译引擎已切换，请重新翻译。

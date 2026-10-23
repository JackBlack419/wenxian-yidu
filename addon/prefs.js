// Default preferences for 文献译读.
//
// Keys are written out in full (extensions.zotero.wenxianyidu.*) so that this
// file is valid as-is: Zotero loads it through
// Services.scriptloader.loadSubScript(addon.getResourceURI("prefs.js"), { pref })
// and writes every entry into the DEFAULT branch (see Zotero.Plugins#
// setDefaultPrefs in chrome/content/zotero/xpcom/plugins.js).
//
// zotero-plugin-scaffold's build.prefs.prefix (see zotero-plugin.config.ts) is
// set to the same prefix and leaves already-prefixed keys unchanged
// (PrefsManager#getPrefsWithPrefix), so the source and the built copy agree.
//
// NOTE: this file is executed in a scope whose ONLY global is `pref()` — see
// setDefaultPrefs() in plugins.js, which loads it with
// `target: { pref(pref, value) { … } }`. Nothing else (Zotero, Services,
// window, document) is reachable from here, so the preference pane cannot be
// registered from this file. See the pane section at the bottom for where the
// pane lives and who registers it.

// Master switch for text translation in the reader / item pane.
// ON by default so a fresh install runs at full capability: the reader pane
// section registers immediately and every entry point is reachable. Users who
// want the plugin dormant can uncheck it in the preferences pane (the pane
// section then unregisters; the item-menu stays for re-enabling).
pref("extensions.zotero.wenxianyidu.translate.enabled", true);
// Translate automatically when a reader item/selection opens (needs
// translate.enabled).
pref("extensions.zotero.wenxianyidu.translate.auto", true);
// Upper bound of characters sent to the engine per request.
pref("extensions.zotero.wenxianyidu.translate.maxChars", 10000);
// Remember the last workspace mode, including on a fresh installation.
pref("extensions.zotero.wenxianyidu.ui.translation.mode", "selection");
pref("extensions.zotero.wenxianyidu.ui.translation.width", 380);

// 网络区域声明（src/utils/region.ts）：auto = 未声明（沿用出厂默认，不做任何
// 推断）| global | cn。声明后在设置面板套用该区域的推荐值（只覆盖仍为出厂
// 默认的键，用户显式选过的引擎不被推翻）。
pref("extensions.zotero.wenxianyidu.region", "auto");

// 偏好结构版本号（src/utils/prefMigrations.ts）：记录已执行的最新迁移步骤。
// 出厂 0，首次启动由迁移机制写入已完成步骤号；之后每次追加迁移时随之递增。
pref("extensions.zotero.wenxianyidu.prefSchemaVersion", 0);

// 合并批量的输入上限（估算 token）。全文翻译与双语对照把多个段落合并成一次
// 模型请求，planTranslationChunks 按这个预算打包：下一段会超出预算时提前
// 收批（该批少带一个段落），而不是超限发送。
pref("extensions.zotero.wenxianyidu.translate.batchMaxTokens", 8192);

// Engine selection + per-engine credentials. Defaults mirror the values the
// translate pipeline is expected to read (single source of truth: this file).
// 出厂引擎 = 必应免注册试用：2026-10-22 实机全文测试（19 段连续请求 20/20
// 成功），而有道试用端点实测约 6 次请求即返回 411「请求频率过快」且封锁约
// 20 秒以上，无法支撑全文。有道仍保留为可选的短文本试用入口。
pref("extensions.zotero.wenxianyidu.translate.engineType", "bing-web");
pref("extensions.zotero.wenxianyidu.translate.engineConfirmed", false);
// Credential defaults are empty; actual values live only in Services.logins.
pref("extensions.zotero.wenxianyidu.translate.youdaoOfficial.appKey", "");
pref("extensions.zotero.wenxianyidu.translate.youdaoOfficial.appSecret", "");
pref("extensions.zotero.wenxianyidu.translate.niutrans.apiKey", "");
pref("extensions.zotero.wenxianyidu.translate.niutrans.apiUrl", "https://api.niutrans.com/NiuTransServer/translation");
// Random revision token invalidates old caches after a secure credential change.
pref("extensions.zotero.wenxianyidu.translate.credentialsRevision", "");
pref("extensions.zotero.wenxianyidu.translate.google.apiKey", "");
pref("extensions.zotero.wenxianyidu.translate.bing.apiKey", "");
pref("extensions.zotero.wenxianyidu.translate.bing.region", "");
pref("extensions.zotero.wenxianyidu.translate.deepl.apiKey", "");
pref("extensions.zotero.wenxianyidu.translate.deepl.useFree", false);
pref("extensions.zotero.wenxianyidu.translate.custom.apiUrl", "");
pref("extensions.zotero.wenxianyidu.translate.custom.apiKey", "");
pref("extensions.zotero.wenxianyidu.translate.custom.model", "");

// AI 引擎（OpenAI 兼容 chat/completions + 用户自建 prompt 模板）。
// prompt 留空 = 使用内置默认模板（src/core/translation/promptTemplate.ts 的
// DEFAULT_AI_PROMPT，即 formulaPreservingPrompt 的模板化版本）：设置面板里的
// 「恢复默认模板」按钮写的就是空串，所以空值必须是合法值而不是错误。
pref("extensions.zotero.wenxianyidu.translate.ai.apiUrl", "");
pref("extensions.zotero.wenxianyidu.translate.ai.apiKey", "");
pref("extensions.zotero.wenxianyidu.translate.ai.model", "");
pref("extensions.zotero.wenxianyidu.translate.ai.prompt", "");

// Target language for PDF split-view translation ("" = follow Zotero locale).
// The reader translate pane overrides this per request; the PDF pipeline, the
// Zotero 10 bilingual interleave view (src/ui/bilingualControl.ts) and
// read-aloud of the translation all read it as their default target language.
// Declared here so the key is a first-class setting rather
// than an undeclared runtime read (leadero read it undeclared with a "zh-CN"
// fallback — same behaviour, now visible).
pref("extensions.zotero.wenxianyidu.translate.targetLanguage", "zh-CN");

// OpenDataLoader parser options (src/core/pdf/OpenDataLoaderPdfClient.ts,
// src/core/pdf/opendataloader-pdf-parser.ts). Defaults mirror leadero's.
pref("extensions.zotero.wenxianyidu.pdfParser.opendataloader.enabled", true);
pref("extensions.zotero.wenxianyidu.pdfParser.opendataloader.tableEnable", "default");
pref("extensions.zotero.wenxianyidu.pdfParser.opendataloader.useStructTree", false);
pref("extensions.zotero.wenxianyidu.pdfParser.opendataloader.timeout", 300);
pref("extensions.zotero.wenxianyidu.pdfParser.opendataloader.returnImages", false);
// 翻译前把已翻译段落的原文从 PDF 内容流中删除（替代白色遮罩）；失败自动回退遮罩
pref("extensions.zotero.wenxianyidu.pdfParser.originalTextRemoval.enabled", true);

// Persistent paragraph translation cache (src/core/translation/translationCache.ts).
// Content-addressed translation records under
// {DataDir}/wenxianyidu/translation-cache/, shared across sessions and output
// modes (full-text attachment / split view / bilingual interleave).
pref("extensions.zotero.wenxianyidu.translate.cache.enabled", true);
// Prune threshold in megabytes; pruning is LRU by last use, down to 70%.
pref("extensions.zotero.wenxianyidu.translate.cache.maxSizeMB", 200);

// Bilingual interleave view (src/core/pdf/sdt/, Zotero 10 reading mode).
// Default presentation when a bilingual session starts: off | interleave | transOnly.
pref("extensions.zotero.wenxianyidu.reader.bilingual.defaultMode", "interleave");
// Concurrent paragraph/batch translation requests inside the interleave view.
pref("extensions.zotero.wenxianyidu.reader.bilingual.concurrency", 2);

// Read-aloud (src/core/readAloud/). Empty voice = the system default voice.
pref("extensions.zotero.wenxianyidu.readAloud.rate", 1.0);
pref("extensions.zotero.wenxianyidu.readAloud.voice", "");

// Word cards (src/core/wordcards/wordCardStore.ts, src/ui/translatePane.ts).
// When on, a single-word reader selection is looked up as a dictionary card,
// every lookup is recorded under {DataDir}/wenxianyidu/word-cards/, and the
// pane shows a recent-words strip. Off = the pane keeps the plain-translation
// behaviour for word selections; the word-cards tab stays reachable and shows
// a disabled hint instead of cards.
pref("extensions.zotero.wenxianyidu.wordcards.enabled", false);

// ─── Preference pane ───────────────────────────────────────────────────────
// The 文献译读 settings pane (编辑 → 设置 → 文献译读) is a Zotero 7
// native preference pane, i.e. an XUL fragment that Zotero.PreferencePanes
// loads into its own preferences window:
//
//   addon/content/preferences.xhtml   markup — XUL is the default namespace,
//                                     HTML tags are written `html:input` etc.
//                                     (Zotero_Preferences._loadPane parses
//                                     plugin panes with defaultXUL: true).
//                                     Three sections: 常规 / 翻译引擎 /
//                                     PDF 分屏翻译. Every control is bound to
//                                     one of the prefs above with a
//                                     `preference="extensions.zotero.wenxianyidu.…"`
//                                     attribute (Zotero's own two-way binding
//                                     in _initImportedNodesPostInsert), except
//                                     translate.maxChars, which is validated in
//                                     JS so an empty value can never reach
//                                     Zotero.Prefs.set() on an INT pref.
//   addon/content/preferences.js      behaviour — engine field visibility,
//                                     key show/hide, maxChars / ODL timeout
//                                     validation (on blur an invalid value
//                                     restores the stored one without writing
//                                     the pref), and the in-pane
//                                     zotero-pdf-translate probe
//                                     (same check as
//                                     src/core/translation/featureReadiness.ts
//                                     #hasPDFTranslatePlugin). Exposes
//                                     window.WenxianYiduPrefs for the inline
//                                     oncommand/onload handlers, because the
//                                     pane script runs in a Cu.Sandbox whose
//                                     prototype is the window — top-level
//                                     declarations there are NOT window
//                                     properties.
//   addon/content/preferences.css     styling — loaded as a document-wide
//                                     xml-stylesheet by Zotero, so every rule
//                                     is scoped under #zotero-prefpane-wenxianyidu.
//   addon/locale/{en-US,zh-CN}/wenxianyidu-preferences.ftl
//                                     all pane copy, linked from the pane via
//                                     <linkset><html:link
//                                     rel="localization" …/></linkset>.
//
// Registration happens in addon/bootstrap.js#startup (the only file outside
// src/ that Zotero executes with a full Zotero/Services scope):
//
//   Zotero.PreferencePanes.register({
//     pluginID: "wenxianyidu@wenxianyidu.local",
//     src: "content/preferences.xhtml",
//     scripts: ["content/preferences.js"],
//     stylesheets: ["content/preferences.css"],
//     id: "zotero-prefpane-wenxianyidu",
//   });
//
// Relative URIs are resolved against the plugin root by
// Zotero.Plugins.resolveURI. If src/modules/registerPreferences.ts ever takes
// this over, the fixed pane id makes the second registration a no-op instead
// of a duplicate pane.
// ───────────────────────────────────────────────────────────────────────────

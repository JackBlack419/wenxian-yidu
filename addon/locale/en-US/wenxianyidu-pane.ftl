## 文献译读 — reader pane strings.
##
## Message ids are written WITHOUT the `wenxianyidu-` prefix: the build prefixes
## them (see wenxianyidu.ftl for why), and src/utils/locale.ts#getLocaleID adds
## the same prefix back when reading them from code.
##
## Consumers:
##   - src/modules/registerTranslateUI.ts — item pane section header/sidenav
##     (NOTE: that module passes the *fully prefixed* id, e.g.
##     `wenxianyidu-pane-translate`, because it goes through Fluent's DOM
##     overlay via data-l10n-id, not through src/utils/locale.ts).
##   - src/ui/translatePane.ts — every button / placeholder / status line
##     (passes the bare id; getString prefixes it).
##
## The zh-CN locale (addon/locale/zh-CN/) must keep the exact same key set —
## Zotero picks a plugin locale per file and falls back to en-US.

## Pane shell
pane-translate = Translate

workspace-engine = Engine
workspace-settings = Settings
workspace-modes = Translation mode
workspace-mode-split = Side by side
workspace-mode-paragraph = Paragraphs
workspace-mode-selection = Selection
workspace-mode-input = Input
engine-label-youdao = Youdao · Keyless trial
engine-label-bing-web = Bing · Keyless trial
engine-label-niutrans = NiuTrans · Official API
engine-label-youdao-official = Youdao · Official API
engine-label-ai = AI · Your API
workspace-trial-notice = This plugin is free. Text is sent to the selected provider; trial endpoints may be limited or unavailable. Configure an official API or your own AI API for sustained full-document reading.
workspace-provider-notice = This plugin is free. Text is sent to the selected provider, whose API fees may apply. AI translation prompts can be customized in Settings.
workspace-paragraph-hint = In Reading Mode, Chinese follows each English paragraph. Enable Bilingual reading first; visible paragraphs are translated first, or choose Translate all.
workspace-split-hint = English PDF on the left, full Chinese translation on the right. Local processing components are prepared automatically. The translation is saved separately; original annotations remain intact.
workspace-open-split = Translate and open side by side
workspace-open-pdf = Open a text-based PDF first. Input translation works without a PDF.
workspace-preparing-split = Preparing the full-document task; see its progress…
workspace-split-finished = The document task has ended. Check the translation, task status, or reader error message.
workspace-translate-all = Translate all
workspace-return-pdf = Back to original PDF
workspace-start-paragraph = Enable Bilingual reading for the current document first.
workspace-all-queued = All paragraphs are queued; completed translations are ready to read.
tools-input-translation = 文献译读 · Input translation
input-source-label = Source text
input-result-label = Chinese translation
input-placeholder = Type or paste an English word, sentence, or paragraphs…
input-translate = Translate to Chinese
input-cancel = Cancel
input-shortcut = Ctrl+Enter to translate; Enter adds a new line.
input-disabled = Translation is disabled. Enable it in Settings.
input-empty = Enter some text to translate.
input-progress = Translated { $done }/{ $total } paragraphs
input-paragraph-error = [Paragraph translation failed: { $error }]
input-partial = { $failed } paragraphs failed. Completed translations are preserved; translate again to retry.
input-complete = Translation complete.
input-edited = Source changed. Translate again to update the result.
input-cancelled = Cancelled. Existing results are preserved.
input-copy-error = Could not copy. Select and copy the translation manually.

## ─── Reader translate pane (src/ui/translatePane.ts) ────────────────────────
## Three-block layout: source text → language bar → result area.

## Block 1 — source text
pane-translate-source = Source text
pane-translate-refresh = Refresh selection
pane-translate-placeholder = Select text in the PDF reader and it will appear here.
pane-translate-empty-selection = The current reader has no selected text. Select some, then click "Refresh selection".
pane-translate-no-reader = No active reader detected: open a PDF first, then use this pane.
pane-translate-selection-unsupported = This Zotero version does not expose the reader selection API (_selectionRanges), so the selection cannot be read. Please upgrade to Zotero 10.

## Block 2 — language bar
pane-translate-lang-auto = Detect automatically
pane-translate-auto = Auto translate
pane-translate-target-placeholder =
    .placeholder = Target language, e.g. en-US

## Block 3 — result area (four states: loading / error / success / idle)
pane-translate-action = Translate
pane-translate-result-placeholder = Translation will appear here.
pane-translate-translating = Translating…
pane-translate-copy = Copy
pane-translate-copied = Copied
pane-translate-retry = Retry
pane-translate-copy-failed = Copy failed: { $error }
pane-translate-error = Translation failed: { $error }
pane-translate-error-empty = Empty translation: the service returned nothing usable. Try again, or pick a different target language.
pane-translate-error-service = Translation service unavailable: could not load the engine module ({ $error }). Restart Zotero and try again; if it still fails, check Zotero's debug output.
pane-translate-error-not-ready = Translation is not ready: { $reason }. Complete the setup in the settings and try again.
pane-translate-error-too-long = The selection is { $count } characters, above the { $max }-character limit per request. Narrow the selection and try again.

## Single-word lookup (dictionary card) and the recent-words chip strip
pane-translate-lookup-action = Look up
pane-translate-looking-up = Looking up…
pane-translate-recent = Recent words
pane-translate-card-source-youdao = Source: Youdao Dictionary
pane-translate-card-source-model = Source: model engine
pane-translate-card-source-mt = Source: translation engine

## ─── Word-cards tab (src/ui/wordCardsTab.ts + src/modules/registerWordCardsUI.ts)
tools-wordcards = Word Cards
wordcards-tab-title = Word Cards
wordcards-toolbar-tooltip = Word cards (words you looked up)
wordcards-search-placeholder =
    .placeholder = Search words or meanings
wordcards-sort-recent = Recent
wordcards-sort-alpha = Alphabetical
wordcards-clear = Clear all
wordcards-clear-confirm = Clear all word cards?
wordcards-count = { $count } cards
wordcards-empty-title = No word cards yet
wordcards-empty-hint = Select a single word in the PDF reader — every lookup accumulates into a card here.
wordcards-disabled-hint = Word card recording is turned off in the settings; new lookups accumulate again once it is re-enabled.
wordcards-history = Lookup history
wordcards-speak = Read aloud
wordcards-speak-examples = Read examples
wordcards-stop = Stop
wordcards-delete = Delete
wordcards-detail-empty = Select a card on the left to see its details.
wordcards-no-match = No matching cards.

## ─── Library item context menu (src/modules/registerItemTreeMenu.ts) ──────
itemtree-menu = 文献译读
itemtree-translate-attachment = Translate full text (save as attachment)
itemtree-translate-split = Split-screen translation

## ─── Bilingual reading (src/ui/bilingualControl.ts + src/core/pdf/sdt/) ───
bilingual-enable = Bilingual reading
bilingual-mode-interleave = Interleaved (original + translation)
bilingual-mode-trans-only = Translation only
bilingual-peek-hint = Click to show the original text of this paragraph
bilingual-progress = { $done }/{ $total } paragraphs translated
bilingual-progress-failed = { $done }/{ $total } paragraphs translated, { $failed } failed: { $error } (click a failed paragraph to retry)
bilingual-placeholder = Translating…
bilingual-block-failed = Translation failed
bilingual-retry = Retry
bilingual-sdt-loading = Preparing the document structure…
bilingual-sdt-unavailable = Bilingual reading requires the Zotero 10 reading mode. Still available here: side-by-side split view and full-text translation to attachment.
bilingual-sdt-missing = The document-structure session could not be established: this PDF may have no extractable text (a scan, or outlined glyphs), or the reading view is not ready yet. This version has no OCR — please use a PDF with a text layer. The split view and translated attachment need a text layer too.
bilingual-sdt-unpack-failed = The document structure is unavailable ({ $error }). The split view and full-text translation remain available.
bilingual-no-text = This PDF has no extractable text — it may be a scan or have a broken text layer. This version has no OCR: use a PDF with a text layer, or run OCR in another tool first. The split view and translated attachment need a text layer too.
bilingual-toolbar-tooltip = Toggle bilingual overlay
bilingual-section-title = Bilingual reading

## ─── Read aloud (src/core/readAloud/) ──────────────────────────────────────
readaloud-original = Read original
readaloud-translation = Read translation
readaloud-pause = Pause
readaloud-resume = Resume
readaloud-prev = Previous sentence
readaloud-next = Next sentence
readaloud-stop = Stop
readaloud-unsupported = Read aloud is unavailable in this environment (no speech interface). Install a system voice package and retry.
readaloud-no-content = There is no readable text.
readaloud-start-failed = Read aloud failed to start: { $error }

# Full-text pipeline progress / errors (batch translate + ODL client).
pdf-progress-batch-start = Batch translating {count} paragraphs ({chunks} chunk groups){cache}…
pdf-progress-batch-cache = , {hit} from cache
pdf-progress-batch-progress = Batch translation: {done}/{total} chunk groups
pdf-warn-vlm-unconfigured = Formula vision extraction unavailable: no OpenAI-compatible endpoint configured (translate.custom.apiUrl).
err-vlm-empty = Vision model returned an empty result
err-java-unavailable = Java unavailable: {detail}
err-parse-no-pages = Parsing finished but produced no pages
err-java-too-old = Detected Java {version}, but OpenDataLoader requires Java 11+. Install a newer version from https://adoptium.net.
err-jar-load = Failed to load JAR file ({path}): {message}
input-engine-changed = The translation engine changed. Translate again to use the new service.

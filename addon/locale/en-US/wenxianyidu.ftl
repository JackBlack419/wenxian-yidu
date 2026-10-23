## 文献译读 — core strings.
##
## Message ids are written WITHOUT the `wenxianyidu-` prefix on purpose:
## zotero-plugin-scaffold's build.fluent (prefixFluentMessages, default on)
## prefixes every message with `${namespace}-` when it copies these files into
## the build output, and src/utils/locale.ts reads them back with the same
## `${addonRef}-` prefix. Don't hand-add the prefix here.
##
## The zh-CN locale (addon/locale/zh-CN/) must keep the exact same key set —
## Zotero picks a plugin locale per file and falls back to en-US.

## Shared title (progress-window headlines / dialog titles)
app-title = 文献译读

## Engine errors and hints (src/core/translation/translationEngines.ts)
## Key names follow leadero's translation-error-* naming. The `ai-prompt-*`
## keys double as the template rejection reasons reported by
## src/core/translation/promptTemplate.ts (each rule has its own message, both
## for the runtime error and for the settings pane's inline hint).
translation-error-google-empty = Google Translate returned an empty result
translation-error-bing-empty = Bing Translator returned an empty result
translation-error-deepl-empty = DeepL returned an empty result
translation-error-custom-empty = Custom API returned an empty result
translation-error-google-failed = Google translation failed
translation-error-bing-failed = Bing translation failed
translation-error-deepl-failed = DeepL translation failed
translation-error-custom-failed = Custom API translation failed
translation-error-pdf-translate-failed = zotero-pdf-translate translation failed
translation-error-bing-not-configured = Bing translation has no API key configured
translation-error-deepl-not-configured = DeepL translation has no API key configured
translation-error-custom-url-missing = Custom translation API URL is not configured
translation-error-unknown = Unknown error
translation-error-bing-token-unavailable = Could not obtain the Bing translation token (the page structure may have changed)
translation-error-bing-rejected = Bing rejected the request ({ $status })
translation-error-pdf-translate-missing = The zotero-pdf-translate plugin is not installed or not enabled. Install and enable it in Zotero's plugin manager.
translation-error-ai-empty = AI translation returned an empty result
translation-error-ai-failed = AI translation failed
translation-error-ai-url-missing = AI translation API URL is not configured
translation-error-rate-limited = The translation service is rate-limiting requests: waited and retried automatically, still rejected. Keyless trial endpoints only allow a few requests per minute (Youdao trial: about 6); try again later, or choose Bing trial, an official endpoint, or your own AI API in settings.

## AI engine prompt template rejections (src/core/translation/promptTemplate.ts)
translation-error-ai-prompt-too-long = The AI prompt template is too long (at most 4000 characters).
translation-error-ai-prompt-unknown-placeholder = The AI prompt template contains an unknown placeholder — only {"{{"}text{"}}"}, {"{{"}sourceLang{"}}"} and {"{{"}targetLang{"}}"} (double braces) are supported.
translation-error-ai-prompt-missing-text = The AI prompt template is missing {"{{"}text{"}}"} — that is where the text to translate goes.
translation-error-ai-prompt-duplicate-text = The AI prompt template contains {"{{"}text{"}}"} more than once — the source text may only be sent once.
translation-error-ai-prompt-missing-source-lang = The AI prompt template is missing {"{{"}sourceLang{"}}"} — that is where the source language name goes.
translation-error-ai-prompt-missing-target-lang = The AI prompt template is missing {"{{"}targetLang{"}}"} — that is where the target language name goes.
translation-error-ai-prompt-unbalanced-braces = The AI prompt template has unbalanced braces — placeholders use double braces ({"{{"}text{"}}"}) while formula markers use single braces ({"{"}v0{"}"}).

## Translation feature readiness (src/core/translation/featureReadiness.ts)
readiness-reason-engine-key = Translation engine API key is missing
readiness-reason-engine-url = Custom translation endpoint URL is missing
readiness-reason-engine-plugin = The zotero-pdf-translate plugin is not installed or not enabled
readiness-reason-ai-prompt = The AI engine's prompt template is invalid — fix it in the settings pane
readiness-reason-unknown = Unknown reason

## Split view menus (src/core/pdf/splitview/splitViewFactory.ts)
splitview-menu-root = 文献译读
splitview-menu-compare = Split-screen reading
splitview-menu-translate = Split-screen translation
splitview-menu-interleave = Interlinear translation
splitview-menu-trans-only = Translation only
splitview-menu-cancel = Cancel translation in progress

## Reader toolbar (src/modules/registerReaderToolbar.ts)
toolbar-title = Translate
toolbar-status = Engine: { $engine } · Target: { $lang }
toolbar-lang-zh-cn = Simplified Chinese
toolbar-lang-zh-tw = Traditional Chinese
toolbar-lang-en = English
toolbar-lang-ja = Japanese
toolbar-lang-ko = Korean
toolbar-selection = Selection translation
toolbar-input = Translate text
toolbar-tasks = Translation tasks…
toolbar-settings = Translation settings…
toolbar-pdf-only = This version translates text-based PDFs only — EPUB, snapshots and web attachments are not supported.
toolbar-no-reader = Open a PDF in the reader first.
toolbar-reuse-title = Translation available
toolbar-reuse-body = This document already has a complete translation for the current engine and target language. Reuse it to open the split view right away, or translate again to replace it.
toolbar-reuse-accept = Reuse translation
toolbar-reuse-retranslate = Translate again
toolbar-reuse-cancel = Cancel
toolbar-progress-running = Translating { $done }/{ $total }
toolbar-progress-starting = Translating…
toolbar-progress-failed = { $failed } paragraphs failed
toolbar-resume = Continue translation
toolbar-progress-hint = Current task: { $title }

## OpenDataLoader pipeline errors (src/core/pdf/splitview/splitViewFactory.ts)
odl-error-java-missing = Translation requires Java 11 or later.
odl-error-jar-missing = The OpenDataLoader parsing component is missing (jar file not found). Please reinstall the plugin.
odl-error-jar-unreadable = The parsing component could not be read (Java cannot access the jar file). Check whether antivirus software quarantined it, then check the file's permissions, or reinstall the plugin.
odl-error-jar-download-failed = The parsing component could not be downloaded automatically. Check the network and retry; if it keeps failing, use the full installer that bundles the component.
odl-jar-download-window = Downloading the OpenDataLoader parsing component
odl-jar-download-probe = Testing mirrors…
odl-jar-download-downloading = Downloading ({ $percent }%)
odl-jar-download-verifying = Verifying and installing…
err-jar-load = Could not read the parsing component jar file (invalid path): { $path } ({ $message })
odl-error-file-path = Invalid file path: the PDF or Java path is not valid. Check the Zotero data directory permissions, or restart Zotero.
odl-error-network = { $detail }
odl-error-not-configured = Translation is not configured. Pick a translation engine and fill in its credentials in Zotero's 文献译读 settings.
odl-error-parse-empty = { $detail }
odl-error-http-auth = The translation service rejected the request (HTTP { $code }): the API key is invalid or lacks access. Check the key in the 文献译读 settings.
odl-error-http-rate = The translation service is busy or the quota is exhausted (HTTP { $code }). Try again later.
odl-error-http-other = The translation service returned an error (HTTP { $code }): { $detail }

## Split view errors and progress (splitViewFactory / readerPaneAdapter /
## splitViewCleanup)
splitview-error-dialog-title = Split View (文献译读)
splitview-error-open = Could not open the split view: { $detail }
splitview-error-tab-create = Failed to create the split-view tab (container not ready).
splitview-error-container-timeout = The split-view container ({ $tabID }) did not appear in the DOM within 2 s.
splitview-error-reader-timeout = The reader did not finish initializing within 10 s; the split view was aborted.
splitview-error-scroll-timeout = The split-view readers' scroll areas did not become ready in time; page sync is unavailable.
splitview-error-no-item = Could not resolve the PDF attachment for the current reader. Reopen the item and try again.
splitview-error-in-flight = A translation is already in progress. Use "Cancel translation in progress" in the reader context menu.
splitview-tab-title = { $left } | { $right }

## Item tree context menu progress (src/modules/registerItemTreeMenu.ts)
itemtree-progress-attachment = 文献译读: Translating full text…
itemtree-open-failed = Could not open the translated attachment automatically. Open it manually from the item.
itemtree-interleave = Interlinear translation
itemtree-trans-only = Translation only
itemtree-launch-progress = 文献译读: preparing bilingual overlay…
itemtree-launch-done = Bilingual overlay ready
itemtree-launch-no-reader = Could not resolve an open reader for this item. Reopen the PDF and try again.

## Translated attachment (src/core/pdf/translation/translatedAttachment.ts)
translated-tag = Translated

## Java runtime install flow (splitViewFactory / JavaRuntimeManager)
java-dialog-title = Java required
java-dialog-body =
    Java 11 or later is required for "Translate and open side by side".

    "Download and install": fetches the ~40 MB Java runtime and extracts it
    into the plugin's data directory — no administrator rights needed.
    "Open download page": opens https://adoptium.net in your browser so you
    can install manually.
    "Cancel": do nothing for now.
java-dialog-button-download = &Download and install
java-dialog-button-openpage = &Open download page
java-dialog-button-cancel = Cancel
java-progress-install = Installing the Java runtime…
java-progress-download-prepare = Preparing download…
java-progress-retry = ✓ Java installed. Click "Translate and open side by side" again.
java-install-failed =
    Java installation failed: { $detail }
    Please download and install it manually from https://adoptium.net, then retry.
java-progress-already-installed = The Java runtime is already installed.
java-progress-self-heal = The managed Java runtime is broken — reinstalling automatically…
java-progress-download-start = Downloading Java { $version } JRE ({ $archive })…
java-progress-downloading = Downloading… { $percent }%
java-progress-reuse-archive = Reusing the previously downloaded archive (checksum verified) — skipping the download…
java-error-download-failed = Download failed: { $detail }
java-error-download-http = Download failed: HTTP { $status }
java-error-checksum-mismatch = Installer archive failed checksum verification (SHA-256 mismatch) and was discarded. Please retry.
java-progress-extracting = Extracting…
java-progress-verifying = Verifying the installation…
java-error-extract-failed = Extraction failed: { $detail }
java-error-exe-not-found = No java executable found after extraction (in { $dir }). Please install Java manually from https://adoptium.net.
java-error-probe-failed = The downloaded Java failed to run: { $detail }
java-progress-done = Java installation complete

## OpenDataLoader pipeline progress and errors
## (opendataloaderSplitAdapter / splitViewFactory / registerItemTreeMenu)
odl-progress-translating = 文献译读: Translating full text…
odl-error-dialog-title = Translate and split (OpenDataLoader)
odl-progress-done-split = Done: opened side by side — "{ $title }"
odl-progress-cancelled = Translation cancelled
odl-error-engine-not-ready = The translation engine is not fully configured: { $gaps }. Complete the settings in 文献译读 preferences and retry.
odl-progress-parsing = Parsing the PDF layout…
odl-error-source-path = Could not resolve the source PDF file path.
odl-error-parse-failed = Parsing failed: { $detail }
odl-error-parse-no-pages = The PDF parse returned no pages (the file may be empty or a scanned image).
odl-error-parse-no-text = Parsing finished but no text paragraphs were extracted (the PDF may be pure images).
odl-progress-formula-vlm = Extracting formulas with the vision model ({ $count } blocks)…
odl-progress-formula-novlm = { $count } formula blocks detected, but no vision model is configured; formulas will be translated as regular text (may be inaccurate).
odl-progress-font-missing = ⚠️ Could not find { $fontFile } or a system default font — translated text will show as "?". Place the font into { $assetsDir }
odl-progress-overlay = Overlaying the translation onto the original PDF (images, tables and layout preserved)…
odl-progress-remove-original = Removing the original text of translated paragraphs…
odl-progress-render-white = Rendering the translation (white-page mode)…
odl-error-render-empty = Rendering produced no pages.
odl-progress-summary = Done: { $pages } pages, { $paragraphs } paragraphs
odl-progress-summary-failed = ; { $failed } paragraphs failed and keep the original text
odl-progress-summary-nosplit = Done: { $pages } pages, { $paragraphs } paragraphs (translation saved, but the split view failed to open)
odl-progress-opening-split = Opening the split view…
odl-error-no-split-opener = The split-view opener is unavailable (internal error: the split flow is missing openSplitView).
odl-error-reader-pdf-timeout = The reader's pdf.js did not become ready within 15 s.
odl-progress-crop-reader-missing-skip = Could not open a reader for formula screenshots; skipping formula extraction.
odl-progress-crop-reader-missing-text = Could not open a reader for formula screenshots; formulas will be handled as text.
odl-progress-crop-progress = Formula extraction progress: { $current }/{ $total }
odl-progress-crop-done = Formula extraction finished: { $ok } succeeded
odl-progress-crop-fallback = , { $count } fell back to screenshots
odl-progress-crop-failed = , { $count } failed and keep the original text
odl-progress-shot-progress = Formula screenshot progress: { $current }/{ $total }
odl-progress-shot-done = Formula screenshots finished: { $ok } succeeded
odl-progress-shot-failed = , { $count } failed

## Layout preserving renderer (LayoutPreservingRenderer.ts)
render-error-rotated-page = Rotated pages are not supported yet (/Rotate { $angle }°). Straighten the PDF before translating.

## Dictionary card lookup chain (src/core/translation/dictionaryCard.ts)
dictionary-error-all-failed = Dictionary lookup failed: neither the dictionary nor the configured translation engines returned a result ({ $error }).
dictionary-error-unavailable = Dictionary lookup failed: { $error }

panel-close = Close translation panel
panel-resize = Resize translation panel
models-unsupported = This endpoint does not support model lists. Enter a model manually.
models-empty = The endpoint returned no models. Enter a model manually.
split-return-original = Close translation and return to original

engine-label-mtranserver = MTranServer offline
offline-process-failed = The offline process failed. Prepare it again and retry.
offline-download-failed = Runtime download failed. Check your connection and retry.
offline-checksum-failed = Offline component checksum failed. Prepare it again.
offline-prepare-failed = Offline preparation failed: { $error }
offline-timeout = Offline preparation or startup timed out. Cancel and retry.
offline-platform = Offline preparation currently supports Windows x64.
offline-dependencies-failed = Offline dependency installation failed. Check your connection and retry.
offline-language = Only English to Simplified Chinese is prepared.
offline-not-ready = Click Prepare offline translation in settings and wait for the trial to finish.
offline-translation-failed = Offline translation failed. Prepare again; no text was sent to an online service.

toolbar-reuse-partial = This translation is incomplete. Continue using completed segments.
toolbar-reuse-different = This translation has a different source or configuration. Open the older translation or translate with current settings.
toolbar-retry-failed = Retry failed paragraphs ({ $failed })

engine-label-google = Google Translate
workspace-offline-notice = Runs on your CPU after preparation. Failures never fall back to online services. Prepare offline translation in settings first and verify important translations.

engine-selection-required = Choose a translation engine before your first translation. Settings will open; choose a free online engine or prepare the local offline engine.

offline-stage-missing = Not prepared
offline-stage-downloading = Downloading runtime
offline-stage-verifying = Verifying runtime
offline-stage-extracting = Extracting runtime
offline-stage-dependencies = Preparing dependencies
offline-stage-models = Downloading model
offline-stage-verifying-model = Verifying model
offline-stage-model-extracting = Extracting model
offline-stage-initializing = Initializing engine
offline-stage-trial = Running trial translation
offline-stage-ready = Offline translation ready
offline-stage-cancelling = Cancelling
offline-stage-cancelled = Preparation cancelled
offline-stage-failed = Preparation failed
offline-stage-working = Preparing offline engine
offline-progress-title = Offline engine preparation
offline-progress-hint = Progress refers to the current stage. Verification, extraction and a trial translation must complete before the engine is ready.
offline-progress-details = View details
offline-progress-cancel = Cancel preparation
offline-progress-retry = Retry preparation
offline-progress-settings = Open settings
offline-progress-dismiss = Dismiss

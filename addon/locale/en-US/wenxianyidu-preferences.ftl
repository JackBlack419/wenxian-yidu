## 文献译读 — preferences pane copy (Edit → Settings → 文献译读).
##
## Message ids start with `preferences-wenxianyidu-`, mirroring Zotero's own
## `preferences-*` convention while avoiding collisions with Zotero's message
## ids (plugin FTLs share one Fluent registry with Zotero's — see
## Zotero.Plugins#registerLocales).
##
## Message ids are written WITHOUT the leading `wenxianyidu-` prefix: the build
## adds it (zotero-plugin-scaffold's build.fluent, prefixFluentMessages default
## on) and reads it back the same way — see the header of wenxianyidu.ftl.
##
## Conventions:
##   - `<description>` and `<html:h2>` section headings use plain message values
##     (Fluent writes them into the text content);
##   - XUL `<label>` renders its `value` attribute, never the text content, so
##     its message must use `.value`; the static `value` in preferences.xhtml
##     is kept as the fallback for when Fluent is unavailable;
##   - `<checkbox>` / `<button>` / `<menuitem>` must use `.label` (XUL elements
##     only render the label attribute, never the text content);
##   - every adjustable setting gets a `-desc` entry explaining what it does,
##     what an empty value means, and the default behaviour.
##
## The zh-CN locale (addon/locale/zh-CN/) must keep the exact same key set —
## Zotero picks a plugin locale per file and falls back to en-US.

## Section headings
preferences-wenxianyidu-general = General
preferences-wenxianyidu-engine = Translation engines
preferences-wenxianyidu-pdf = PDF split-screen translation

## Pane intro (rendered under the title by Zotero)
preferences-wenxianyidu-intro = Configure the text translation engines and the runtime requirements for PDF split-screen translation.

## ── General ────────────────────────────────────────────────────────────────
preferences-wenxianyidu-translate-enabled =
    .label = Enable text translation
preferences-wenxianyidu-translate-enabled-desc =
    When on, translation entry points appear in the item pane and the reader.
    When off, the translate button and automatic translation are disabled, but
    the engine keys and other settings you entered are kept, so you can
    re-enable it at any time.

preferences-wenxianyidu-translate-auto =
    .label = Translate automatically when an item opens
preferences-wenxianyidu-translate-auto-desc =
    Translates as soon as a reader item or a selection opens, without pressing
    the "Translate" button. Requires "Enable text translation" above.
    Automatic translation sends segmented requests within the character limit
    below, so opening long documents produces more network requests.

preferences-wenxianyidu-translate-max-chars =
    .value = Maximum characters per request
preferences-wenxianyidu-translate-max-chars-desc =
    Upper bound of characters submitted to the engine per request; 100–50000,
    default 10000. Longer text is segmented automatically, so a larger value
    only reduces the number of segments while making each request bigger; a
    smaller value is more conservative but segments more, which is more likely
    to break the meaning at segment boundaries. Invalid or empty input keeps
    the previous valid value; the setting is not overwritten.
preferences-wenxianyidu-translate-max-chars-range = Enter an integer between 100 and 50000.

preferences-wenxianyidu-translate-batch-tokens =
    .value = Merged batch input cap (tokens)
preferences-wenxianyidu-translate-batch-tokens-desc =
    Full-text translation and bilingual interleave merge several paragraphs
    into one model request; this caps the merged input size in estimated
    tokens, 1000–65536, default 8192. When the next paragraph would exceed the
    budget the batch closes early (one paragraph short) instead of sending an
    over-budget request. Larger batches mean fewer calls and richer context,
    but a reasoning model's thinking overhead grows with batch size, and so
    does the risk of an empty answer from an exhausted output budget.
preferences-wenxianyidu-translate-batch-tokens-range = Enter an integer between 1000 and 65536.

## ── Translation engines ────────────────────────────────────────────────────
preferences-wenxianyidu-engine-type =
    .value = Engine
preferences-wenxianyidu-engine-type-desc =
    Pick the engine used for text translation. Switching engines keeps the
    credentials entered for the other engines, so you can switch back at any
    time; only the currently selected engine is used.

## ── Network region ─────────────────────────────────────────────────────────
preferences-wenxianyidu-region =
    .value = Network region
preferences-wenxianyidu-region-auto =
    .label = Automatic (undeclared)
preferences-wenxianyidu-region-global =
    .label = Global
preferences-wenxianyidu-region-cn =
    .label = Mainland China
preferences-wenxianyidu-region-desc =
    Declare your network environment and the plugin writes that region's
    recommended values into settings still at their factory defaults (for
    example, mainland China defaults to the keyless Bing web engine). Engines
    you picked explicitly are never overridden by the region choice; keeping
    "Automatic" changes nothing.
preferences-wenxianyidu-region-note-applied =
    Recommendations applied for the selected region: settings still at their
    factory defaults were rewritten; engines you picked explicitly were left
    untouched.
preferences-wenxianyidu-region-note-nochange =
    Nothing changed: the relevant settings already match the selected region's
    recommendations, or you customized them.

preferences-wenxianyidu-engine-google =
    .label = Google Translate
preferences-wenxianyidu-engine-bing =
    .label = Bing Translator
preferences-wenxianyidu-engine-bingweb =
    .label = Bing web (keyless)
preferences-wenxianyidu-engine-deepl =
    .label = DeepL
preferences-wenxianyidu-engine-ai =
    .label = AI translation (OpenAI-compatible)
preferences-wenxianyidu-engine-custom =
    .label = Custom (OpenAI-compatible)
preferences-wenxianyidu-engine-zotero-pdf-translate =
    .label = zotero-pdf-translate plugin
preferences-wenxianyidu-engine-zotero-pdf-translate-missing = zotero-pdf-translate plugin (not installed)

## The "Show key" checkbox next to key inputs (temporarily reveals the value;
## never writes it anywhere)
preferences-wenxianyidu-show-key =
    .label = Show key
    .tooltiptext = Temporarily shows the key in plain text so you can check what you pasted. Affects only this input box; nothing is written to the settings.

## Google
preferences-wenxianyidu-google-api-key =
    .value = Google API key
preferences-wenxianyidu-google-api-key-desc =
    Optional: leave empty to use the keyless Google endpoint, or enter a key for the official Google API. Errors are shown without switching providers. Availability, quotas and charges depend on the selected endpoint.

## Bing
preferences-wenxianyidu-bing-api-key =
    .value = Bing API key
preferences-wenxianyidu-bing-api-key-desc =
    Required. The key for the Microsoft Translator REST API, from a
    "Translator" resource in the Azure portal. Without it, Bing translation
    fails immediately.
preferences-wenxianyidu-bing-region =
    .value = Region
preferences-wenxianyidu-bing-region-desc =
    Optional. Multi-region resources (e.g. chinaeast2) must match the region
    you signed up with; global resources just use "global". A wrong value
    returns an authentication error.

## Bing web translation (keyless)
preferences-wenxianyidu-engine-bingweb-desc =
    Keyless and configuration-free. Uses the Bing Translator web endpoint — the
    only engine reachable in mainland China without a key. A good pick when you
    know Google is blocked and don't want to pay its timeout on every
    paragraph. The session token refreshes automatically and a failed request
    is retried once.

## DeepL
preferences-wenxianyidu-deepl-api-key =
    .value = DeepL API key
preferences-wenxianyidu-deepl-api-key-desc =
    Required. The DeepL API authentication key; without it, DeepL translation
    fails immediately.
preferences-wenxianyidu-deepl-use-free =
    .label = Use the DeepL free API
preferences-wenxianyidu-deepl-use-free-desc =
    Free keys (ending in ":fx") must enable this; Pro keys must disable it.
    The wrong choice returns a 401/403 authentication error.

## AI translation (OpenAI-compatible + user-owned prompt template)
preferences-wenxianyidu-ai-api-url =
    .value = Endpoint URL
preferences-wenxianyidu-ai-api-url-desc =
    Required. An OpenAI-compatible chat/completions URL, e.g.
    https://api.example.com/v1/chat/completions, or a local model service such
    as http://127.0.0.1:11434/v1. Translation fails when empty.
preferences-wenxianyidu-ai-api-key =
    .value = API key
preferences-wenxianyidu-ai-api-key-desc =
    Optional. Usually required for hosted services; local model services
    (Ollama, LM Studio, …) generally need no key, and leaving it empty means no
    Authorization header is sent at all.
preferences-wenxianyidu-ai-model =
    .value = Model
preferences-wenxianyidu-ai-model-desc =
    Optional. The model name to call, e.g. gpt-4o-mini, qwen-max, glm-4.7.
    When empty, the server picks its default model, with no guarantee on
    translation quality.
preferences-wenxianyidu-ai-prompt =
    .value = Translation prompt template
preferences-wenxianyidu-ai-prompt-desc =
    What gets sent to the model. Empty means "use the built-in default
    template". The template must contain three placeholders — {"{{"}text{"}}"}
    (the text to translate), {"{{"}sourceLang{"}}"} (the source language name)
    and {"{{"}targetLang{"}}"} (the target language name) — and the plugin
    fills in the language names as readable names such as "Simplified Chinese".
    Formulas are replaced by markers like {"{"}v0{"}"} and {"{"}v1{"}"} before
    translation; the default template asks the model to keep them verbatim. An
    invalid template is never written to the settings, and selecting this
    engine while one is stored is blocked by the readiness check, which points
    back here.
preferences-wenxianyidu-ai-prompt-restore =
    .label = Restore the default template

## AI prompt template rejection reasons (mirrors the engine's runtime errors,
## shown inline while editing; the JS only copies the localized text)
preferences-wenxianyidu-ai-prompt-error-too-long =
    The template is too long (at most 4000 characters).
preferences-wenxianyidu-ai-prompt-error-unknown-placeholder =
    The template contains an unknown placeholder — only {"{{"}text{"}}"}, {"{{"}sourceLang{"}}"} and {"{{"}targetLang{"}}"} (double braces) are supported.
preferences-wenxianyidu-ai-prompt-error-missing-text =
    The template is missing {"{{"}text{"}}"} — that is where the text to translate goes.
preferences-wenxianyidu-ai-prompt-error-duplicate-text =
    The template contains {"{{"}text{"}}"} more than once — the source text may only be sent once.
preferences-wenxianyidu-ai-prompt-error-missing-source-lang =
    The template is missing {"{{"}sourceLang{"}}"} — that is where the source language name goes.
preferences-wenxianyidu-ai-prompt-error-missing-target-lang =
    The template is missing {"{{"}targetLang{"}}"} — that is where the target language name goes.
preferences-wenxianyidu-ai-prompt-error-unbalanced-braces =
    The template has unbalanced braces — placeholders use double braces ({"{{"}text{"}}"}), formula markers use single braces ({"{"}v0{"}"}).

## Custom (OpenAI-compatible)
preferences-wenxianyidu-custom-api-url =
    .value = Endpoint URL
preferences-wenxianyidu-custom-api-url-desc =
    Required. An OpenAI-compatible chat/completions URL, e.g.
    https://api.example.com/v1/chat/completions. Translation fails when empty.
preferences-wenxianyidu-custom-api-key =
    .value = API key
preferences-wenxianyidu-custom-api-key-desc =
    Required. The key for that service, usually sent as
    Authorization: Bearer <key>. Translation fails when empty.
preferences-wenxianyidu-custom-model =
    .value = Model
preferences-wenxianyidu-custom-model-desc =
    Optional. The model name to call, e.g. gpt-4o-mini. When empty, the server
    picks its default model, with no guarantee on translation quality.

## zotero-pdf-translate
preferences-wenxianyidu-pdftranslate-installed =
    The zotero-pdf-translate plugin was detected; text translation requests are
    handed over to it.
preferences-wenxianyidu-pdftranslate-missing =
    The zotero-pdf-translate plugin was not detected. Install and enable it
    under Zotero's "Tools → Plugins", otherwise selecting this engine fails.

## ── PDF split-screen translation ───────────────────────────────────────────
preferences-wenxianyidu-pdf-java-title =
    .value = Java runtime
preferences-wenxianyidu-pdf-java-desc =
    Layout-preserving PDF translation needs Java 11 or later to parse the PDF
    content. Without Java the feature is unavailable: right-click the PDF in
    the reader and choose "Translate and split" — the check runs
    automatically, and when Java is missing a dialog walks you through
    installing a portable runtime (about 40MB, unpacked into the data
    directory, no administrator rights needed). Click the menu again once it is
    installed. "Install / repair…" below also installs or reinstalls on
    demand, at any time.

preferences-wenxianyidu-pdf-java-check =
    .label = Check status
preferences-wenxianyidu-pdf-java-install =
    .label = Install / repair…
preferences-wenxianyidu-pdf-java-installing =
    .label = Installing…
preferences-wenxianyidu-pdf-java-status-checking =
    Checking the Java runtime…
preferences-wenxianyidu-pdf-java-status-installing =
    Downloading and installing the Java runtime; progress is shown in the
    Zotero main window. This status refreshes automatically when it finishes.
preferences-wenxianyidu-pdf-java-status-ready-managed =
    Java runtime available: { $version } (portable runtime managed by the
    plugin, inside the data directory).
preferences-wenxianyidu-pdf-java-status-ready-system =
    Java runtime available: { $version } (system installation).
preferences-wenxianyidu-pdf-java-status-missing =
    No usable Java runtime was detected. Click "Install / repair…" to download
    the portable runtime automatically (about 45MB, installed into the data
    directory, no administrator rights needed).
preferences-wenxianyidu-pdf-java-status-error =
    The check failed: { $detail }
preferences-wenxianyidu-pdf-java-status-nobundle =
    The plugin main bundle is not loaded, so the runtime cannot be checked or
    installed here. Restart Zotero; if it still does not recover, reinstall
    the plugin.

## OpenDataLoader parsing component (download/repair entry of the slim build)
preferences-wenxianyidu-pdf-odl-comp =
    .value = Parsing component
preferences-wenxianyidu-pdf-odl-comp-check =
    .label = Check status
preferences-wenxianyidu-pdf-odl-comp-download =
    .label = Download / repair…
preferences-wenxianyidu-pdf-odl-comp-downloading =
    .label = Downloading…
preferences-wenxianyidu-pdf-odl-comp-desc =
    The slim build does not bundle the ~24MB parsing component: the first
    "Translate and split" downloads it from the mirrors automatically and,
    after byte-for-byte verification, saves it into the data directory. If
    the component is missing or a download failed, click "Download /
    repair…" to retry; progress is shown in the Zotero main window.
preferences-wenxianyidu-pdf-odl-comp-status-checking =
    Checking the parsing component…
preferences-wenxianyidu-pdf-odl-comp-status-downloading =
    Downloading the parsing component; progress is shown in the Zotero main
    window. This status refreshes automatically when it finishes.
preferences-wenxianyidu-pdf-odl-comp-status-ready-landed =
    Parsing component ready: { $version } (downloaded into the data
    directory).
preferences-wenxianyidu-pdf-odl-comp-status-ready-bundled =
    Parsing component ready: { $version } (bundled with the plugin).
preferences-wenxianyidu-pdf-odl-comp-status-missing =
    The parsing component was not found. Click "Download / repair…" to fetch
    it from the mirrors automatically (about 24MB, saved into the data
    directory — no plugin reinstall needed); if the download fails, check
    the network and retry.
preferences-wenxianyidu-pdf-odl-comp-status-error =
    The check failed: { $detail }
preferences-wenxianyidu-pdf-odl-comp-download-failed =
    The download failed: { $detail }
preferences-wenxianyidu-pdf-odl-comp-status-nobundle =
    The plugin main bundle is not loaded, so the component cannot be checked
    or downloaded here. Restart Zotero; if it still does not recover,
    reinstall the plugin.

preferences-wenxianyidu-pdf-fonts-title =
    .value = Font override directory
preferences-wenxianyidu-pdf-fonts-desc =
    Put custom font files into the directory below to override the default
    fonts used by PDF translation: name the regular face translated-regular.ttf,
    and the bold / italic / bold-italic faces translated-bold.ttf,
    translated-italic.ttf, translated-bold-italic.ttf (.otf / .ttc work too).
    Noto Serif SC matches the serif look of most papers. The directory is
    created automatically when missing; fonts placed there take effect on the
    next translation.
preferences-wenxianyidu-pdf-fonts-path =
    .value = Font directory

# Fallback label for the font directory when the data directory is unknown
# (braces escaped per Fluent syntax)
preferences-wenxianyidu-data-dir-placeholder = {"{"}Data directory{"}"}

preferences-wenxianyidu-pdf-lang-title =
    .value = Translation language
preferences-wenxianyidu-pdf-lang =
    .value = Target language
preferences-wenxianyidu-pdf-lang-desc =
    Target language for PDF split-screen translation; the Zotero 10 bilingual
    view and read-aloud of the translation also use it as their default target
    language. Enter a BCP-47 code such as zh-CN, en-US or ja-JP. When empty it
    follows Zotero's UI language (the default). Text translation in the reader
    pane has its own target-language box and is unaffected by this setting.

## OpenDataLoader parsing options (addon/prefs.js pdfParser.opendataloader.*)
preferences-wenxianyidu-pdf-odl-title =
    .value = OpenDataLoader parsing options
preferences-wenxianyidu-pdf-odl-desc =
    These options control the local Java parsing component and affect the
    layout-parsing quality and duration of "Translate and split". Except for
    the timeout, changes take effect on the next translation.
preferences-wenxianyidu-pdf-odl-enabled =
    .label = Enable OpenDataLoader parsing
preferences-wenxianyidu-pdf-odl-enabled-desc =
    OpenDataLoader is the only layout-parsing backend used by "Translate and
    split". When off, the feature fails immediately and asks you to re-enable
    it here; unless it genuinely cannot run on your system, keep it on.
preferences-wenxianyidu-pdf-odl-table =
    .value = Table recognition
preferences-wenxianyidu-pdf-odl-table-default =
    .label = Default (bordered)
preferences-wenxianyidu-pdf-odl-table-cluster =
    .label = Cluster (borderless)
preferences-wenxianyidu-pdf-odl-table-desc =
    Table recognition method. "Default" splits along the table borders and
    suits bordered tables; "Cluster" groups text blocks and suits borderless
    tables, at the cost of longer runs and slightly more mis-detection.
preferences-wenxianyidu-pdf-odl-structtree =
    .label = Use the structure tree for reading order
preferences-wenxianyidu-pdf-odl-structtree-desc =
    When the PDF ships a structure tree (StructTree), it decides the reading
    order, which is more accurate for multi-column layouts; PDFs without one
    are unaffected, but parsing is slightly slower.
preferences-wenxianyidu-pdf-odl-timeout =
    .value = Parsing timeout (seconds)
preferences-wenxianyidu-pdf-odl-timeout-desc =
    Longest wait for a single layout parse; 30–3600 seconds, default 300. On
    large documents or slow disks a timeout shows up as a failed translation —
    before raising it, make sure Java is actually installed. Invalid or empty
    input keeps the previous valid value; the setting is not overwritten.
preferences-wenxianyidu-pdf-odl-timeout-range = Enter an integer between 30 and 3600.
preferences-wenxianyidu-pdf-odl-images =
    .label = Return embedded images
preferences-wenxianyidu-pdf-odl-images-desc =
    Has the parser output embedded page images so they are pasted back into
    the translation, keeping figures complete; when off, only text is
    translated and image areas are left blank — parsing is faster and the
    output file smaller.
preferences-wenxianyidu-pdf-removal-enabled =
    .label = Delete the original text of translated paragraphs
preferences-wenxianyidu-pdf-removal-enabled-desc =
    Before overlaying the translation, actually delete the original text of
    translated paragraphs from the PDF, so the result is searchable and
    copyable without surfacing masked-out originals. If deletion fails, the
    pipeline falls back to white masks automatically; when off, masks are
    always used.

## ── Word cards ─────────────────────────────────────────────────────────────
preferences-wenxianyidu-wordcards-enabled =
    .label = Record looked-up words (word cards)
preferences-wenxianyidu-wordcards-enabled-desc =
    When on, a single-word selection in the PDF reader is looked up as a
    dictionary card (phonetics, part of speech, senses, examples) and
    accumulates into the Word Cards tab. When off, single words are translated
    as plain text; existing cards are kept and recording can be re-enabled at
    any time.

preferences-wenxianyidu-models-fetch =
    .label = Get models
preferences-wenxianyidu-models-search =
    .placeholder = Search models
    .aria-label = Search models
preferences-wenxianyidu-models-list =
    .aria-label = Available models
preferences-wenxianyidu-models-loading = Fetching models…
preferences-wenxianyidu-models-ready = Choose a model. Listing preserves manual input; use the connection test to verify translation.
preferences-wenxianyidu-models-failed = Could not fetch models. Manual input is still available.
preferences-wenxianyidu-models-timeout = Request cancelled or timed out.

preferences-wenxianyidu-offline-phase-missing = Not prepared
preferences-wenxianyidu-offline-phase-downloading = Downloading the pinned runtime; you may cancel…
preferences-wenxianyidu-offline-phase-extracting = Verifying and extracting the runtime…
preferences-wenxianyidu-offline-phase-dependencies = Installing locked dependencies…
preferences-wenxianyidu-offline-phase-models = Downloading and converting English–Chinese models; you may cancel…
preferences-wenxianyidu-offline-phase-trial = Running a local translation trial…
preferences-wenxianyidu-offline-phase-ready = Ready: English → Simplified Chinese. Select the offline engine. Verify important translations.
preferences-wenxianyidu-offline-phase-cancelled = Cancelled. You can prepare again.
preferences-wenxianyidu-offline-phase-failed = Preparation failed. You can retry.
preferences-wenxianyidu-engine-mtranserver =
    .label = MTranServer offline
preferences-wenxianyidu-offline-start =
    .label = Prepare offline translation
preferences-wenxianyidu-offline-cancel =
    .label = Cancel preparation
preferences-wenxianyidu-offline-description = Optional: download the runtime and English–Chinese models once, then translate on your CPU. No additional tools required. The selected engine stays unchanged.

preferences-wenxianyidu-confirm-engine =
    .label = Use this engine

preferences-wenxianyidu-offline-phase-verifying = Verifying runtime
preferences-wenxianyidu-offline-phase-verifying-model = Verifying model
preferences-wenxianyidu-offline-phase-model-extracting = Extracting model
preferences-wenxianyidu-offline-phase-initializing = Initializing engine
preferences-wenxianyidu-offline-phase-cancelling = Cancelling
preferences-wenxianyidu-offline-progress =
    .aria-label = Offline engine preparation

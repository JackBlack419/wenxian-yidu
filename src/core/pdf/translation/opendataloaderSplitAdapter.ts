/**
 * opendataloaderSplitAdapter — Orchestrate translate→split using OpenDataLoader
 * for layout parsing.
 *
 * OpenDataLoader parses the PDF via a local Java jar and emits per-paragraph
 * `bbox + fontSize + text` in the exact coordinate space the renderer wants.
 * This adapter wires:
 *
 *   OpenDataLoader jar → PdfDocumentAnalysis
 *     → odlAnalysisToAssembly (per-page AssemblyResult, no assembler needed)
 *     → translateParagraphs / translateAllPagesBatched (z-transplit's
 *       configured translation engine, via src/core/translation/**)
 *     → LayoutPreservingRenderer (pdf-lib, text + optional image composite)
 *     → mergePageBytes → importTranslatedBytes → openSplitView
 *
 * Fidelity: the renderer overlays translated text onto the LOADED source PDF
 * (white masks over original text), then composites recovered figures back at
 * their bboxes. Content handling (empirically verified against real PDFs):
 *   - Raster images (embedded PNG/JPEG XObjects): ✅ recovered via
 *     --image-output embedded → PlacedImage → embedPng + drawImage.
 *   - Formulas (Σ∫√αβ… folded into text by ODL): ✅ detected, region-cropped,
 *     VLM-extracted to LaTeX, spliced back as $...$ (translation-safe). On VLM
 *     failure the crop is pasted back as an image (better than corrupted symbols).
 *   - Vector charts (matplotlib/R vector PDFs = draw instructions): ❌ NOT
 *     recovered. ODL emits only surrounding text (axis labels, legends) as
 *     paragraphs; the draw instructions produce no image/figure element and no
 *     bbox to crop. These figures are lost in the translated PDF.
 *   - Tables / background / grid lines: preserved by overlay mode (the source
 *     page is the render target), which is the default path.
 *
 * Translation engine: createTranslator() / createAIBatchTranslator() from
 * src/core/translation/translationEngines.ts, with the formula-preserving
 * prompt. Before any work starts, featureReadiness.checkTranslationReadiness()
 * preflights the configured engine; when it is not ready this throws an
 * actionable error (which prefs to fill) instead of failing midway through a
 * multi-minute parse.
 *
 * Ported from leadero's src/core/pdf/translation/opendataloaderSplitAdapter.ts.
 * Changes: MinerU fallback half removed (single OpenDataLoader backend),
 * ModelRouter narrative replaced by the local engine layer + readiness
 * preflight, leadero data-dir/log prefixes renamed.
 *
 * @module core/pdf/translation/opendataloaderSplitAdapter
 */

import { translateDocumentSegments } from "./documentSegments";
import { acquireCroppingReader } from "./croppingReader";
import { ensureEngineAvailable } from "../../translation/engineSelection";
import { parsePdfWithOpenDataLoader } from "../backendSelector";
import { odlAnalysisToAssembly } from "./odlToAssembly";
import type { FormulaBlock } from "./odlToAssembly";
import {
  extractFormulaLatex,
  isFormulaVisionAvailable,
} from "./formulaExtractor";
import { rasterizeRegionToDataURL } from "./ZoteroPdfRasterizer";
import {
  translateParagraphs,
  translateAllPagesBatched,
  type ParagraphTranslator,
} from "./translateParagraphs";
import { renderLayoutPreserving, renderOverlayTranslated } from "./LayoutPreservingRenderer";
import { mergePageBytes } from "./pdfMerge";
import {
  importTranslatedBytes,
  trashSupersededTranslations,
  translatedSourceBaseName,
  translatedTitleWithSource,
} from "./translatedAttachment";
import {
  buildRemovalRects,
  serializeRemovalRects,
} from "./removalRects";
import {
  excludeFigureTextBlocks,
  parseFigureRegionLines,
} from "./figureTextFilter";
import {
  isOriginalTextRemovalEnabled,
  inspectFormTextRegions,
  removeOriginalText,
} from "../OriginalTextRemovalClient";
import {
  createTranslator,
  supportsBatching,
  createAIBatchTranslator,
  engineCacheIdentity,
  getEngineCapabilities,
} from "../../translation/translationEngines";
import {
  checkTranslationReadiness,
} from "../../translation/featureReadiness";
import { getPrefDynamic } from "../../../utils/prefs";
import { getString } from "../../../utils/locale";
import {
  fontLangForTarget,
  isCjkTarget,
  readFontBytesForLang,
} from "../platform";
import { safeDebug } from "../../../utils/logger";
import { createAbortController } from "../../../utils/abort";
import { checkHealth } from "../OpenDataLoaderPdfClient";
import { downloadJRE } from "../JavaRuntimeManager";
import { sha256Hex } from "../../../utils/hash";
import {
  prepareDocumentJob, saveDocumentJob, trackDocumentJob, releaseDocumentJob,
  reusableAttachment, type DocumentJob,
} from "./documentJobs";


export interface OdlSplitOptions {
  sourceItem: any;
  onProgress?: (msg: string) => void;
  /**
   * Structured progress callback: fired whenever the durable job record is
   * updated (done/total/failed). The reader toolbar turns this into
   * 「翻译中 7/18 · 失败 5 段」; the progress window keeps using onProgress.
   */
  onCheckpoint?: (job: DocumentJob) => void;
  /**
   * Split-view opener. Required for outcome "split" (the default); unused for
   * outcome "attachment".
   */
  openSplitView?: (win: any, item: any, att: any) => Promise<string | null>;
  /** Cooperative cancel signal — aborts translation mid-flight. */
  signal?: AbortSignal;
  /**
   * What to do with the translated PDF. "split" (default) opens the
   * side-by-side view; "attachment" only saves it and (when provided) hands it
   * to `openAttachment` — the item-tree menu's "translate to attachment" flow.
   */
  outcome?: "split" | "attachment";
  /** Attachment-mode callback — called after the translated PDF is imported. */
  openAttachment?: (attachmentId: number) => void;
  /**
   * Ignore an existing complete translation and translate again (the toolbar's
   * "重新翻译" choice). The new result replaces the old attachment.
   */
  forceRetranslate?: boolean;
  /** Internal persistent task record; callers normally omit this. */
  job?: DocumentJob;
}

export interface OdlSplitResult {
  translatedAttachmentId: number;
  splitTabID: string | null;
  failedCount?: number;
}

/**
 * User cancellation. Callers must detect it by NAME, not message text: the
 * message is localized (FTL), so a hardcoded-string comparison breaks under
 * l10n. The zh/en message deliberately keeps 已取消/cancelled so
 * backendSelector.isInfraError still classifies it as user cancellation.
 */
export class TranslationCancelledError extends Error {
  constructor() {
    super(getString("odl-progress-cancelled"));
    this.name = "WenxianYiduCancelled";
  }
}

/** User-overridable font directory under the Zotero data directory. */
function translationAssetsDir(): string {
  const dataDir = (Zotero as any).DataDirectory?.dir || "";
  // PathUtils.join, never template concatenation: DataDirectory.dir carries
  // Windows backslashes and a mixed "/..." tail makes IOUtils reject the whole
  // path with NS_ERROR_FILE_UNRECOGNIZED_PATH (found in the README-shot round
  // on a fresh data dir; earlier rounds ran on dirs where the check happened
  // to be skipped).
  return (globalThis as any).PathUtils?.join?.(dataDir, "wenxianyidu", "translation-assets")
    ?? `${dataDir}\wenxianyidu	ranslation-assets`;
}

/** Mix-safe join for paths under the data dir (see translationAssetsDir). */
function joinAssetPath(dataDir: string, name: string): string {
  return (globalThis as any).PathUtils?.join?.(
    dataDir, "wenxianyidu", "translation-assets", name,
  ) ?? `${dataDir}\wenxianyidu	ranslation-assets\${name}`;
}

/**
 * Copy bytes into a bundle-realm typed array. Buffers straight from IOUtils
 * live in the privileged realm — pdf-lib's `instanceof Uint8Array/ArrayBuffer`
 * fails on them and embedFont rejects the font ("was actually of type NaN":
 * pdf-lib's getType reports any non-matching object that coerces to NaN as
 * NaN). Same cross-realm family as the reader Xray issues (§12.5 R1).
 */
function realmLocalCopy(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

/**
 * User font overrides live in `{DataDir}/wenxianyidu/translation-assets/` under
 * script-neutral basenames — the same file serves every target language, and
 * users pick whatever face they prefer (e.g. Noto Serif SC to match a paper's
 * serif typography). Each name accepts .ttf / .otf / .ttc (matching the
 * preferences-pane copy). The legacy per-language NotoSans* names are still
 * honored last so overrides placed before the neutral convention keep working
 * after an upgrade.
 */
const FONT_OVERRIDE_EXTENSIONS = [".ttf", ".otf", ".ttc"] as const;
const FONT_OVERRIDE_BASENAMES = {
  regular: "translated-regular",
  bold: "translated-bold",
  italic: "translated-italic",
  boldItalic: "translated-bold-italic",
} as const;

/** Legacy exact-filename regular override, before the neutral convention. */
function legacyRegularOverride(targetLanguage: string): string | null {
  switch (fontLangForTarget(targetLanguage)) {
    case "zh":
      return "NotoSansSC.ttf";
    case "ja":
      return "NotoSansJP.ttf";
    case "ko":
      return "NotoSansKR.ttf";
    default:
      return null; // non-CJK target — no CJK font needed
  }
}

/** Legacy exact-filename variant override (e.g. "NotoSansSC-Bold.ttf"). */
function legacyVariantOverride(
  variant: "Bold" | "Italic" | "BoldItalic",
  targetLanguage: string,
): string | null {
  const legacy = legacyRegularOverride(targetLanguage);
  return legacy ? `${legacy.replace(/\.ttf$/i, "")}-${variant}.ttf` : null;
}

/** Read the first existing asset among `names`; null when none is present. */
async function readFirstAsset(names: string[]): Promise<Uint8Array | null> {
  const IOUtils = (globalThis as any).IOUtils;
  const dataDir = (Zotero as any).DataDirectory?.dir;
  if (!IOUtils || !dataDir) return null;
  for (const name of names) {
    try {
      const p = joinAssetPath(dataDir, name);
      if (await IOUtils.exists(p)) {
        return realmLocalCopy(await IOUtils.read(p));
      }
    } catch (e) {
      safeDebug("[文献译读] opendataloaderSplitAdapter: " + e);
      /* ignore */
    }
  }
  return null;
}

/** Every filename one override slot may carry, most-preferred first. */
function overrideCandidates(basename: string, legacyName: string | null): string[] {
  const names = FONT_OVERRIDE_EXTENSIONS.map((ext) => `${basename}${ext}`);
  if (legacyName) names.push(legacyName);
  return names;
}

/**
 * Resolve the CJK font for a translation target language: the first existing
 * user-placed asset in `{DataDir}/wenxianyidu/translation-assets/`, then the
 * OS system-default font for that script (via the shared platform module).
 */
async function resolveCjkFont(targetLanguage: string): Promise<Uint8Array | null> {
  const override = await readFirstAsset(
    overrideCandidates(FONT_OVERRIDE_BASENAMES.regular, legacyRegularOverride(targetLanguage)),
  );
  if (override) return override;
  return readFontBytesForLang(fontLangForTarget(targetLanguage));
}

/**
 * Resolve bold/italic CJK variants a user may have placed in the assets dir
 * (neutral basenames, then the legacy per-language names). Each is optional;
 * when absent the renderer degrades to regular for that style. System fonts
 * don't supply these, so only user-placed assets are checked.
 */
async function readCjkVariants(
  targetLanguage: string,
): Promise<{ bold: Uint8Array | null; italic: Uint8Array | null; boldItalic: Uint8Array | null }> {
  const readVariant = (
    basename: string,
    variant: "Bold" | "Italic" | "BoldItalic",
  ): Promise<Uint8Array | null> =>
    readFirstAsset(overrideCandidates(basename, legacyVariantOverride(variant, targetLanguage)));
  const [bold, italic, boldItalic] = await Promise.all([
    readVariant(FONT_OVERRIDE_BASENAMES.bold, "Bold"),
    readVariant(FONT_OVERRIDE_BASENAMES.italic, "Italic"),
    readVariant(FONT_OVERRIDE_BASENAMES.boldItalic, "BoldItalic"),
  ]);
  return { bold, italic, boldItalic };
}

// ─── Translator (engine-backed; formula-preserving prompt included) ──

function makeTranslator(
  targetLanguage: string,
  sourceLanguage?: string,
  signal?: AbortSignal,
): ParagraphTranslator {
  return createTranslator(targetLanguage, sourceLanguage, signal);
}

/**
 * Zotero's UI locale (e.g. "zh-CN"), or "" on hosts without the Zotero global
 * (vitest). Mirrors src/ui/translatePane.ts#defaultTargetLang so the PDF
 * pipeline and the text pane resolve the same default.
 */
function zoteroUILocale(): string {
  try {
    const locale =
      (typeof Zotero === "undefined" ? undefined : (Zotero as any)?.locale) ??
      (globalThis as any)?.Zotero?.locale;
    return typeof locale === "string" ? locale : "";
  } catch {
    return "";
  }
}

/**
 * Preflight the configured translation engine BEFORE any expensive work.
 * Throws a human-readable, actionable error when the engine isn't ready
 * (missing API key / endpoint / plugin) instead of failing mid-parse.
 */
function assertEngineReady(): void {
  const readiness = checkTranslationReadiness();
  if (readiness.ready) return;
  // Localize the gap through the same FTL keys the item pane uses
  // (readiness-reason-*, see src/ui/translatePane.ts#runTranslation) — a bare
  // message id in a user-facing error is a bug, not extra information.
  const gaps = readiness.missing
    .map((m) => `${m.prefKey}（${getString(m.reasonKey)}）`)
    .filter(Boolean)
    .join("；");
  throw new Error(getString("odl-error-engine-not-ready", {
    gaps: gaps || getString("readiness-reason-unknown"),
  }));
}

/**
 * Translate a source PDF via OpenDataLoader + the configured translation engine
 * and open split view.
 *
 * @throws if the translation engine is not configured, the JVM is unavailable,
 *   ODL parse fails, or rendering/split-view fails.
 */
const documentWork = new Map<string, Promise<OdlSplitResult>>();

export async function translateAndSplitWithOpenDataLoader(opts: OdlSplitOptions): Promise<OdlSplitResult> {
  if (!await ensureEngineAvailable()) throw new TranslationCancelledError();
  assertEngineReady();
  const job = await prepareDocumentJob(opts.sourceItem);
  const existing = opts.forceRetranslate ? null : await reusableAttachment(job);
  if (existing) {
    opts.onProgress?.("已复用当前配置下的完整译文。");
    if (opts.outcome === "attachment") {
      opts.openAttachment?.(existing.id);
      return { translatedAttachmentId: existing.id, splitTabID: null, failedCount: 0 };
    }
    const splitTabID = await opts.openSplitView?.((Zotero as any).getMainWindow?.(), opts.sourceItem, existing) ?? null;
    return { translatedAttachmentId: existing.id, splitTabID, failedCount: 0 };
  }
  const running = documentWork.get(job.id);
  if (running) return running;
  const controller = createAbortController();
  const cancel = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  else opts.signal?.addEventListener("abort", cancel, { once: true });
  const work = (async () => {
    job.status = "running";
    job.stage = job.done > 0 ? "正在恢复；复用已完成分段，旧任务兼容缓存" : "准备中";
    try {
      await saveDocumentJob(job);
      trackDocumentJob(job, controller);
      opts.onCheckpoint?.({ ...job });
      const result = await runDocumentPipeline({ ...opts, job, signal: controller.signal });
      job.status = result.failedCount ? "partial" : "complete";
      job.stage = result.failedCount ? "部分段落失败，可重试失败内容" : "已完成";
      job.attachmentID = result.translatedAttachmentId;
      job.failed = result.failedCount ?? 0;
      await saveDocumentJob(job);
      opts.onCheckpoint?.({ ...job });
      return result;
    } catch (error) {
      job.status = controller.signal.aborted ? "cancelled" : "failed";
      job.stage = controller.signal.aborted ? "已取消，可继续翻译" : "处理失败，可继续或重试";
      await saveDocumentJob(job).catch(() => safeDebug("[文献译读] 任务状态尚未保存，请检查磁盘空间。"));
      opts.onCheckpoint?.({ ...job });
      throw controller.signal.aborted ? new TranslationCancelledError() : error;
    } finally {
      releaseDocumentJob(job.id);
      documentWork.delete(job.id);
      opts.signal?.removeEventListener("abort", cancel);
    }
  })();
  documentWork.set(job.id, work);
  return work;
}

async function runDocumentPipeline(
  opts: OdlSplitOptions,
): Promise<OdlSplitResult> {
  const { sourceItem, openSplitView: openSplitViewFn } = opts;
  const onProgress = opts.onProgress || (() => {});
  const checkpoint = async (stage: string, done?: number, total?: number, failed?: number) => {
    if (opts.signal?.aborted) throw new TranslationCancelledError();
    if (!opts.job) return;
    if (engineCacheIdentity() !== opts.job.configIdentity ||
        String(getPrefDynamic("translate.targetLanguage") || "zh-CN") !== opts.job.targetLanguage) {
      throw new Error("翻译设置已改变，本次任务已暂停。请使用当前设置重新开始；已完成的译文仍保留在原配置缓存中。");
    }
    opts.job.stage = stage;
    if (done !== undefined) opts.job.done = done;
    if (total !== undefined) opts.job.total = total;
    if (failed !== undefined) opts.job.failed = failed;
    await saveDocumentJob(opts.job);
    opts.onCheckpoint?.({ ...opts.job });
  };

  // 0. Preflight: the engine must be ready before we spend minutes parsing.
  assertEngineReady();

  // 0-1. Parse the source PDF via OpenDataLoader (the only backend).
  onProgress(getString("odl-progress-parsing"));
  await checkpoint("正在本地解析 PDF");
  const health = await checkHealth();
  if (!health.healthy) {
    await checkpoint("首次准备全文处理组件");
    onProgress("首次全文翻译正在自动安装处理组件，安装完成后会继续。");
    await downloadJRE(17, progress => onProgress(progress.message || "正在准备本地运行库…"));
    if (opts.signal?.aborted) throw new TranslationCancelledError();
  }
  const inputPath = sourceItem.getFilePath?.();
  if (!inputPath) {
    throw new Error(getString("odl-error-source-path"));
  }
  const { analysis } = await parsePdfWithOpenDataLoader(inputPath, {
    imageOutput: "embedded",
    signal: opts.signal,
    onProgress,
  });
  if (!analysis || !analysis.pages || analysis.pages.length === 0) {
    throw new Error(
      analysis?.filteredMarkdown
        ? getString("odl-error-parse-failed", { detail: analysis.filteredMarkdown })
        : getString("odl-error-parse-no-pages"),
    );
  }
  //    already sliced paragraphs with geometry in the right coordinate space).
  // 图片区域完全不翻译：删除器检查模式报告含文字表单对象（矢量图）的
  // 边界框，落在其中的段落（刻度、图例、示意图标注）在装配前整体排除。
  // 图注在页面层、位于表单框之外，照常翻译。检查失败只跳过过滤，
  // 不影响管线其余部分；面积接近整页的表单按页级包装处理，不排除。
  try {
    const regionText = await inspectFormTextRegions(inputPath, opts.signal);
    const excluded = excludeFigureTextBlocks(
      analysis.pages,
      parseFigureRegionLines(regionText),
    );
    if (excluded > 0) {
      safeDebug(
        `[文献译读] opendataloaderSplitAdapter: excluded ${excluded} figure-region text block(s)`,
      );
    }
  } catch (e) {
    safeDebug(
      "[文献译读] opendataloaderSplitAdapter: figure-region inspection skipped: " +
        e,
    );
  }
  const { assemblies, pageSizes, formulaBlocks } = odlAnalysisToAssembly(analysis);
  const totalPages = assemblies.length;
  const totalParagraphs = assemblies.reduce(
    (sum, a) => sum + a.paragraphs.length,
    0,
  );
  if (totalParagraphs === 0) {
    throw new Error(getString("odl-error-parse-no-text"));
  }
  await checkpoint("正在翻译", 0, totalParagraphs, 0);

  //    which the translator would corrupt. When a vision model is configured,
  //    crop each formula-bearing paragraph's bbox and ask the VLM for LaTeX,
  //    then splice the LaTeX back into the paragraph text (protected from
  //    translation by formulaPreservingPrompt). Without vision, degrade: the
  //    formulas stay inline and may translate imperfectly (a known limitation).
  const visionOk = isFormulaVisionAvailable();
  if (formulaBlocks.length > 0) {
    if (visionOk) {
      onProgress(
        getString("odl-progress-formula-vlm", { count: formulaBlocks.length }),
      );
      await extractFormulasForTranslation(sourceItem.id, assemblies, formulaBlocks, onProgress);
    } else {
      onProgress(
        getString("odl-progress-formula-novlm", { count: formulaBlocks.length }),
      );
    }
  }

  //    Resolve the CJK font for the target script (zh/ja/ko) + a Latin font for
  //    English runs, plus optional Bold/Italic variants. Warn loudly if the CJK
  //    font is missing for a CJK target — without it every glyph becomes '?'.
  const targetLanguage =
    opts.job?.targetLanguage ||
    (getPrefDynamic("translate.targetLanguage") as string | undefined) ||
    // "" = follow Zotero's UI locale (addon/prefs.js declares exactly that);
    // the final "zh-CN" only guards hosts with no Zotero global at all.
    zoteroUILocale() ||
    "zh-CN";
  // One title, three consumers: the overlay PDF's metadata, the white-page
  // merged PDF's metadata, and the Zotero attachment title. splitViewCleanup's
  // recognition regex must keep matching this convention — the Translated (<lang>)
  // (<) prefix is load-bearing; the source base name suffix names the paper.
  let translatedTitle = translatedTitleWithSource(
    targetLanguage,
    translatedSourceBaseName(sourceItem),
  );
  const cjkFontBytes = isCjkTarget(targetLanguage)
    ? await resolveCjkFont(targetLanguage)
    : null;
  // Latin font is always resolved — used for the Latin runs in mixed paragraphs
  // (and as the sole font when the target is itself Latin).
  const latinFontBytes = await readFontBytesForLang("latin");
  const fontVariants = await readCjkVariants(targetLanguage);
  if (!cjkFontBytes && isCjkTarget(targetLanguage)) {
    onProgress(
      getString("odl-progress-font-missing", {
        fontFile: `${FONT_OVERRIDE_BASENAMES.regular}.ttf`,
        assetsDir: translationAssetsDir(),
      }),
    );
  }

  // 4b. Capture formula screenshots for visual preservation. Independent of
  //     the VLM LaTeX-extraction step above: even when VLM is unavailable or
  //     fails, we rasterize each formula-bearing region so the renderer can
  //     paste a clean image of the source math at the original bbox (instead
  //     of dropping the {vn} token and leaving dangling text). Requires the
  //     reader to be open — we open it transiently here.
  if (formulaBlocks.length > 0) {
    await captureFormulaScreenshots(
      sourceItem.id,
      assemblies,
      formulaBlocks,
      onProgress,
    );
  }

  //    call per chunk) for engines that support batching — it gives the model
  //    cross-paragraph context and cuts call count ~25-50×. Fall back to
  //    per-page per-paragraph for stateless MT engines (Google/Bing/DeepL).
  let failedTranslations = 0;
  let translatedSets: string[][];
  const failedPositions = new Set<string>();

  const result = await translateDocumentSegments({
    pages: assemblies.map(a => a.texts), previous: opts.forceRetranslate ? undefined : opts.job?.segments,
    target: targetLanguage, signal: opts.signal,
    translate: makeTranslator(targetLanguage, undefined, opts.signal),
    batch: supportsBatching() ? await createAIBatchTranslator(targetLanguage) : undefined,
    concurrency: getEngineCapabilities().concurrency,
    cacheIdentity: opts.job?.configIdentity ?? engineCacheIdentity(),
    progress: (done, total) => opts.onCheckpoint?.({ ...opts.job!, done, total }),
    checkpoint: async (segments, retrying) => {
      if (!opts.job) return;
      opts.job.segments = segments;
      opts.job.done = segments.filter(s => s.status === "success").length;
      opts.job.total = segments.length;
      opts.job.failed = segments.filter(s => s.status === "failed").length;
      opts.job.stage = retrying ? "正在补译失败段落（自动一轮）" : "正在翻译";
      await saveDocumentJob(opts.job);
      opts.onCheckpoint?.({ ...opts.job });
      if (!opts.signal?.aborted && engineCacheIdentity() !== opts.job.configIdentity) throw new Error("翻译设置已改变，请重新开始；原配置的分段结果已保存。");
    },
  });
  translatedSets = result.translatedSets;
  failedTranslations = result.failedCount;
  for (const position of result.failedPositions) failedPositions.add(position);

  if (failedTranslations) {
    translatedTitle += ` · 部分译文（${failedTranslations} 段失败）`;
    onProgress(`有 ${failedTranslations} 段未翻译，原文位置已标注。再次翻译会重试失败段落。`);
    for (let page = 0; page < translatedSets.length; page++) {
      translatedSets[page] = translatedSets[page].map((text, index) =>
        failedPositions.has(`${page}:${index}`)
          ? `[未翻译 / Translation unavailable] ${text}` : text);
    }
  }
  await checkpoint("正在排版并保留图表", totalParagraphs - failedTranslations, totalParagraphs, failedTranslations);

  // Abort check: if the user cancelled during translation, stop before
  // rendering — no point compositing a half-translated PDF.
  if (opts.signal?.aborted) {
    throw new TranslationCancelledError();
  }

  //    every page) — this preserves ALL original vector content (figures, charts,
  //    table lines) at full fidelity. Fall back to white-page mode if the source
  //    bytes can't be read.
  let merged: Uint8Array;
  const IOUtils = (globalThis as any).IOUtils;
  let sourcePdfBytes: Uint8Array | null = null;
  try {
    if (IOUtils && inputPath) {
      const raw = await IOUtils.read(inputPath);
      // IOUtils.read returns Uint8Array; ensure we have a real typed array (not
      // a view with byteOffset that confuses pdf-lib). Copy into a clean buffer.
      sourcePdfBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      if (opts.job && await sha256Hex(sourcePdfBytes) !== opts.job.sourceHash) {
        throw new Error("源 PDF 在翻译期间发生变化，请重新开始翻译。");
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("源 PDF 在翻译期间")) throw e;
    safeDebug("[文献译读] opendataloaderSplitAdapter: " + e);
    /* fall back to white-page mode */
  }

  if (sourcePdfBytes) {
    // 原文删除前置步骤：把已翻译段落的原文从页面内容流中真正删除，
    // 之后叠加译文时不再画遮罩（搜索/复制不再命中原文）。任何失败
    // （jar/Java 缺失、超时、输出损坏）都回退到原有遮罩路径，零回归。
    let cleanedBytes: Uint8Array | null = null;
    if (isOriginalTextRemovalEnabled() && inputPath) {
      try {
        onProgress(getString("odl-progress-remove-original"));
        const rectsContent = serializeRemovalRects(
          buildRemovalRects(assemblies, translatedSets),
        );
        cleanedBytes = await removeOriginalText(inputPath, rectsContent, opts.signal);
      } catch (e) {
        safeDebug(
          "[文献译读] opendataloaderSplitAdapter: original-text removal failed, falling back to masks: " +
            e,
        );
        cleanedBytes = null;
      }
    }

    onProgress(getString("odl-progress-overlay"));
    const renderOptions = {
      targetLanguage,
      ...(cjkFontBytes ? { cjkFontBytes } : {}),
      ...(latinFontBytes ? { latinFontBytes } : {}),
      ...(fontVariants.bold ? { boldFontBytes: fontVariants.bold } : {}),
      ...(fontVariants.italic
        ? { italicFontBytes: fontVariants.italic }
        : {}),
      ...(fontVariants.boldItalic
        ? { boldItalicFontBytes: fontVariants.boldItalic }
        : {}),
      docTitle: translatedTitle,
      ...(cleanedBytes ? { maskOriginalText: false } : {}),
    };
    const renderSource = cleanedBytes ?? sourcePdfBytes;
    try {
      const result = await renderOverlayTranslated(
        renderSource,
        assemblies,
        translatedSets,
        renderOptions,
      );
      merged = result.bytes;
    } catch (e) {
      // 删除后的 PDF 渲染失败（理论上不应发生）：用原始字节 + 遮罩兜底
      if (!cleanedBytes) throw e;
      safeDebug(
        "[文献译读] opendataloaderSplitAdapter: rendering cleaned PDF failed, falling back to masks: " +
          e,
      );
      const result = await renderOverlayTranslated(
        sourcePdfBytes,
        assemblies,
        translatedSets,
        { ...renderOptions, maskOriginalText: true },
      );
      merged = result.bytes;
    }
  } else {
    onProgress(getString("odl-progress-render-white"));
    const pageBytes: Uint8Array[] = [];
    for (let i = 0; i < totalPages; i++) {
      const render = await renderLayoutPreserving(
        assemblies[i],
        translatedSets[i],
        {
          targetLanguage,
          pageWidth: pageSizes[i].width,
          pageHeight: pageSizes[i].height,
          ...(cjkFontBytes ? { cjkFontBytes } : {}),
          ...(latinFontBytes ? { latinFontBytes } : {}),
          ...(fontVariants.bold ? { boldFontBytes: fontVariants.bold } : {}),
          ...(fontVariants.italic
            ? { italicFontBytes: fontVariants.italic }
            : {}),
          ...(fontVariants.boldItalic
            ? { boldItalicFontBytes: fontVariants.boldItalic }
            : {}),
        },
      );
      pageBytes.push(render.bytes);
    }
    if (pageBytes.length === 0) throw new Error(getString("odl-error-render-empty"));
    merged = await mergePageBytes(pageBytes, translatedTitle);
  }
  const parentItemID = sourceItem.parentItemID;
  await checkpoint("正在保存译文附件");
  const translatedAtt = await importTranslatedBytes(
    merged,
    parentItemID,
    translatedTitle,
    sourceItem,
  );
  // Replace, don't accumulate: a re-translation (including retrying a partial
  // one) used to leave the previous attachment behind, so repeated runs piled
  // up identical "Translated (zh-CN) · …" rows. Old ones go to the trash
  // (recoverable) and only after the new file is safely imported.
  try {
    const removed = await trashSupersededTranslations(
      sourceItem,
      parentItemID,
      translatedAtt.id,
    );
    if (removed > 0) {
      safeDebug(`[文献译读] replaced ${removed} earlier translation(s)`);
    }
  } catch (e) {
    safeDebug("[文献译读] superseded translation cleanup failed: " + e);
  }

  // Attachment outcome: the item-tree "translate to attachment" flow stops
  // here — no split view, optional auto-open of the result.
  if (opts.outcome === "attachment") {
    onProgress(
      summarizePages(totalPages, totalParagraphs, failedTranslations),
    );
    try {
      opts.openAttachment?.(translatedAtt.id);
    } catch (e) {
      safeDebug("[文献译读 split] open translated attachment failed: " + e);
    }
    return {
      translatedAttachmentId: translatedAtt.id,
      splitTabID: null,
      failedCount: failedTranslations,
    };
  }

  onProgress(getString("odl-progress-opening-split"));
  if (!openSplitViewFn) {
    throw new Error(getString("odl-error-no-split-opener"));
  }
  const win = (Zotero as any).getMainWindow?.() || null;
  let splitTabID: string | null = null;
  try {
    splitTabID = await openSplitViewFn!(win, sourceItem, translatedAtt);
    onProgress(
      summarizePages(totalPages, totalParagraphs, failedTranslations),
    );
  } catch (e) {
    // 译文已生成并入库——失败仅发生在分屏容器打开（openSplitView 超时抛错，
    // 不再返回 null）。不能让用户以为翻译白做：结果里 translatedAttachmentId
    // 依然有效，进度条文案明确说明译文已保存。
    safeDebug(`[文献译读 split] open split view failed after translation: ${e}`);
    onProgress(
      getString("odl-progress-summary-nosplit", {
        pages: totalPages,
        paragraphs: totalParagraphs,
      }) + failedSuffix(failedTranslations),
    );
  }

  return {
    translatedAttachmentId: translatedAtt.id,
    splitTabID,
    failedCount: failedTranslations,
  };
}

/** "Done: N pages, M paragraphs" (+ failed-paragraph suffix when any). */
function summarizePages(
  totalPages: number,
  totalParagraphs: number,
  failedTranslations: number,
): string {
  const base = getString("odl-progress-summary", {
    pages: totalPages,
    paragraphs: totalParagraphs,
  });
  return base + failedSuffix(failedTranslations);
}

/** Localized ", N paragraphs failed" suffix; empty when nothing failed. */
function failedSuffix(failedTranslations: number): string {
  return failedTranslations > 0
    ? getString("odl-progress-summary-failed", { failed: failedTranslations })
    : "";
}


/**
 * Wait for a freshly-opened reader's pdf.js to be ready (PDFViewerApplication +
 * pdfDocument available).
 */
async function waitForReaderPdf(reader: any): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    // Outer reader wraps the real reader under _internalReader; direct/internal
    // readers expose _primaryView at the top level.
    const primaryView =
      reader?._internalReader?._primaryView ?? reader?._primaryView;
    if (primaryView) return;
    await (Zotero as any).Promise.delay(100);
  }
  throw new Error(getString("odl-error-reader-pdf-timeout"));
}

/**
 * Open the source PDF in a reader for the duration of cropping (the rasterizer
 * needs a live pdf.js instance). Returns { reader, openedNew } or null when the
 * reader can't be opened at all.
 */
async function openReaderForCropping(
  attachmentId: number,
): Promise<{ reader: any; openedNew: boolean } | null> {
  let reader: any;
  let openedNew = false;
  try {
    const acquired = await acquireCroppingReader((Zotero as any).Reader, attachmentId);
    reader = acquired?.reader;
    openedNew = acquired?.openedNew ?? false;
    if (!reader) return null;
    await waitForReaderPdf(reader);
    return { reader, openedNew };
  } catch (_e) {
    // Only close the reader if we opened a new one.
    if (openedNew) {
      try { reader?.close?.(); } catch (e) { safeDebug("[文献译读] opendataloaderSplitAdapter: " + e);  /* best-effort */ }
    }
    return null;
  }
}

/**
 * For each formula-bearing paragraph: crop its bbox from the open reader, ask
 * the vision model for LaTeX, and splice the LaTeX back into the paragraph's
 * text so it survives translation verbatim (formulaPreservingPrompt protects
 * $...$). Failures are soft: a single bad crop/VLM response keeps the original
 * text rather than aborting the whole document.
 *
 * Opens the source PDF in a reader for the duration of cropping (the rasterizer
 * needs a live pdf.js instance), then closes it.
 */
async function extractFormulasForTranslation(
  attachmentId: number,
  assemblies: import("./translationIR").AssemblyResult[],
  formulaBlocks: FormulaBlock[],
  onProgress: (msg: string) => void,
): Promise<void> {
  const opened = await openReaderForCropping(attachmentId);
  if (!opened) {
    onProgress(getString("odl-progress-crop-reader-missing-skip"));
    return;
  }
  const { reader, openedNew } = opened;

  let processed = 0;
  let failed = 0;
  let imageFallback = 0;
  try {
    for (const fb of formulaBlocks) {
      const assembly = assemblies[fb.pageNumber - 1];
      if (!assembly) continue;
      // Capture the crop OUTSIDE the try so it's available to the catch branch
      // for image fallback if VLM extraction fails.
      let dataUrl: string | null = null;
      try {
        dataUrl = await rasterizeRegionToDataURL({
          attachmentId,
          pageNum: fb.pageNumber,
          bbox: fb.bbox,
        });
        const latex = await extractFormulaLatex(dataUrl);
        if (latex && latex.toUpperCase() !== "NONE") {
          // Splice the LaTeX in, replacing the formula-laden original so the
          // translator doesn't corrupt the math symbols. $...$ is preserved.
          assembly.texts[fb.paragraphIndex] = latex;
        }
        // "NONE" = model saw no formula — keep original text, no fallback.
        processed++;
      } catch (e) {
        safeDebug("[文献译读] opendataloaderSplitAdapter: " + e);
        // VLM extraction failed. If we have a crop, paste it back as an image
        // at the formula's bbox (better than corrupted symbols getting
        // translated). Store in placedFormulas (NOT assembly.images) so BOTH
        // overlay and white-page render modes composite it — overlay mode does
        // not render `assembly.images` (it skips them to avoid double-drawing
        // the source's own images), which previously caused the formula region
        // to appear as a blank white hole in the default overlay path.
        if (dataUrl) {
          const placed = {
            bbox: { x: fb.bbox.x, y: fb.bbox.y, width: fb.bbox.width, height: fb.bbox.height },
            dataUri: dataUrl,
          };
          if (!assembly.placedFormulas) assembly.placedFormulas = [];
          assembly.placedFormulas.push(placed);
          // Clear the text so the corrupted symbols aren't also drawn under the
          // image (the renderer skips empty translated text).
          assembly.texts[fb.paragraphIndex] = "";
          imageFallback++;
        }
        failed++;
      }
      // Every 10 items (not 5): each report appends a ProgressWindow row, and
      // formula-heavy documents would otherwise stack the window too tall.
      if (processed > 0 && processed % 10 === 0) {
        onProgress(getString("odl-progress-crop-progress", {
          current: processed,
          total: formulaBlocks.length,
        }));
      }
    }
  } finally {
    // Only close the reader if we opened it. Existing readers are the user's own
    // tabs and must not be closed.
    if (openedNew) {
      try {
        reader?.close?.();
      } catch (e) {
        safeDebug("[文献译读] opendataloaderSplitAdapter: " + e);
        /* best-effort */
      }
    }
  }
  onProgress(
    getString("odl-progress-crop-done", { ok: processed }) +
      (imageFallback > 0
        ? getString("odl-progress-crop-fallback", { count: imageFallback })
        : "") +
      (failed - imageFallback > 0
        ? getString("odl-progress-crop-failed", { count: failed - imageFallback })
        : ""),
  );
}

/**
 * Rasterize each formula-bearing paragraph's bbox and store the screenshot in
 * `assembly.placedFormulas`. This is the visual-preservation path: the renderer
 * pastes these images back at the original coordinates so formulas survive
 * translation as clean images instead of being dropped or rendered as raw LaTeX.
 *
 * Independent of `extractFormulasForTranslation` (VLM LaTeX): we capture
 * screenshots regardless of whether a vision model is configured, so formulas
 * are always preserved visually. When VLM is also available, both run — the
 * LaTeX splice gives selectable text and the screenshot is a fallback.
 *
 * Opens the source PDF in a reader transiently (the rasterizer needs a live
 * pdf.js instance), then closes it. Failures are soft: a single bad crop is
 * skipped without aborting the whole document.
 */
async function captureFormulaScreenshots(
  attachmentId: number,
  assemblies: import("./translationIR").AssemblyResult[],
  formulaBlocks: FormulaBlock[],
  onProgress: (msg: string) => void,
): Promise<void> {
  const opened = await openReaderForCropping(attachmentId);
  if (!opened) {
    onProgress(getString("odl-progress-crop-reader-missing-text"));
    return;
  }
  const { reader, openedNew } = opened;

  let captured = 0;
  let failed = 0;
  try {
    for (const fb of formulaBlocks) {
      const assembly = assemblies[fb.pageNumber - 1];
      if (!assembly) continue;
      try {
        const dataUrl = await rasterizeRegionToDataURL({
          attachmentId,
          pageNum: fb.pageNumber,
          bbox: fb.bbox,
        });
        if (dataUrl) {
          if (!assembly.placedFormulas) assembly.placedFormulas = [];
          assembly.placedFormulas.push({
            bbox: {
              x: fb.bbox.x,
              y: fb.bbox.y,
              width: fb.bbox.width,
              height: fb.bbox.height,
            },
            dataUri: dataUrl,
          });
          captured++;
        } else {
          failed++;
        }
      } catch (e) {
        safeDebug("[文献译读] opendataloaderSplitAdapter: " + e);
        failed++;
      }
      // Every 10 items — see the matching note in extractFormulasForTranslation.
      if (captured > 0 && captured % 10 === 0) {
        onProgress(getString("odl-progress-shot-progress", {
          current: captured,
          total: formulaBlocks.length,
        }));
      }
    }
  } finally {
    // Only close the reader if we opened it. Existing readers are the user's own
    // tabs and must not be closed.
    if (openedNew) {
      try {
        reader?.close?.();
      } catch (e) {
        safeDebug("[文献译读] opendataloaderSplitAdapter: " + e);
        /* best-effort */
      }
    }
  }
  onProgress(
    getString("odl-progress-shot-done", { ok: captured }) +
      (failed > 0 ? getString("odl-progress-shot-failed", { count: failed }) : ""),
  );
}

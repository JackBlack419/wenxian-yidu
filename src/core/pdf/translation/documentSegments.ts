import type { DocumentSegment } from "./documentJobs";
import type { BatchTranslatorHandle, ParagraphTranslator } from "../../translation/types";
import { translateAllPagesBatched } from "./translateParagraphs";
import { assertNotCancelled } from "../../translation/providerAdapters";
import { retryAfterOfError } from "../../../utils/rateLimit";
import { cacheAvailable, cacheKey, getCachedTranslations, putCachedTranslation } from "../../translation/translationCache";

export interface DocumentSegmentsOptions {
  pages: string[][]; previous?: DocumentSegment[]; target: string; signal?: AbortSignal;
  translate: ParagraphTranslator; batch?: BatchTranslatorHandle; concurrency: number; cacheIdentity?: string;
  checkpoint(segments: DocumentSegment[], retrying: boolean): Promise<void>;
  progress?(done: number, total: number): void;
}
export function isCredentialFailure(error: any): boolean {
  return [401, 403].includes(error?.status) || /credential|unauthori[sz]ed|forbidden|凭据|密钥|认证|HTTP\s*(?:401|403)\b/i.test(String(error?.message ?? error));
}
/** The durable manifest is independent of the optional general-purpose cache. */
export async function translateDocumentSegments(opts: DocumentSegmentsOptions) {
  const previous = new Map(opts.previous?.map(s => [s.position, s]));
  const segments: DocumentSegment[] = opts.pages.flatMap((page, p) => page.map((source, j) => {
    const position = `${p}:${j}`, old = previous.get(position);
    return old?.source === source && old.status === "success" && (old.translated.trim() || !source.trim())
      ? { ...old } : { position, source, translated: source, retryAt: old?.source === source ? old.retryAt : undefined, status: !source.trim() || /^\{v\d+\}$/.test(source.trim()) ? "success" as const : "pending" as const };
  }));
  let fatal: unknown;
  for (let round = 0; round < 2; round++) {
    assertNotCancelled(opts.signal);
    const pending = segments.filter(s => s.status !== "success" && (!s.retryAt || s.retryAt - Date.now() <= 120000));
    if (!pending.length) break;
    for (let start = 0; start < pending.length; start += 16) {
      assertNotCancelled(opts.signal);
      const group = pending.slice(start, start + 16);
      if (opts.batch) {
        const result = await translateAllPagesBatched([group.map(s => s.source)], opts.batch.translate, {
          targetLanguage: opts.target, signal: opts.signal, cacheIdentity: opts.cacheIdentity,
          inputBudgetChars: opts.batch.inputBudgetChars, outputBudgetChars: opts.batch.outputBudgetChars, concurrency: opts.concurrency,
        });
        if (opts.signal?.aborted) { await opts.checkpoint(segments.map(s => ({ ...s })), round === 1); assertNotCancelled(opts.signal); }
        const failed = new Set(result.failedPositions);
        group.forEach((s, j) => { s.translated = result.translatedSets[0][j]; s.status = failed.has(`0:${j}`) || !s.translated.trim() ? "failed" : "success"; });
      } else {
        let cursor = 0;
        const worker = async () => {
          while (cursor < group.length && !fatal && !opts.signal?.aborted) {
            const s = group[cursor++];
            try {
              const wait = Math.max(0, (s.retryAt ?? 0) - Date.now());
              if (wait) await new Promise<void>((resolve, reject) => {
                const stop = () => { clearTimeout(timer); reject(Object.assign(new Error("Cancelled"), { name: "AbortError" })); };
                const timer = setTimeout(() => { opts.signal?.removeEventListener("abort", stop); resolve(); }, wait);
                opts.signal?.addEventListener("abort", stop, { once: true });
              });
              assertNotCancelled(opts.signal);
              const key = opts.cacheIdentity && cacheAvailable() ? await cacheKey(opts.cacheIdentity, "auto", opts.target, s.source) : null;
              const hit = key ? (await getCachedTranslations([key])).get(key) : undefined;
              const text = hit ?? await opts.translate(s.source, opts.target);
              assertNotCancelled(opts.signal);
              if (!text?.trim()) throw new Error("Translation returned no text");
              s.translated = text; s.status = "success"; delete s.retryAt;
              if (opts.cacheIdentity && hit === undefined) await putCachedTranslation(opts.cacheIdentity, "auto", opts.target, s.source, text).catch(() => {});
            } catch (error) {
              if (!opts.signal?.aborted) s.status = "failed";
              const retryAfter = retryAfterOfError(error);
              if (retryAfter !== null) s.retryAt = Date.now() + retryAfter * 1000;
              if (isCredentialFailure(error)) fatal = error;
            }
            opts.progress?.(segments.filter(s => s.status === "success").length, segments.length);
          }
        };
        await Promise.all(Array.from({ length: Math.min(Math.max(1, opts.concurrency), group.length) }, worker));
      }
      // Flush each bounded batch, including successful siblings on cancellation.
      await opts.checkpoint(segments.map(s => ({ ...s })), round === 1);
      assertNotCancelled(opts.signal);
      if (fatal) throw fatal;
    }
  }
  const byPosition = new Map(segments.map(s => [s.position, s]));
  const failedPositions = segments.filter(s => s.status !== "success").map(s => s.position);
  return { segments, failedPositions, failedCount: failedPositions.length,
    translatedSets: opts.pages.map((page, p) => page.map((source, j) => byPosition.get(`${p}:${j}`)?.translated ?? source)) };
}

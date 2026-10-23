/**
 * translationEngines — Unified translation engine dispatcher.
 *
 * Supports free trials, official MT APIs and user-configured AI engines:
 *   - "ai"      → OpenAI-compatible chat-completions endpoint driven by a
 *                 user-owned, validated prompt template (translate.ai.*) via
 *                 src/core/translation/promptTemplate.ts. This is the port of
 *                 leadero's "ai" engine: unlike "custom" below it substitutes
 *                 the source/target language into the prompt and refuses to
 *                 translate while the template is invalid.
 *   - "youdao"  → default keyless trial; "youdao-official" / "niutrans" use
 *                 user-owned official credentials
 *   - "google"  → Google Translate free endpoint or Cloud Translation
 *   - "custom"  → OpenAI-compatible chat-completions endpoint with a fixed
 *                 formula-preserving prompt (translate.custom.apiUrl/apiKey/
 *                 model) via src/core/ai/openaiCompat.ts. Also the only engine
 *                 with batch JSON ability — see supportsBatching().
 *   - "bing"    → Azure Cognitive Services Translator
 *   - "bing-web" → keyless Bing web translator. Selectable since 2026-09-30:
 *                 it is the only keyless engine reachable in mainland China,
 *                 so it has to be a user choice, not just a hardcoded fallback
 *                 (ported from z-search's 2026-09-28 change).
 *   - "deepl"   → DeepL API
 *   - "zotero-pdf-translate" → external plugin bridge
 *
 * All engines return the same signature:
 *   { success: true, translatedText: string } or { success: false, error: string }
 *
 * Formula placeholders and dollar-delimited math are protected locally for
 * classic MT. Model-backed outputs are checked before they enter the cache.
 *
 * Ported from leadero's src/core/translation/translationEngines.ts: leadero's
 * ModelRouter/AIProviderRegistry coupling is replaced by the local
 * OpenAI-compatible client (twice over — once per model-backed engine), and
 * every leadero-specific dependency (utils/defaults, react locale wrapper) is
 * swapped for z-transplit's own src/utils/* helpers.
 */

import { z } from "zod";
import type {
  BatchTranslateResult,
  BatchTranslator,
  BatchTranslatorHandle,
  ParagraphTranslator,
} from "./types";
import { createOpenAICompatClient, normalizeChatCompletionsUrl } from "../ai/openaiCompat";
import { resolveModelBudgets } from "../ai/modelCatalog";
import { getPrefDynamic } from "../../utils/prefs";
import { redactTranslationError } from "../../utils/credentials";
import { cacheAvailable, cacheKey, getCachedTranslations, putCachedTranslation } from "./translationCache";
import { translateYoudao, translateYoudaoOfficial, translateNiuTrans, combineSignal, assertNotCancelled, userFacingError } from "./providerAdapters";
import { sharedRequest, providerSlot, splitLongText } from "./requestCoordinator";
import { protectedTextUnchanged, maskProtectedSentence, translateProtectedSentence } from "./protectedText";
import { parseJsonFromMarkdown } from "../../utils/json";
import { toErrorMessage } from "../../utils/error";
import { getString } from "../../utils/locale";
import { abortSignalTimeout } from "../../utils/abort";
import { getLanguageName } from "../tool/language";
import {
  batchJsonPrompt,
  batchJsonPromptFromTemplate,
  formulaPreservingPrompt,
  sanitizeTranslations,
} from "./prompts";
import {
  promptFingerprint,
  renderPrompt,
  resolvePromptTemplate,
  validatePromptTemplate,
} from "./promptTemplate";
import {
  isRateLimitError,
  rateLimitDelayMs,
  retryAfterFromHeaders,
  retryAfterOfError,
} from "../../utils/rateLimit";

export type TranslationEngineType =
  | "mtranserver"
  | "youdao"
  | "youdao-official"
  | "niutrans"
  | "ai"
  | "google"
  | "bing"
  | "bing-web"
  | "deepl"
  | "custom"
  | "zotero-pdf-translate";

/**
 * Default engine. Must stay in lockstep with the `translate.engineType` default
 * declared in addon/prefs.js (z-transplit has no src/utils/defaults.ts — prefs.js
 * is the single source of truth for pref defaults).
 */
const DEFAULT_TRANSLATE_ENGINE_TYPE: TranslationEngineType = "bing-web";

export interface GoogleTranslateOptions {
  signal?: AbortSignal;
  apiKey?: string;
}

export interface BingTranslateOptions {
  signal?: AbortSignal;
  apiKey: string;
  region: string;
}

export interface DeepLTranslateOptions {
  signal?: AbortSignal;
  apiKey: string;
  useFreeEndpoint?: boolean;
}

export interface CustomTranslateOptions {
  signal?: AbortSignal;
  apiUrl: string;
  apiKey?: string;
  model?: string;
}

export interface AITranslateOptions {
  signal?: AbortSignal;
  apiUrl: string;
  /** Optional: local gateways (Ollama, LM Studio) usually need no key. */
  apiKey?: string;
  model?: string;
  /** Raw prompt template from prefs; "" = built-in default template. */
  prompt?: string;
}

/**
 * Map Zotero locale codes to ISO-639-1 codes used by translation APIs.
 */
function toApiSourceLang(code?: string): string {
  if (!code) return "auto";
  // Zotero uses zh-CN / zh-TW / en-US etc. Strip region for most APIs.
  const base = code.split("-")[0];
  if (base === "zh") return code; // keep zh-CN vs zh-TW distinction
  return base;
}

function toApiTargetLang(code: string): string {
  const base = code.split("-")[0];
  if (code.startsWith("zh")) return code; // keep zh-CN / zh-TW
  if (code.startsWith("pt")) return code; // pt-BR / pt-PT
  return base;
}

/**
 * DeepL-specific target language mapping.
 * DeepL expects uppercase without region for zh-CN (ZH), but keeps zh-TW.
 */
function toDeepLTargetLang(code: string): string {
  if (code === "zh-CN") return "ZH";
  if (code === "zh-TW") return "ZH-TW";
  return toApiTargetLang(code).toUpperCase();
}

/**
 * Timeout used for the keyless HTTP endpoints (Google free endpoint, Bing web).
 * A blocked/unreachable endpoint (e.g. Google in mainland China) must fail fast
 * so the fallback chain can take over instead of hanging on the OS network
 * timeout (~60-120s per paragraph).
 */
const KEYLESS_ENDPOINT_TIMEOUT_MS = 10000;

/**
 * Per-request timeout for the model-backed engines ("ai"). Generous compared to
 * the MT endpoints above because a chat completion of a long paragraph takes
 * far longer than a translate call, and the failure mode without it is a
 * request hanging on the OS network timeout (~60-120s) per paragraph.
 * leadero's MT helper omitted the timeout entirely (a latent bug); the port
 * passes one.
 */
const AI_ENDPOINT_TIMEOUT_MS = 120000;

/**
 * Floor for the model-backed engines' output budget. Reasoning-style models
 * spend completion tokens on hidden thinking before any visible text, so a
 * purely length-derived cap empties the budget mid-reasoning and returns no
 * content at all (observed on StepFun step-3.7-flash: a 37-char selection with
 * the length-derived cap came back finish_reason=length, content=""; 2048
 * returned the translation). 4096 leaves comfortable headroom for reasoning
 * plus the answer even on longer selections.
 */
const MODEL_OUTPUT_FLOOR_TOKENS = 4096;

/**
 * Cap for the single-paragraph request budget (before the floor applies). The
 * floor dominates for anything under ~4k chars; this only bounds very long
 * single passages so a pathological paste can't request an unbounded budget.
 */
const SINGLE_OUTPUT_MAX_TOKENS = 8192;

/**
 * Default merged-batch INPUT cap (translate.batchMaxTokens) in estimated
 * tokens — the pane's default and the fallback when the pref holds a
 * non-positive/garbage value.
 */
const DEFAULT_BATCH_MAX_TOKENS = 8192;

/**
 * How many times a non-compliant batch result (HTTP error, empty content,
 * JSON parse/schema failure, count mismatch) is retried before the chunk
 * degrades to per-paragraph — 1 initial attempt + 3 retries.
 */
const MAX_BATCH_RETRIES = 3;

/**
 * 非 2xx 响应 → 统一抛错。错误上附着 `status` 与 `retryAfterSec`（读自
 * Retry-After 响应头），供限流退避（utils/rateLimit.ts）识别与计迟。
 */
function httpStatusError(resp: Response, text: string): Error {
  const e = new Error(`HTTP ${resp.status}: ${redactTranslationError(text || resp.statusText)}`) as Error & {
    status?: number;
    retryAfterSec?: number | null;
  };
  e.status = resp.status;
  e.retryAfterSec = retryAfterFromHeaders(resp.headers);
  return e;
}

async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<Response> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
    signal: combineSignal(signal, timeoutMs || 30000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw httpStatusError(resp, text);
  }
  return resp;
}

async function httpPostForm(
  url: string,
  headers: Record<string, string>,
  body: URLSearchParams,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<Response> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: body.toString(),
    signal: combineSignal(signal, timeoutMs || 30000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw httpStatusError(resp, text);
  }
  return resp;
}

async function httpGet(url: string, timeoutMs?: number, signal?: AbortSignal): Promise<Response> {
  const resp = await fetch(url, {
    signal: combineSignal(signal, timeoutMs || 30000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw httpStatusError(resp, text);
  }
  return resp;
}

/**
 * 限流回落：除首次请求外再试 1 次（等待量级 5s，若服务器给了 Retry-After
 * 则按它）。免注册试用的配额是分钟级的，等更久只会让一次段落翻译卡满几十秒；
 * 调用方仍会拿到明确的限流文案，而不是「翻译失败」。
 */
const RATE_LIMIT_RETRIES = 1;

/**
 * 限流退避包装（429 / 有道 411；自 leadero 的 requestWithRateLimit 思想移植）。
 *
 * 每次等待优先按 Retry-After 头（超过 120 秒视为「等太久」，直接终态），
 * 无头时按 5 秒 × 2^(n-1) 指数退避；重试耗尽后以限流专门文案终态，不再
 * 冒充普通失败。非限流异常原样上抛，调用方的既有语义不变。
 */
async function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  assertNotCancelled(signal);
  const host = (globalThis as any).Zotero?.getMainWindow?.() ?? globalThis;
  await new Promise<void>((resolve, reject) => {
    let timer: any;
    const finish = () => { signal?.removeEventListener("abort", stop); resolve(); };
    const stop = () => {
      host.clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      reject(Object.assign(new Error("翻译已取消"), { name: "AbortError" }));
    };
    timer = host.setTimeout(finish, ms);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
  });
}

async function withRateLimitRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  assertNotCancelled(signal);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted || !isRateLimitError(e)) throw e;
      if (attempt >= RATE_LIMIT_RETRIES) {
        throw new Error(getString("translation-error-rate-limited"), { cause: e });
      }
      const delayMs = rateLimitDelayMs(retryAfterOfError(e), attempt + 1);
      if (delayMs == null) {
        throw new Error(getString("translation-error-rate-limited"), { cause: e });
      }
      await waitForRetry(delayMs, signal);
    }
  }
}

/**
 * Google Translate.
 *
 * If apiKey is provided, uses Cloud Translation API v2:
 *   POST https://translation.googleapis.com/language/translate/v2
 *
 * Otherwise falls back to the undocumented free endpoint:
 *   GET https://translate.googleapis.com/translate_a/single?client=gtx&...
 *
 * The free endpoint has rate limits (~5k chars/day) and may break without notice,
 * but requires zero configuration and is useful as a quick fallback.
 */
async function translateWithGoogle(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
  opts: GoogleTranslateOptions = {},
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  const src = toApiSourceLang(sourceLanguage);
  const tgt = toApiTargetLang(targetLanguage);

  try {
    if (opts.apiKey) {
      // Cloud Translation API v2 (paid, requires API key)
      const body = JSON.stringify({
        q: text,
        source: src === "auto" ? undefined : src,
        target: tgt,
        format: "text",
      });
      const resp = await httpPost(
        `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(opts.apiKey)}`,
        {},
        body,
        KEYLESS_ENDPOINT_TIMEOUT_MS,
        opts.signal,
      );
      const data = (await resp.json()) as any;
      const translated = data?.data?.translations?.[0]?.translatedText;
      if (!translated)
        throw new Error(getString("translation-error-google-empty"));
      return { success: true, translatedText: translated };
    } else {
      // Free undocumented endpoint (no key required)
      const url =
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=` +
        encodeURIComponent(src) +
        `&tl=` +
        encodeURIComponent(tgt) +
        `&dt=t&q=` +
        encodeURIComponent(text);
      const resp = await httpGet(url, KEYLESS_ENDPOINT_TIMEOUT_MS, opts.signal);
      const data = (await resp.json()) as any;
      // Response shape: [[["translated","original",...]],null,"srcLang"]
      const sentences = data?.[0] ?? [];
      const translated = sentences.map((s: any) => s?.[0] ?? "").join("");
      if (!translated)
        throw new Error(getString("translation-error-google-empty"));
      return { success: true, translatedText: translated };
    }
  } catch (e: any) {
    return { success: false, error: redactTranslationError(e) };
  }
}

/**
 * Bing / Azure Cognitive Services Translator.
 *
 * Requires apiKey (Azure subscription key) and region (e.g. "global", "eastasia").
 * Docs: https://learn.microsoft.com/en-us/azure/cognitive-services/translator/
 */
async function translateWithBing(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
  opts: BingTranslateOptions = { apiKey: "", region: "global" },
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  const src = toApiSourceLang(sourceLanguage);
  const tgt = toApiTargetLang(targetLanguage);

  try {
    const body = JSON.stringify([{ Text: text }]);
    const url =
      `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=` +
      encodeURIComponent(src === "auto" ? "" : src) +
      `&to=` +
      encodeURIComponent(tgt);
    const resp = await httpPost(
      url,
      {
        "Ocp-Apim-Subscription-Key": opts.apiKey,
        "Ocp-Apim-Subscription-Region": opts.region,
      },
      body,
      30000,
      opts.signal,
    );
    const data = (await resp.json()) as any;
    const translated = data?.[0]?.translations?.[0]?.text;
    if (!translated) throw new Error(getString("translation-error-bing-empty"));
    return { success: true, translatedText: translated };
  } catch (e: any) {
    return { success: false, error: redactTranslationError(e) };
  }
}

/**
 * Keyless Bing web translator (the Bing Translator web app endpoint, same
 * engine behind bing.com/translator). Reachable in regions where Google is not
 * (e.g. mainland China), which is why it backs the default Google engine —
 * and, since 2026-09-30, why it is also selectable as its own engine
 * ("bing-web"): a user who knows Google is blocked should be able to pick the
 * reachable engine up front instead of paying the 10s timeout per paragraph.
 *
 * Request shape reverse-engineered from the live page (2026-08-29):
 *   GET  https://www.bing.com/translator            (redirects to cn.bing.com in CN)
 *     → _G.IG page token, params_AbusePreventionHelper [key, token, expiryMs],
 *       container data-iid
 *   POST {origin}/ttranslatev3?isVertical=1&IG=…&IID=…&SFX=<counter>
 *        &token=…&key=…                              (auth params in the QUERY STRING)
 *     body: fromLang&to&text (form-urlencoded)
 *
 * Cookies are intentionally NOT forwarded manually — in Zotero the fetch goes
 * through the Firefox network stack, which keeps the bing.com cookie jar alive
 * between the token-page GET and the translate POST on its own.
 */

interface BingWebSession {
  origin: string;
  ig: string;
  iid: string;
  key: string;
  token: string;
  expiresAt: number;
  sfx: number;
}

let bingWebSession: BingWebSession | null = null;

/** Drop the cached Bing web session (tests; also correct after long suspend). */
export function resetBingWebSession(): void {
  bingWebSession = null;
}

/** Map Zotero locale codes to Bing web language ids (zh-CN → zh-Hans etc.). */
function toBingWebLang(code: string): string {
  // The live ttranslatev3 endpoint rejects fromLang=auto with
  // {"statusCode":400}; auto-detection must ask for "auto-detect" (verified
  // against cn.bing.com on 2026-09-24 — mocked tests can't see server-side
  // contract changes).
  if (!code || code === "auto") return "auto-detect";
  if (code === "zh-CN") return "zh-Hans";
  if (code === "zh-TW" || code === "zh-HK") return "zh-Hant";
  return code.split("-")[0];
}

/**
 * Script-based source-language guess for the Bing web engine (ported from
 * z-search's detectBingSourceLang, 2026-09-30).
 *
 * Bing 的 ttranslatev3 对源语言参数的容错远高于被参数缺失直接拒绝，但调用方
 * 完全不传源语言时（部分批量与摘要路径），本地按 Unicode 区段先判一次比把
 * 判定全部交给服务端更稳：常见文种（中日韩/西里尔/阿拉伯/泰/希伯来）按区段
 * 即可高置信区分，拉丁文种默认 en。返回 Zotero 风格代码，沿用 toBingWebLang
 * 的映射（zh-CN → zh-Hans）。
 */
function detectBingWebSourceLang(text: string): string {
  const sample = String(text ?? "").slice(0, 2000);
  if (/[\uac00-\ud7af]/.test(sample)) return "ko";
  if (/[\u3040-\u30ff]/.test(sample)) return "ja";
  if (/[\u4e00-\u9fff]/.test(sample)) return "zh-CN";
  if (/[\u0400-\u04ff]/.test(sample)) return "ru";
  if (/[\u0600-\u06ff]/.test(sample)) return "ar";
  if (/[\u0e00-\u0e7f]/.test(sample)) return "th";
  if (/[\u0590-\u05ff]/.test(sample)) return "he";
  return "en";
}

let bingWebSessionRequest: Promise<BingWebSession> | null = null;
async function fetchBingWebSession(signal?: AbortSignal): Promise<BingWebSession> {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (bingWebSession && Date.now() < bingWebSession.expiresAt) return bingWebSession;
  if (!bingWebSessionRequest) bingWebSessionRequest = loadBingWebSession().finally(() => { bingWebSessionRequest = null; });
  const session = await bingWebSessionRequest;
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  return session;
}
async function loadBingWebSession(): Promise<BingWebSession> {
  if (bingWebSession && Date.now() < bingWebSession.expiresAt) {
    return bingWebSession;
  }
  const resp = await httpGet(
    "https://www.bing.com/translator",
    KEYLESS_ENDPOINT_TIMEOUT_MS,
    undefined,
  );
  const html = await resp.text();
  const ig = html.match(/IG:"([A-Fa-f0-9]{16,})"/)?.[1] || "";
  const abuse = html.match(
    /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*\]/,
  );
  const iid =
    html.match(/id="rich_tta"\s+data-iid="(translator\.\d+)"/)?.[1] ||
    "translator.5023";
  if (!ig || !abuse) {
    throw new Error(getString("translation-error-bing-token-unavailable"));
  }
  const [, key, token, expiresMs] = abuse;
  bingWebSession = {
    // www.bing.com redirects to cn.bing.com in CN — POST to the final origin.
    origin: new URL(resp?.url || "https://www.bing.com").origin,
    ig,
    iid,
    key,
    token,
    // Refresh a minute ahead of the server-reported expiry (typically 1h).
    expiresAt: Date.now() + Math.max(60000, Number(expiresMs) - 60000),
    sfx: 0,
  };
  return bingWebSession;
}

async function postBingWebTranslate(
  text: string,
  targetLanguage: string,
  sourceLanguage: string,
  session: BingWebSession,
  signal?: AbortSignal,
): Promise<{
  success: boolean;
  translatedText?: string;
  error?: string;
  tokenRejected?: boolean;
}> {
  try {
    // SFX is a per-session request counter on the live page (ei++).
    const sfx = session.sfx++;
    const url =
      `${session.origin}/ttranslatev3?isVertical=1` +
      `&IG=${encodeURIComponent(session.ig)}` +
      `&IID=${encodeURIComponent(session.iid)}` +
      `&SFX=${sfx}` +
      `&token=${encodeURIComponent(session.token)}` +
      `&key=${encodeURIComponent(session.key)}`;
    const body = new URLSearchParams({
      fromLang: toBingWebLang(sourceLanguage),
      to: toBingWebLang(targetLanguage),
      text,
      tryFetchingGenderDebiasedTranslations: "false",
    });
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${session.origin}/translator`,
      },
      body: body.toString(),
      signal: combineSignal(signal, KEYLESS_ENDPOINT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      if (resp.status === 429 || resp.status === 411) throw httpStatusError(resp, "");
      return {
        success: false,
        error: `HTTP ${resp.status}: ${resp.statusText}`,
        tokenRejected: resp.status === 401 || resp.status === 403,
      };
    }
    const data = (await resp.json()) as any;
    // Two observed shapes: [{ translations: [...] }] and [[{ translations: [...] }]].
    // Bing rejection (e.g. stale token): { statusCode: 400, errorMessage: "" }.
    const entry = Array.isArray(data?.[0])
      ? data[0].find((x: any) => x?.translations)
      : data?.[0];
    const translated = entry?.translations?.[0]?.text;
    if (!translated) {
      return {
        success: false,
        error:
          typeof data?.errorMessage === "string" && data.errorMessage
            ? getString("translation-error-bing-rejected", {
                status: String(data.statusCode ?? 400),
              })
            : getString("translation-error-bing-empty"),
        tokenRejected: true,
      };
    }
    return { success: true, translatedText: translated };
  } catch (e: any) {
    if (isRateLimitError(e)) throw e;
    return { success: false, error: redactTranslationError(e) };
  }
}

async function translateWithBingWeb(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  // 源语言二分（与 z-search 的区段判定互补）：调用方显式给了语言（含显式
  // "auto"）→ 走既有映射（auto → auto-detect，由 Bing 服务端判定）；完全没传
  // → 本地按 Unicode 区段判定，避免无依据的参数落在服务端。
  const src =
    sourceLanguage === undefined || sourceLanguage === ""
      ? detectBingWebSourceLang(text)
      : toApiSourceLang(sourceLanguage);
  try {
    let result = await postBingWebTranslate(
      text,
      targetLanguage,
      src,
      await fetchBingWebSession(signal),
      signal,
    );
    if (!result.success && result.tokenRejected) {
      // Stale/invalid session — refetch the token page once and retry.
      bingWebSession = null;
      result = await postBingWebTranslate(
        text,
        targetLanguage,
        src,
        await fetchBingWebSession(signal),
      signal,
      );
    }
    if (!result.success) {
      return {
        success: false,
        error: result.error || getString("translation-error-bing-failed"),
      };
    }
    return { success: true, translatedText: result.translatedText };
  } catch (e: any) {
    if (isRateLimitError(e)) throw e;
    return { success: false, error: redactTranslationError(e) };
  }
}

/**
 * DeepL API.
 *
 * Requires apiKey (Auth Key from DeepL Pro/Free plan).
 * - Free tier: https://api-free.deepl.com/v2/translate
 * - Pro tier:   https://api.deepl.com/v2/translate
 *
 * Docs: https://developers.deepl.com/docs
 */
async function translateWithDeepL(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
  opts: DeepLTranslateOptions = { apiKey: "" },
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  const src = toApiSourceLang(sourceLanguage);
  const tgt = toDeepLTargetLang(targetLanguage);

  try {
    const host = opts.useFreeEndpoint ? "api-free.deepl.com" : "api.deepl.com";
    const params = new URLSearchParams();
    params.set("target_lang", tgt);
    if (src !== "auto")
      params.set("source_lang", toApiTargetLang(src).toUpperCase());
    params.set("text", text);

    // DeepL 免费版并发与配额受限，是批量全文翻译最容易触发 429 的端点：
    // 包一层限流退避（Retry-After 优先），重试仍拒绝才以限流文案失败。
    const resp = await withRateLimitRetry(() =>
      httpPostForm(
        `https://${host}/v2/translate`,
        { Authorization: `DeepL-Auth-Key ${opts.apiKey}` },
        params,
        30000,
        opts.signal,
      ),
      opts.signal,
    );
    const data = (await resp.json()) as any;
    const translated = data?.translations?.[0]?.text;
    if (!translated)
      throw new Error(getString("translation-error-deepl-empty"));
    return { success: true, translatedText: translated };
  } catch (e: any) {
    return { success: false, error: redactTranslationError(e) };
  }
}

/**
 * Model-backed translation ("ai" engine) — the port of leadero's "ai" engine
 * onto z-transplit's own OpenAI-compatible client.
 *
 * The prompt is not hard-coded: it comes from the user's template
 * (translate.ai.prompt, "" = built-in default) with the language pair and the
 * text substituted into it. The template is validated first and a rejected
 * template fails the request with the exact reason instead of sending a
 * half-broken prompt to the model.
 *
 * The rendered template is the whole user message — the template owns where
 * the text goes, so a separate system message would either bypass it or send
 * the text twice.
 */
async function translateWithAI(
  text: string,
  targetLanguage: string,
  sourceLanguage: string | undefined,
  opts: AITranslateOptions,
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  // Language descriptors are resolved here (not in the template) so the user
  // writes "{{sourceLang}}" and the plugin decides it means "Simplified Chinese".
  const targetDesc = getLanguageName(targetLanguage);
  const sourceDesc = sourceLanguage
    ? getLanguageName(sourceLanguage)
    : "auto-detect";

  const check = validatePromptTemplate(opts.prompt);
  if (!check.ok) {
    return {
      success: false,
      error: getString(`translation-error-ai-prompt-${check.reason}`),
    };
  }

  try {
    const client = createOpenAICompatClient({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      defaultModel: opts.model,
      emptyResultErrorKey: "translation-error-ai-empty",
    });

    // AI 端点同样有配额与并发限流；单段路径包一次限流退避，避免批量并发
    // 下的 429 直接变成段落失败。
    const result = await withRateLimitRetry(() =>
      client.chat({
        messages: [
          {
            role: "user",
            content: renderPrompt(check.template, {
              text,
              sourceLang: sourceDesc,
              targetLang: targetDesc,
            }),
          },
        ],
        maxTokens: Math.max(
          MODEL_OUTPUT_FLOOR_TOKENS,
          Math.min(text.length * 2, SINGLE_OUTPUT_MAX_TOKENS),
        ),
        temperature: 0.3,
        timeoutMs: AI_ENDPOINT_TIMEOUT_MS,
        signal: opts.signal,
      }),
      opts.signal,
    );

    return { success: true, translatedText: result.content };
  } catch (e: any) {
    return { success: false, error: redactTranslationError(e) };
  }
}

/**
 * Custom OpenAI-compatible endpoint.
 *
 * Sends a chat completion with the formula-preserving system prompt (see
 * src/core/translation/prompts.ts) through the shared OpenAI-compatible client.
 * Useful for self-hosted models (Ollama, LM Studio, vLLM, etc.) or any
 * OpenAI-compatible API — this is also the only engine with batch JSON ability.
 */
async function translateWithCustom(
  text: string,
  targetLanguage: string,
  sourceLanguage: string | undefined,
  opts: CustomTranslateOptions,
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  const targetDesc = getLanguageName(targetLanguage);
  const sourceDesc = sourceLanguage
    ? getLanguageName(sourceLanguage)
    : "auto-detect";

  try {
    const client = createOpenAICompatClient({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      defaultModel: opts.model,
    });

    // 与 AI 引擎同源的自定义端点也走限流退避（同一个 openaiCompat 客户端，
    // 同一种 429 形态）。
    const result = await withRateLimitRetry(() =>
      client.chat({
        messages: [
          {
            role: "system",
            content: formulaPreservingPrompt(targetDesc, sourceDesc),
          },
          { role: "user", content: text },
        ],
        maxTokens: Math.max(
          MODEL_OUTPUT_FLOOR_TOKENS,
          Math.min(text.length * 2, SINGLE_OUTPUT_MAX_TOKENS),
        ),
        temperature: 0.3,
        timeoutMs: AI_ENDPOINT_TIMEOUT_MS,
        signal: opts.signal,
      }),
      opts.signal,
    );

    return { success: true, translatedText: result.content };
  } catch (e: any) {
    return { success: false, error: redactTranslationError(e) };
  }
}

/**
 * Zotero PDF Translate plugin bridge.
 *
 * Delegates translation to the external zotero-pdf-translate plugin via its
 * public API: `Zotero.PDFTranslate.api.translate(raw, options)`.
 * The call returns a TranslateTask whose `result` is already populated
 * because the API awaits `runTranslationTask` internally.
 */
async function translateWithZoteroPdfTranslate(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<{ success: boolean; translatedText?: string; error?: string }> {
  try {
    const api =
      typeof Zotero === "undefined"
        ? undefined
        : (Zotero as any)?.PDFTranslate?.api;
    if (!api?.translate) {
      return {
        success: false,
        error: getString("translation-error-pdf-translate-missing"),
      };
    }

    const task = await api.translate(text, {
      pluginID: "wenxianyidu@wenxianyidu.local",
      langfrom: sourceLanguage,
      langto: targetLanguage,
    });

    if (task.status === "success" && task.result) {
      return { success: true, translatedText: task.result };
    }

    return {
      success: false,
      error: task.result || getString("translation-error-pdf-translate-failed"),
    };
  } catch (e: any) {
    return { success: false, error: redactTranslationError(e) };
  }
}

export interface EngineConfig {
  engineType: TranslationEngineType;
  youdaoAppKey?: string;
  youdaoAppSecret?: string;
  niutransApiKey?: string;
  niutransApiUrl?: string;
  googleApiKey?: string;
  bingApiKey?: string;
  bingRegion?: string;
  deeplApiKey?: string;
  deeplUseFree?: boolean;
  customApiUrl?: string;
  customApiKey?: string;
  customModel?: string;
  aiApiUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  /** Raw prompt template ("" = built-in default). */
  aiPrompt?: string;
  /**
   * User-set cap on one merged batch's INPUT size, in estimated tokens
   * (translate.batchMaxTokens; undefined = default). planTranslationChunks
   * packs paragraphs up to this budget — a paragraph that would overflow
   * starts the next batch, i.e. the overflowing batch ships one paragraph
   * short rather than exceeding the cap.
   */
  batchMaxTokens?: number;
}

/**
 * Read the current engine config from dynamic prefs.
 */
export function getEngineConfig(): EngineConfig {
  const get = (key: string, fallback?: string) => {
    const v = getPrefDynamic(key);
    return v !== undefined && v !== null ? String(v) : fallback;
  };

  return {
    engineType:
      (get("translate.engineType") as TranslationEngineType) ||
      DEFAULT_TRANSLATE_ENGINE_TYPE,
    youdaoAppKey: get("translate.youdaoOfficial.appKey") || undefined,
    youdaoAppSecret: get("translate.youdaoOfficial.appSecret") || undefined,
    niutransApiKey: get("translate.niutrans.apiKey") || undefined,
    niutransApiUrl: get("translate.niutrans.apiUrl") || "https://api.niutrans.com/NiuTransServer/translation",
    googleApiKey: get("translate.google.apiKey") || undefined,
    bingApiKey: get("translate.bing.apiKey") || undefined,
    bingRegion: get("translate.bing.region") || "global",
    deeplApiKey: get("translate.deepl.apiKey") || undefined,
    deeplUseFree: get("translate.deepl.useFree") === "true",
    customApiUrl: get("translate.custom.apiUrl") || undefined,
    customApiKey: get("translate.custom.apiKey") || undefined,
    // Empty string = no model override: openaiCompat omits the wire `model`
    // field so the server picks its default, as the preferences pane promises.
    customModel: get("translate.custom.model") || "",
    aiApiUrl: get("translate.ai.apiUrl") || undefined,
    aiApiKey: get("translate.ai.apiKey") || undefined,
    // Same "empty = server default" contract as customModel above.
    aiModel: get("translate.ai.model") || "",
    aiPrompt: get("translate.ai.prompt") || "",
    batchMaxTokens: (() => {
      const raw = Number(get("translate.batchMaxTokens"));
      return Number.isFinite(raw) && raw > 0 ? raw : undefined;
    })(),
  };
}

/**
 * Stable fingerprint of the engine configuration for the persistent translation
 * cache (translationCache.ts). Two runs with the same identity are assumed to
 * produce interchangeable translations, so cached paragraphs are reused.
 * Credential revisions invalidate caches without storing key fragments.
 *
 * The "ai" engine additionally fingerprints its prompt template: the template
 * *is* the engine's behaviour, so editing it must invalidate cached paragraphs
 * (a cached Google paragraph is interchangeable with another Google paragraph;
 * a cached paragraph from prompt A is not one from prompt B).
 */
export interface EngineCapabilities {
  label: string; supportsPrompt: boolean; supportsStreaming: boolean;
  maxChars: number; concurrency: number; requiresProxy: boolean; trial: boolean;
}
export function getEngineCapabilities(engine: string = getEngineConfig().engineType): EngineCapabilities {
  const names: Record<string,string> = { youdao: "有道免注册试用（短文本）", "bing-web": "必应免注册试用", "youdao-official": "有道智云", niutrans: "小牛翻译", ai: "自己的 AI API", custom: "兼容 AI 接口", google: "Google 翻译", bing: "Azure 翻译", deepl: "DeepL", "zotero-pdf-translate": "Translate for Zotero" };
  const model = engine === "ai" || engine === "custom";
  // 并发上限（同时进行的翻译请求数）。免注册必应网页端点实测可承受 5 路并发
  // （21 段压测 21/21 成功：1 路约 1.5–3 s/段，3 路约 0.7 s/段，5 路约 0.54 s/段），
  // 取 4 路兼顾速度与被临时限流的风险；有道试用约 6 次即触发 411，只能串行。
  const concurrency = engine === "bing-web" ? 4 : model ? 2 : 1;
  return { label:names[engine] || engine, supportsPrompt:model, supportsStreaming:false,
    // The public Youdao demo returns 103 above 1000 characters (live verified).
    maxChars:model ? 12000 : engine === "youdao" ? 1000 : 4000,
    concurrency, requiresProxy:engine === "google", trial:engine === "youdao" || engine === "bing-web" };
}
/** This identity contains output-affecting configuration, never key fragments. */
export function engineCacheIdentity(): string {
  const cfg = getEngineConfig();
  const parts: string[] = [cfg.engineType, "wy3-sentence-math", String(getPrefDynamic("translate.credentialsRevision") || "")];
  if (cfg.engineType === "mtranserver") parts.push("mtran-5.0.1", "en-zh-Hans-3.0");
  if(cfg.engineType === "ai") parts.push(cfg.aiModel || "", cfg.aiApiUrl ? normalizeChatCompletionsUrl(cfg.aiApiUrl) : "", promptFingerprint(resolvePromptTemplate(cfg.aiPrompt)));
  if(cfg.engineType === "custom") parts.push(cfg.customModel || "", cfg.customApiUrl ? normalizeChatCompletionsUrl(cfg.customApiUrl) : "");
  if(cfg.engineType === "google") parts.push(cfg.googleApiKey ? "keyed" : "keyless");
  if(cfg.engineType === "deepl") parts.push(cfg.deeplUseFree ? "free" : "pro");
  if(cfg.engineType === "bing") parts.push(cfg.bingRegion || "global");
  if(cfg.engineType === "niutrans") parts.push(cfg.niutransApiUrl || "");
  return parts.join("|");
}
const TRANSLATION_CACHE = new Map<string, string>();
const TRANSLATION_CACHE_MAX = 500;
export function clearTranslationCache(): void { TRANSLATION_CACHE.clear(); }

function validateProtectedText(source: string, translated: string): void {
  if(!protectedTextUnchanged(source, translated)) throw new Error("译文中的公式标记发生变化，请重试或调整提示词。");
}
/** One cache, one bounded request queue, and shared cancellation for every view. */
export function createTranslator(targetLanguage: string, sourceLanguage?: string, signal?: AbortSignal): ParagraphTranslator {
  const cfg = getEngineConfig();
  const identity = engineCacheIdentity();
  const caps = getEngineCapabilities(cfg.engineType);
  return async (text: string, tgt: string, src?: string) => {
    assertNotCancelled(signal);
    const target = tgt || targetLanguage;
    const source = src || sourceLanguage || "auto";
    const key = identity + "\u0000" + source + "\u0000" + target + "\u0000" + text;
    const hit = getPrefDynamic("translate.cache.enabled") !== false ? TRANSLATION_CACHE.get(key) : undefined;
    if(hit !== undefined) return hit;
    try {
      return await sharedRequest(key, async (sharedSignal) => {
        if(cacheAvailable()) {
          const diskKey = await cacheKey(identity,source,target,text);
          const disk = await getCachedTranslations([diskKey]);
          if(diskKey && disk.has(diskKey) && protectedTextUnchanged(text, disk.get(diskKey)!)) return disk.get(diskKey)!;
          // Legacy tasks without a segment manifest still recover ordinary
          // paragraphs from 0.1.1. Fragmented MT math results are invalidated.
          if (caps.supportsPrompt || !maskProtectedSentence(text).parts.some(part => part.protected)) {
            const legacyKey = await cacheKey(identity.replace("wy3-sentence-math", "wy2-math"), source, target, text);
            const legacy = await getCachedTranslations([legacyKey]);
            if (legacyKey && legacy.has(legacyKey) && protectedTextUnchanged(text, legacy.get(legacyKey)!)) return legacy.get(legacyKey)!;
          }
        }
        assertNotCancelled(sharedSignal);
        const inner = createTranslatorUncached(target,src || sourceLanguage,sharedSignal,cfg);
        const runText = async (value:string):Promise<string> => {
          if(!value.trim()) return value;
          const chunks = splitLongText(value,caps.maxChars);
          const translated:string[]=[];
          for(const chunk of chunks) {
            assertNotCancelled(sharedSignal);
            const lead = chunk.match(/^\s*/)?.[0] || "";
            const tail = chunk.match(/\s*$/)?.[0] || "";
            const result = await providerSlot(cfg.engineType,caps.concurrency,sharedSignal,()=>inner(chunk.trim(),target,source));
            if(!result?.trim()) throw new Error("翻译服务未返回内容，请重试。");
            translated.push(lead + result.trim() + tail);
          }
          return translated.join("");
        };
        let result:string;
        // Classic MT services have no prompt mechanism. Preserve math locally.
        if(!caps.supportsPrompt) {
          result = await translateProtectedSentence(text, runText);
        } else result=await runText(text);
        assertNotCancelled(sharedSignal);
        validateProtectedText(text,result);
        if(TRANSLATION_CACHE.size >= TRANSLATION_CACHE_MAX) TRANSLATION_CACHE.delete(TRANSLATION_CACHE.keys().next().value!);
        if (getPrefDynamic("translate.cache.enabled") !== false) TRANSLATION_CACHE.set(key,result);
        if(cacheAvailable()) await putCachedTranslation(identity,source,target,text,result);
        return result;
      },signal);
    } catch(error) {
      if(signal?.aborted) throw Object.assign(new Error("翻译已取消"),{name:"AbortError"});
      throw Object.assign(new Error(userFacingError(error,signal), { cause: error }), { status: (error as any)?.status, retryAfterSec: retryAfterOfError(error) ?? retryAfterOfError((error as any)?.cause) });
    }
  };
}

/** Always performs a network call: an old cached translation cannot verify a key. */
export async function testEngineConnection(): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const translator = createTranslatorUncached("zh-CN", "en");
    const text = await translator("This study evaluates the accuracy of machine translation.", "zh-CN", "en");
    if (!text?.trim()) throw new Error("服务未返回译文。");
    return { success: true, text };
  } catch (error) { return { success: false, error: userFacingError(error) }; }
}

function createTranslatorUncached(
  targetLanguage: string,
  sourceLanguage?: string,
  signal?: AbortSignal,
  config?: EngineConfig,
): ParagraphTranslator {
  const cfg = config || getEngineConfig();

  switch (cfg.engineType) {
    case "mtranserver":
      return async (text: string) => (await import("./offlineManager")).offlineTranslateBatch([text], targetLanguage, sourceLanguage, signal).then(items => items[0]);
    // The keyless/官方 MT adapters below have no client-level backoff of their
    // own, so each call is wrapped in the shared rate-limit retry (429 and
    // 有道试用 411). "ai"/"custom" already wrap themselves — see translateWithAI.
    case "youdao": return (text) => withRateLimitRetry(() => translateYoudao(text,targetLanguage,sourceLanguage,signal), signal);
    case "youdao-official": return (text) => withRateLimitRetry(() => translateYoudaoOfficial(text,targetLanguage,sourceLanguage,cfg.youdaoAppKey || "",cfg.youdaoAppSecret || "",signal), signal);
    case "niutrans": return (text) => withRateLimitRetry(() => translateNiuTrans(text,targetLanguage,sourceLanguage,cfg.niutransApiKey || "",cfg.niutransApiUrl,signal), signal);
    case "ai":
      return async (text: string) => {
        if (!cfg.aiApiUrl)
          throw new Error(getString("translation-error-ai-url-missing"));
        const result = await translateWithAI(
          text,
          targetLanguage,
          sourceLanguage,
          {
            apiUrl: cfg.aiApiUrl,
            apiKey: cfg.aiApiKey,
            model: cfg.aiModel,
            prompt: cfg.aiPrompt,
            signal,
          },
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-ai-failed"),
          );
        return result.translatedText || "";
      };
    case "google": {
      const googleOnly = async (text: string) => {
        const result = await translateWithGoogle(
          text,
          targetLanguage,
          sourceLanguage,
          {
            apiKey: cfg.googleApiKey,
            signal,
          },
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-google-failed"),
          );
        return result.translatedText!;
      };
      return googleOnly;
    }
    case "bing":
      return async (text: string) => {
        if (!cfg.bingApiKey)
          throw new Error(getString("translation-error-bing-not-configured"));
        const result = await translateWithBing(
          text,
          targetLanguage,
          sourceLanguage,
          {
            apiKey: cfg.bingApiKey,
            region: cfg.bingRegion || "global",
            signal,
          },
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-bing-failed"),
          );
        return result.translatedText!;
      };
    case "bing-web":
      return async (text: string) => {
        const result = await withRateLimitRetry(
          () => translateWithBingWeb(text, targetLanguage, sourceLanguage, signal),
          signal,
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-bing-failed"),
          );
        return result.translatedText!;
      };
    case "deepl":
      return async (text: string) => {
        if (!cfg.deeplApiKey)
          throw new Error(getString("translation-error-deepl-not-configured"));
        const result = await translateWithDeepL(
          text,
          targetLanguage,
          sourceLanguage,
          {
            apiKey: cfg.deeplApiKey,
            useFreeEndpoint: cfg.deeplUseFree,
            signal,
          },
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-deepl-failed"),
          );
        return result.translatedText || "";
      };
    case "zotero-pdf-translate":
      return async (text: string) => {
        const result = await translateWithZoteroPdfTranslate(
          text,
          targetLanguage,
          sourceLanguage,
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-pdf-translate-failed"),
          );
        return result.translatedText || "";
      };
    case "custom":
      return async (text: string) => {
        if (!cfg.customApiUrl)
          throw new Error(getString("translation-error-custom-url-missing"));
        const result = await translateWithCustom(
          text,
          targetLanguage,
          sourceLanguage,
          {
            apiUrl: cfg.customApiUrl,
            apiKey: cfg.customApiKey,
            model: cfg.customModel,
            signal,
          },
        );
        if (!result.success)
          throw new Error(
            result.error || getString("translation-error-custom-failed"),
          );
        return result.translatedText || "";
      };
    default:
      return async () => { throw new Error("当前翻译引擎不可用，请在设置中重新选择引擎。"); };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch translation (custom / OpenAI-compatible engine only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zod schema for the batch translation response. chatJson validates against it
 * on the structured-output path, and the manual JSON path re-parses the same
 * shape, so both levels share one contract.
 *
 * A bare string array (not `{id, translation}` objects) keeps the schema simple
 * and reduces the model error surface — alignment is positional, so array order
 * is the source of truth.
 */
const BatchTranslationSchema = z.object({
  translations: z.array(z.string()),
});

/**
 * Whether the currently configured engine benefits from batch translation.
 * The model-backed engines ("custom" and "ai") do: paragraphs are packed into
 * one model call with structured JSON output, which gives the model
 * cross-paragraph context and cuts call count ~25-50×. For "ai" the user's
 * template is single-text, so the batch system prompt is derived FROM that
 * template (see prompts.ts#batchJsonPromptFromTemplate) — each segment takes
 * the template's {{text}} role. Traditional MT APIs (Google/Bing/DeepL) are
 * stateless and accept single text, so per-paragraph dispatch stays
 * appropriate for them.
 */
export function supportsBatching(): boolean {
  const t = getEngineConfig().engineType;
  return t === "custom" || t === "ai" || t === "mtranserver";
}

/**
 * Token budgets. leadero read these off the resolved provider
 * (getContextWindow/getMaxOutputTokens); this port now mirrors that via the
 * model-name lookup in core/ai/modelCatalog.ts (unknown models keep the
 * original constants below — see FALLBACK_MODEL_BUDGETS).
 */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
// Batch output cap. Reasoning models burn completion tokens on hidden thinking
// that scales with the packed batch size, so this deliberately overshoots the
// expected translation length — max_tokens is a ceiling, not a target, and
// well-behaved models still stop at their own end-of-sequence.
const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
const SYSTEM_RESERVE_TOKENS = 600; // batch prompt + JSON wrapper overhead
const SAFETY_MARGIN = 0.15; // 15% for estimation error + delimiter overhead

/**
 * Chars-per-token ratio. Starts at 2.5 (Chinese-mixed text average) and
 * self-calibrates with an exponential moving average from reported usage —
 * same semantics as leadero's TokenBudgetEstimator (clamp 1..6, alpha 0.3).
 * Fixed 2.5 underestimates tokens for CJK-heavy text (~1.5-2 chars/token),
 * oversizing the input budget until the API rejects the call.
 */
const INITIAL_CHARS_PER_TOKEN = 2.5;
const CHARS_PER_TOKEN_EMA_ALPHA = 0.3;
let charsPerToken = INITIAL_CHARS_PER_TOKEN;

function calibrateCharsPerToken(
  totalChars: number,
  actualInputTokens: number,
): void {
  if (actualInputTokens <= 0 || totalChars <= 0) return;
  const measured = totalChars / actualInputTokens;
  // Clamp to reasonable range (1..6 chars/token)
  const clamped = Math.max(1, Math.min(6, measured));
  charsPerToken =
    charsPerToken * (1 - CHARS_PER_TOKEN_EMA_ALPHA) +
    clamped * CHARS_PER_TOKEN_EMA_ALPHA;
}

/** Sentinel message for user-initiated cancellation. */
const CANCELLED = "translation_cancelled";

function isCancelled(e: unknown): boolean {
  return e instanceof Error && (e.message === CANCELLED || e.name === "AbortError");
}

const RETRY_BACKOFF_MS = 500;

function backoff(): Promise<void> {
  return new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
}

/**
 * Race a promise against an optional abort signal and optional total timeout.
 * Used for chatJson (non-streaming → no idleness detection).
 */
function raceAbort<T>(
  work: Promise<T>,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error(CANCELLED));

  const racers: Promise<unknown>[] = [work];
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (signal) {
    racers.push(
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error(CANCELLED)), {
          once: true,
        }),
      ),
    );
  }
  if (timeoutMs) {
    racers.push(
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    );
  }

  if (racers.length === 1) return work;
  for (const r of racers) r.catch(() => {});
  return Promise.race(racers).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Execute a client call with a timeout and cooperative cancellation.
 *
 * leadero resets this timer on every onStream event for true idleness
 * detection. openaiCompat is non-streaming (it returns the full completion at
 * once), so there is no token event to reset on: the idle budget degenerates
 * into a total timeout — exactly how leadero's own non-streaming providers
 * (Google/custom) degrade.
 */
async function executeWithIdleTimeout<T>(
  call: () => Promise<T>,
  idleMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new Error(CANCELLED);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const idleP = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `idle timeout — no completion for ${Math.round(idleMs / 1000)}s`,
          ),
        ),
      idleMs,
    );
  });

  const racers: Promise<unknown>[] = [call(), idleP];
  if (signal) {
    racers.push(
      new Promise<never>((_, reject) => {
        if (signal.aborted) return reject(new Error(CANCELLED));
        signal.addEventListener("abort", () => reject(new Error(CANCELLED)), {
          once: true,
        });
      }),
    );
  }
  for (const r of racers) r.catch(() => {});

  try {
    return (await Promise.race(racers)) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Create a batch translator that packs multiple paragraphs into a single
 * model call via structured JSON output.
 *
 * The returned translator NEVER throws — on any failure it degrades:
 *   1. Structured batch pass (response_format json_object + zod schema)
 *   2. Up to MAX_BATCH_RETRIES manual-parse retries of the same batch request
 *      (no response_format — some gateways mishandle it; prose-wrapped JSON is
 *      the next most common failure shape)
 *   3. Per-paragraph chat (the original single-paragraph path)
 *   4. Original text preserved (marked as failed)
 *
 * At every level the result always contains exactly `texts.length` strings.
 *
 * Also computes the token-budget parameters (inputBudgetChars,
 * outputBudgetChars), so the orchestrator can size chunks correctly.
 *
 * @throws if the custom engine has no API URL configured.
 */
export async function createAIBatchTranslator(
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<BatchTranslatorHandle> {
  if (getEngineConfig().engineType === "mtranserver") return {
    inputBudgetChars: 12000, outputBudgetChars: 12000,
    translate: async (texts, signal) => {
      const { offlineTranslateBatch } = await import("./offlineManager");
      const masks = texts.map(maskProtectedSentence);
      const translated = await offlineTranslateBatch(masks.map(mask => mask.masked), targetLanguage, sourceLanguage, signal);
      const translations = await Promise.all(masks.map(async (mask, i) => mask.restore(translated[i]) ?? await translateProtectedSentence(texts[i], async value => (await offlineTranslateBatch([value], targetLanguage, sourceLanguage, signal))[0])));
      return { translations, failedIndices: [] };
    },
  };
  const cfg = getEngineConfig();
  // Both model-backed engines share this batch path; they differ in where the
  // credentials come from and whose wording drives the prompt.
  const isAI = cfg.engineType === "ai";
  if (isAI && !validatePromptTemplate(cfg.aiPrompt).ok) throw new Error("提示词模板无效，请先修正占位符。");
  const apiUrl = isAI ? cfg.aiApiUrl : cfg.customApiUrl;
  const apiKey = isAI ? cfg.aiApiKey : cfg.customApiKey;
  const model = isAI ? cfg.aiModel : cfg.customModel;
  if (!apiUrl) {
    throw new Error(
      getString(isAI ? "translation-error-ai-url-missing" : "translation-error-custom-url-missing"),
    );
  }

  const client = createOpenAICompatClient({
    apiUrl,
    apiKey,
    defaultModel: model,
  });

  // ── Language descriptors ──
  const targetDesc = getLanguageName(targetLanguage);
  const sourceDesc = sourceLanguage
    ? getLanguageName(sourceLanguage)
    : "auto-detect";

  // ── Prompts ──
  // "custom" keeps its fixed batch wording; "ai" derives the batch prompt from
  // the user's own template so a custom prompt still governs every segment
  // (rendered once with a symbolic {{text}} role — see prompts.ts).
  const template = resolvePromptTemplate(cfg.aiPrompt);
  const prompt = isAI
    ? batchJsonPromptFromTemplate(template, targetDesc, sourceDesc)
    : batchJsonPrompt(targetDesc, sourceDesc);
  const singlePrompt = formulaPreservingPrompt(targetDesc, sourceDesc);

  // ── Token budgets ──
  // Two hard constraints: contextWindow (input + output must fit) and
  // maxOutputTokens (output cap). Output is usually the tighter bottleneck.
  // 供应商内省：按模型名查表取上下文窗口与输出上限（unknown 沿用常量兜底），
  // 取代原先写死的 128000 / 16384。
  // The user-set translate.batchMaxTokens caps one merged batch's INPUT —
  // planTranslationChunks closes a batch before the paragraph that would
  // overflow it, so an over-budget batch ships one paragraph short. The
  // context-window remainder is a ceiling the pref can only lower.
  // `||` (not `??`) on both: a 0 return means "unknown", not "zero".
  const modelBudgets = resolveModelBudgets(model);
  const contextWindow = modelBudgets.contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS;
  const maxOutput = modelBudgets.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS;

  const outputBudgetTokens = Math.floor(maxOutput * (1 - SAFETY_MARGIN));
  const outputBudgetChars = Math.max(
    1000,
    Math.floor(outputBudgetTokens * charsPerToken),
  );
  const inputBudgetTokens = Math.max(
    1000,
    Math.min(
      contextWindow - SYSTEM_RESERVE_TOKENS - maxOutput,
      Math.floor(cfg.batchMaxTokens || DEFAULT_BATCH_MAX_TOKENS),
    ),
  );
  const inputBudgetChars = Math.max(
    1000,
    Math.floor(inputBudgetTokens * charsPerToken),
  );

  // ── Timeouts ──
  // chatJson is a single non-streaming round trip → generous total timeout.
  // chat() likewise returns once, so the idle budget acts as a total timeout.
  // The totals assume a reasoning model on a full batch (16384-token ceiling):
  // minutes, not seconds — an idle-based guard covers the hung-connection case.
  const TOTAL_TIMEOUT_BATCH_MS = 300000; // 5 min
  const IDLE_TIMEOUT_BATCH_MS = 120000; // 2 min for batch calls
  const IDLE_TIMEOUT_SINGLE_MS = 60000; // 1 min for single-paragraph

  // ── Batch translator (batch-first with bounded retries; throws CANCELLED
  //    on abort) ──
  const translate: BatchTranslator = async (
    texts: string[],
    signal?: AbortSignal,
  ): Promise<BatchTranslateResult> => {
    if (signal?.aborted) throw new Error(CANCELLED);
    return providerSlot(cfg.engineType, getEngineCapabilities(cfg.engineType).concurrency, signal, async () => {
    const inputJson = JSON.stringify({ segments: texts });

    // Batch phase — up to 1 + MAX_BATCH_RETRIES attempts on the SAME chunk.
    // A non-compliant result (HTTP error, empty content, JSON parse/schema
    // failure, or a count mismatch) is retried rather than falling straight
    // through to per-paragraph: reasoning-style models occasionally mangle the
    // JSON envelope on a first pass but recover cleanly on a second. Attempt 1
    // asks for structured output; the retries drop response_format and parse
    // manually — some gateways 400 on (or behave worse with) response_format,
    // and prose-wrapped JSON is the next most common failure shape.
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_BATCH_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error(CANCELLED);
      try {
        if (attempt === 0) {
          // Structured pass: chatJson validates against the zod schema.
          // Non-streaming → generous total timeout via raceAbort.
          const result = await raceAbort(
            client.chatJson(
              {
                messages: [
                  { role: "system", content: prompt },
                  { role: "user", content: inputJson },
                ],
                maxTokens: maxOutput,
                temperature: 0.1,
                signal,
              },
              BatchTranslationSchema,
            ),
            signal,
            TOTAL_TIMEOUT_BATCH_MS,
          );
          if (result.usage?.promptTokens) {
            calibrateCharsPerToken(inputJson.length, result.usage.promptTokens);
          }
          const out = result.data.translations;
          if (out.length === texts.length) {
            return sanitizeTranslations(out, texts);
          }
          // Count mismatch — non-compliant, retry.
          lastError = new Error(
            `batch count mismatch: ${out.length} of ${texts.length}`,
          );
        } else {
          // Manual pass: same shape contract, no response_format.
          const result = await executeWithIdleTimeout(
            () =>
              client.chat({
                messages: [
                  { role: "system", content: prompt },
                  { role: "user", content: inputJson },
                ],
                maxTokens: maxOutput,
                temperature: 0.1,
                signal,
              }),
            IDLE_TIMEOUT_BATCH_MS,
            signal,
          );
          if (result.usage?.promptTokens) {
            calibrateCharsPerToken(inputJson.length, result.usage.promptTokens);
          }
          const parsed = parseJsonFromMarkdown(result.content);
          const arr = Array.isArray(parsed) ? parsed : parsed?.translations;
          if (Array.isArray(arr) && arr.length === texts.length) {
            const translations = arr.map((x: any) =>
              typeof x === "string" ? x : (x?.translation ?? x?.text ?? ""),
            );
            return sanitizeTranslations(translations, texts);
          }
          // Non-compliant — retry.
          lastError = new Error("batch JSON non-compliant after manual parse");
        }
      } catch (e) {
        if (signal?.aborted || isCancelled(e) || [401,403].includes((e as any)?.status) || /credential|unauthori[sz]ed|forbidden|凭据|密钥|认证/i.test(String((e as any)?.message))) throw e;
        lastError = e;
      }
      if (attempt < MAX_BATCH_RETRIES) {
        // 限流感知的批间间隔：上一轮因 429 失败时按 Retry-After / 指数退避
        // 等待，而不是固定 500ms 连发；Retry-After 超长则放弃批处理重试，
        // 直接落逐段兜底。
        if (isRateLimitError(lastError)) {
          const delayMs = rateLimitDelayMs(
            retryAfterOfError(lastError),
            attempt + 1,
          );
          if (delayMs == null) break;
          await waitForRetry(delayMs, signal);
        } else {
          await waitForRetry(RETRY_BACKOFF_MS, signal);
        }
      }
    }

    // Per-paragraph last resort: the batch contract never came back compliant
    // within the retry budget. Each paragraph ships on its own (original text
    // preserved + flagged on failure), so the chunk still completes.
    const translations: string[] = [];
    const failedIndices: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (signal?.aborted) throw new Error(CANCELLED);
      try {
        const result = await executeWithIdleTimeout(
          () =>
            isAI
              ? client.chat({
                  // The user's template governs the fallback too: the rendered
                  // template IS the request, same as the single-paragraph path.
                  messages: [
                    {
                      role: "user",
                      content: renderPrompt(template, {
                        text: texts[i],
                        sourceLang: sourceDesc,
                        targetLang: targetDesc,
                      }),
                    },
                  ],
                  maxTokens: Math.max(
                    MODEL_OUTPUT_FLOOR_TOKENS,
                    Math.min(texts[i].length * 2, SINGLE_OUTPUT_MAX_TOKENS),
                  ),
                  temperature: 0.1,
                  signal,
                })
              : client.chat({
                  messages: [
                    { role: "system", content: singlePrompt },
                    { role: "user", content: texts[i] },
                  ],
                  maxTokens: Math.max(
                    MODEL_OUTPUT_FLOOR_TOKENS,
                    Math.min(texts[i].length * 2, SINGLE_OUTPUT_MAX_TOKENS),
                  ),
                  temperature: 0.1,
                  signal,
                }),
          IDLE_TIMEOUT_SINGLE_MS,
          signal,
        );
        const content = result.content || "";
        validateProtectedText(texts[i], content);
        translations.push(content || texts[i]);
        if (!content && texts[i].trim()) failedIndices.push(i);
      } catch (e) {
        if (signal?.aborted || isCancelled(e) || [401,403].includes((e as any)?.status) || /credential|unauthori[sz]ed|forbidden|凭据|密钥|认证/i.test(String((e as any)?.message))) throw e;
        translations.push(texts[i]);
        failedIndices.push(i);
      }
    }
    return { translations, failedIndices };
    });
  };

  return { translate, inputBudgetChars, outputBudgetChars };
}

export type { BatchTranslatorHandle, BatchTranslator, BatchTranslateResult };

/**
 * Official wire protocols: Youdao v3 (ai.youdao.com documentation), NiuTrans
 * public text API. Youdao demo adapter adapted from windingwind/zotero-pdf-
 * translate at 2e3d77ddbf3157d8813c61c828957386ab802bdb (AGPL-3.0-or-later).
 */
import { abortSignalTimeout, createAbortController } from "../../utils/abort";
import { redactTranslationError } from "../../utils/credentials";

export function combineSignal(signal?: AbortSignal, timeoutMs = 30000): AbortSignal | undefined {
  const timeout = abortSignalTimeout(timeoutMs) as AbortSignal | undefined;
  const ctor = (globalThis as any).AbortSignal ?? (globalThis as any).Zotero?.getMainWindow?.()?.AbortSignal;
  if (signal && timeout && typeof ctor?.any === "function") return ctor.any([signal, timeout]);
  if (!signal || !timeout) return signal ?? timeout;
  const controller = createAbortController() as AbortController;
  const forward = () => {
    signal.removeEventListener("abort", forward);
    timeout.removeEventListener("abort", forward);
    controller.abort();
  };
  if (signal.aborted || timeout.aborted) forward();
  else {
    signal.addEventListener("abort", forward, { once: true });
    timeout.addEventListener("abort", forward, { once: true });
  }
  return controller.signal;
}
export function cancelled(): Error {
  const error = new Error("翻译已取消"); error.name = "AbortError"; return error;
}
export function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}
export function providerError(status: number | string, provider = "翻译服务"): Error {
  const code = String(status);
  const message = code === "103"
    ? "单次文本超过服务长度限制，请缩短原文或在设置中切换引擎。"
    : ["401", "403", "108", "110", "111", "202", "203", "40001"].includes(code)
    ? "凭据无效或尚未开通服务，请检查接口设置。"
    : ["429", "207", "411", "412", "413", "414", "415", "000010"].includes(code)
      ? "请求过于频繁，请稍后重试或降低并发。"
      : ["402", "206", "13001", "000007", "000008"].includes(code)
        ? "余额或免费额度不足，请前往服务商控制台查看。"
        : `请求失败（代码 ${code.replace(/[^\w-]/g, "").slice(0, 30)}）。`;
  const error = new Error(`${provider}：${message}`) as Error & { status?: number };
  error.status = Number(status) || undefined;
  return error;
}
async function form(url: string, values: Record<string, string>, signal?: AbortSignal): Promise<any> {
  assertNotCancelled(signal);
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(), signal: combineSignal(signal),
  });
  if (!response.ok) throw providerError(response.status);
  return response.json();
}
function youdaoLang(code: string): string {
  if (/^zh-(?:TW|HK|MO|Hant)/i.test(code)) return "zh-CHT";
  if (/^zh/i.test(code)) return "zh-CHS";
  return code.split("-")[0];
}
function resultText(data: any): string {
  if (String(data.errorCode ?? "0") !== "0") throw providerError(data.errorCode, "有道");
  const text = Array.isArray(data.translation) ? data.translation.filter((x: unknown) => typeof x === "string").join("\n") : "";
  if (!text.trim()) throw new Error("有道未返回译文，请稍后重试。");
  return text.trim();
}
export async function translateYoudao(text: string, target: string, source?: string, signal?: AbortSignal): Promise<string> {
  return resultText(await form("https://aidemo.youdao.com/trans", {
    from: youdaoLang(source || "auto"), to: youdaoLang(target), q: text,
  }, signal));
}
export function youdaoSignInput(text: string): string {
  const chars = Array.from(text);
  return chars.length <= 20 ? text : chars.slice(0, 10).join("") + chars.length + chars.slice(-10).join("");
}
export async function sha256(value: string): Promise<string> {
  const crypto = (globalThis as any).crypto ?? (globalThis as any).Zotero?.getMainWindow?.()?.crypto;
  if (!crypto?.subtle) throw new Error("当前环境缺少安全签名能力，请在 Zotero 10 中使用。");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(n => n.toString(16).padStart(2, "0")).join("");
}
export async function translateYoudaoOfficial(
  text: string, target: string, source: string | undefined,
  appKey: string, appSecret: string, signal?: AbortSignal,
): Promise<string> {
  if (!appKey || !appSecret) throw new Error("请先填写有道智云应用 ID 和应用密钥。");
  const salt = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const curtime = String(Math.floor(Date.now() / 1000));
  const sign = await sha256(appKey + youdaoSignInput(text) + salt + curtime + appSecret);
  return resultText(await form("https://openapi.youdao.com/api", {
    q: text, from: youdaoLang(source || "auto"), to: youdaoLang(target),
    appKey, salt, curtime, sign, signType: "v3", strict: "true",
  }, signal));
}
export async function translateNiuTrans(
  text: string, target: string, source: string | undefined, apiKey: string,
  endpoint = "https://api.niutrans.com/NiuTransServer/translation", signal?: AbortSignal,
): Promise<string> {
  if (!apiKey) throw new Error("请先填写小牛翻译 API Key。");
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("小牛接口地址必须使用 HTTPS。");
  const data = await form(url.href, {
    from: (source || "auto").split("-")[0], to: target.split("-")[0], apikey: apiKey, src_text: text,
  }, signal);
  if (data.error_code) throw providerError(data.error_code, "小牛翻译");
  const result = data.tgt_text;
  if (typeof result !== "string" || !result.trim()) throw new Error("小牛翻译未返回译文，请检查接口配置。");
  return result.trim();
}
export function userFacingError(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted || (error as any)?.name === "AbortError") return "翻译已取消";
  const status = (error as any)?.status;
  if (status) return providerError(status).message;
  const value = redactTranslationError(error);
  const credentialStatus = /(?:HTTP|status(?:\s+code)?|代码)[\s:(]*(401|403)\b/i.exec(value);
  if (credentialStatus) return `${providerError(Number(credentialStatus[1])).message}（${value}）`;
  if (/fetch|network|timeout|timed out|NS_ERROR_NET|abort/i.test(value)) {
    return "连接失败或请求超时，请检查网络后重试；也可在设置中测试当前引擎。";
  }
  return value;
}

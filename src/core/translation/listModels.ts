import { normalizeChatCompletionsUrl } from "../ai/openaiCompat";
import { combineSignal, providerError } from "./providerAdapters";
import { getCredential } from "../../utils/credentials";
import { getPrefDynamic } from "../../utils/prefs";
import { getString } from "../../utils/locale";

export function modelsUrl(apiUrl: string): string {
  const url = new URL(normalizeChatCompletionsUrl(apiUrl));
  url.pathname = url.pathname.replace(/\/chat\/completions$/, "/models");
  return url.href;
}
export interface ListModelsOptions { apiUrl?: string; apiKey?: string; engine?: "ai" | "custom"; signal?: AbortSignal; timeoutMs?: number; }
/** Query the currently entered service. Listing never chooses a model. */
export async function listModels(opts: ListModelsOptions = {}): Promise<string[]> {
  const engine = opts.engine ?? (getPrefDynamic("translate.engineType") === "custom" ? "custom" : "ai");
  const endpoint = opts.apiUrl ?? String(getPrefDynamic(`translate.${engine}.apiUrl`) || "");
  const key = opts.apiKey ?? getCredential(`translate.${engine}.apiKey`);
  const response = await fetch(modelsUrl(endpoint), { method: "GET", headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: combineSignal(opts.signal, opts.timeoutMs ?? 15000) });
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) throw new Error(getString("models-unsupported"));
    throw providerError(response.status);
  }
  const data: any = await response.json();
  const models = Array.isArray(data?.data) ? data.data : [];
  const ids = [...new Set<string>(models.map((m: any) => m?.id).filter((id: any) => typeof id === "string" && id.trim()).map((id: string) => id.trim()))].sort();
  if (!ids.length) throw new Error(getString("models-empty"));
  return ids;
}

import { config } from "../../package.json";

/** Only these preferences are credentials. They never live in prefs.js. */
export const CREDENTIAL_KEYS = [
  "translate.google.apiKey", "translate.bing.apiKey", "translate.deepl.apiKey",
  "translate.custom.apiKey", "translate.ai.apiKey", "translate.niutrans.apiKey",
  "translate.youdaoOfficial.appKey", "translate.youdaoOfficial.appSecret",
] as const;
const origin = "https://wenxianyidu.local";
const realm = config.addonID;
const observedSecrets = new Set<string>();
export function isCredentialKey(key: string): boolean {
  return (CREDENTIAL_KEYS as readonly string[]).includes(key);
}
function loginManager(): any {
  const g = globalThis as any;
  const services = g.Services ?? g.Zotero?.getMainWindow?.()?.Services;
  return services?.logins;
}
function bumpRevision(): void {
  (globalThis as any).Zotero?.Prefs?.set?.(`${config.prefsPrefix}.translate.credentialsRevision`,
    `${Date.now()}-${Math.random().toString(36).slice(2)}`, true);
}
function find(key: string): any {
  const manager = loginManager();
  if (!manager?.findLogins) return null;
  return manager.findLogins(origin, null, realm).find((entry: any) => entry.username === key) ?? null;
}
export function getCredential(key: string): string {
  if (!isCredentialKey(key)) throw new Error("未知的凭据字段");
  try {
    const value = String(find(key)?.password ?? "");
    if (value) observedSecrets.add(value);
    return value;
  } catch {
    throw new Error("无法访问系统安全存储，请重启 Zotero 后重试。");
  }
}
export async function setCredential(key: string, value: string): Promise<void> {
  if (!isCredentialKey(key)) throw new Error("未知的凭据字段");
  const manager = loginManager();
  if (!manager) throw new Error("系统安全存储不可用，密钥未保存。请在 Zotero 中配置。");
  const secret = String(value ?? "").trim();
  if (!secret) return clearCredential(key);
  try {
    const g = globalThis as any;
    const info = g.Components?.classes?.["@mozilla.org/login-manager/loginInfo;1"]
      ?.createInstance(g.Components.interfaces.nsILoginInfo);
    if (!info) throw new Error("LoginInfo unavailable");
    info.init(origin, null, realm, key, secret, "", "");
    const previous = find(key);
    if (previous?.password === secret) {
      g.Zotero?.Prefs?.clear?.(`${config.prefsPrefix}.${key}`, true);
      return;
    }
    if (previous) await manager.modifyLogin(previous, info);
    else if (manager.addLoginAsync) await manager.addLoginAsync(info);
    else await manager.addLogin(info);
    observedSecrets.add(secret);
    bumpRevision();
    // Remove legacy plaintext only after the secure write succeeded.
    g.Zotero?.Prefs?.clear?.(`${config.prefsPrefix}.${key}`, true);
  } catch {
    throw new Error("无法保存到系统安全存储，密钥未以明文保存。请检查 Zotero 密码管理器。");
  }
}
export async function clearCredential(key: string): Promise<void> {
  if (!isCredentialKey(key)) throw new Error("未知的凭据字段");
  const manager = loginManager();
  if (!manager) throw new Error("系统安全存储不可用，无法删除凭据。");
  const previous = find(key);
  if (previous) { await manager.removeLogin(previous); bumpRevision(); }
  (globalThis as any).Zotero?.Prefs?.clear?.(`${config.prefsPrefix}.${key}`, true);
}
/** Called once during startup; a failed migration leaves the legacy value untouched. */
export async function migrateCredentials(): Promise<void> {
  const branch = (globalThis as any).Zotero?.Prefs;
  if (!branch || !loginManager()) return;
  for (const key of CREDENTIAL_KEYS) {
    const legacy = branch.get(`${config.prefsPrefix}.${key}`, true);
    if (typeof legacy !== "string" || !legacy) continue;
    await setCredential(key, legacy);
  }
}
/** Provider errors can echo request URLs or headers; do not expose those. */
export function redactTranslationError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error ?? "翻译失败");
  for (const secret of observedSecrets) {
    if (secret.length >= 3) message = message.split(secret).join("[已隐藏]");
  }
  return message
    .replace(/([?&](?:key|apikey|api_key|token|secret|sign)=)[^&\s"']+/gi, "$1[已隐藏]")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[已隐藏]")
    .slice(0, 500);
}

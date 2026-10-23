import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZoteroMock, type ZoteroMock } from "../../../qa/harness/zotero-mock";
import { clearTranslationCache, createTranslator, createAIBatchTranslator, engineCacheIdentity, testEngineConnection } from "../../../../src/core/translation/translationEngines";
import { combineSignal, sha256, translateYoudaoOfficial, translateNiuTrans, youdaoSignInput } from "../../../../src/core/translation/providerAdapters";
import { providerSlot, sharedRequest, splitLongText } from "../../../../src/core/translation/requestCoordinator";
import { translateSegments } from "../../../../src/core/translation/translationService";
import { getCredential, setCredential, clearCredential, migrateCredentials, redactTranslationError } from "../../../../src/utils/credentials";
import { normalizeChatCompletionsUrl } from "../../../../src/core/ai/openaiCompat";
import { sanitizeTranslations } from "../../../../src/core/translation/prompts";
import { setCacheDirForTests } from "../../../../src/core/translation/translationCache";

vi.mock("../../../../src/utils/locale", () => ({ getString: (key: string) => key }));
let z: ZoteroMock;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: {"Content-Type":"application/json"} });
beforeEach(() => {
  z = createZoteroMock();
  z.install();
  // 出厂引擎是免注册必应试用；本文件的历史用例以有道试用的线格式为基准，
  // 因此显式钉住引擎，用例自己需要别的引擎时会覆盖。
  z.prefs.set(`${z.prefix}.translate.engineType`, "youdao");
  setCacheDirForTests(null);
  clearTranslationCache();
});
afterEach(() => { z.uninstall(); vi.unstubAllGlobals(); vi.restoreAllMocks(); setCacheDirForTests(null); });
function pref(key: string, value: string) { z.prefs.set(`${z.prefix}.${key}`, value); }

describe("product engine requests", () => {
  it("uses Youdao without credentials and preserves formulas outside the MT request", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://aidemo.youdao.com/trans");
      const body = new URLSearchParams(String(init.body));
      expect(body.get("from")).toBe("en"); expect(body.get("to")).toBe("zh-CHS");
      expect(init.headers).not.toHaveProperty("Authorization");
      requests.push(body.get("q")!);
      return response({errorCode:"0",translation:["中文"]});
    }));
    const result = await createTranslator("zh-CN","en")("The value {v0} is $x+1$.","zh-CN","en");
    expect(result).toContain("{v0}"); expect(result).toContain("$x+1$");
    expect(requests.join("")).not.toMatch(/\{v0\}|\$x\+1\$/);
  });
  it("signs official Youdao with a full v3 digest and returns the actual result", async () => {
    const text = "An academic paragraph long enough for v3 signing.";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://openapi.youdao.com/api");
      const body = new URLSearchParams(String(init.body));
      expect(body.get("signType")).toBe("v3");
      expect(body.get("sign")).toBe(await sha256("application" + youdaoSignInput(text) + body.get("salt") + body.get("curtime") + "secret"));
      return response({errorCode:"0",translation:["正式接口译文"]});
    }));
    expect(await translateYoudaoOfficial(text,"zh-CN","en","application","secret")).toBe("正式接口译文");
  });
  it("uses the public NiuTrans wire contract and distinguishes exhausted quota", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.niutrans.com/NiuTransServer/translation");
      const body = new URLSearchParams(String(init.body));
      expect(body.get("apikey")).toBe("synthetic-key"); expect(body.get("src_text")).toBe("Research");
      return response({error_code:"000007"});
    }));
    await expect(translateNiuTrans("Research","zh-CN","en","synthetic-key")).rejects.toThrow(/余额|额度/);
  });
  it("never invokes a configured paid endpoint for an unknown engine id", async () => {
    pref("translate.engineType","retired-engine"); pref("translate.custom.apiUrl","https://paid.example/v1");
    z.credentials.set("translate.custom.apiKey","synthetic-key");
    const fetch = vi.fn(); vi.stubGlobal("fetch",fetch);
    await expect(createTranslator("zh-CN")("text","zh-CN")).rejects.toThrow(/重新选择引擎/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("connection tests bypass an existing translation cache", async () => {
    const fetch = vi.fn(async () => response({errorCode:"0",translation:["译文"]})); vi.stubGlobal("fetch",fetch);
    await createTranslator("zh-CN","en")("This study evaluates the accuracy of machine translation.","zh-CN","en");
    expect((await testEngineConnection()).success).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("splits a demo-engine paragraph at the verified 1000-character limit", async () => {
    const chunks: string[] = [];
    const fetch=vi.fn(async (_url:string,init:RequestInit)=>{
      const q=new URLSearchParams(String(init.body)).get("q")!; chunks.push(q);
      expect(Array.from(q).length).toBeLessThanOrEqual(1000);
      return response({errorCode:"0",translation:["译文"]});
    }); vi.stubGlobal("fetch",fetch);
    const source="This study evaluates the accuracy of machine translation. ".repeat(31);
    await createTranslator("zh-CN","en")(source,"zh-CN","en");
    expect(chunks).toHaveLength(2);
  });
  it("keeps paragraph separators and exposes errors without returning originals as success", async () => {
    vi.stubGlobal("fetch",vi.fn(async (_url: string, init: RequestInit) => {
      const input = new URLSearchParams(String(init.body)).get("q");
      return input === "Broken" ? response({errorCode:"411"}) : response({errorCode:"0",translation:["译文"]});
    }));
    const output = await translateSegments({segments:[{id:"one",text:"First\n\nSecond"},{id:"bad",text:"Broken"}],targetLanguage:"zh-CN"});
    expect(output[0]).toEqual({id:"one",text:"译文\n\n译文",status:"success"});
    // 411（有道试用「请求频率过快」）属限流：退避重试一次后终态为限流文案，
    // 不再是逐引擎的原始错误，更不会把原文当成译文返回。
    expect(output[1]).toMatchObject({id:"bad",text:"",status:"error"}); expect(output[1].error).toMatch(/rate-limited/);
  }, 15000);
  it("rejects truncated model output and does not cache it", async () => {
    pref("translate.engineType","ai"); pref("translate.ai.apiUrl","http://localhost:11434/v1");
    const fetch = vi.fn(async () => response({choices:[{finish_reason:"length",message:{content:"partial"}}]})); vi.stubGlobal("fetch",fetch);
    const translator = createTranslator("zh-CN");
    await expect(translator("Research","zh-CN")).rejects.toThrow(/截断/);
    await expect(translator("Research","zh-CN")).rejects.toThrow(/截断/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("request lifecycle", () => {
  it("keeps a shared request alive for the other reader when one caller cancels", async () => {
    const first = new AbortController(), second = new AbortController(); let transport!: AbortSignal; let finish!: (value:string)=>void;
    const work = vi.fn((signal:AbortSignal) => { transport=signal; return new Promise<string>(resolve => {finish=resolve;}); });
    const a=sharedRequest("shared-consumers",work,first.signal); const rejected=expect(a).rejects.toMatchObject({name:"AbortError"});
    const b=sharedRequest("shared-consumers",work,second.signal);
    await Promise.resolve(); first.abort(); await rejected; expect(transport.aborted).toBe(false);
    finish("译文"); expect(await b).toBe("译文"); expect(work).toHaveBeenCalledTimes(1);
  });
  it("aborts the underlying transport once all consumers cancel", async () => {
    const first = new AbortController(); let transport!: AbortSignal;
    const job=sharedRequest("all-cancel",signal=>{transport=signal; return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("transport stopped"))));},first.signal);
    const rejected=expect(job).rejects.toMatchObject({name:"AbortError"}); await Promise.resolve(); first.abort(); await rejected;
    expect(transport.aborted).toBe(true);
    expect(await sharedRequest("all-cancel",async()=>"new request")).toBe("new request");
  });
  it("cancellation reaches fetch and a subsequent retry can start normally", async () => {
    const controller=new AbortController(); let transport!: AbortSignal;
    const fetch=vi.fn((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>{
      transport=init.signal as AbortSignal;
      transport.addEventListener("abort",()=>reject(Object.assign(new Error("aborted"),{name:"AbortError"})),{once:true});
    })); vi.stubGlobal("fetch",fetch);
    const task=createTranslator("zh-CN",undefined,controller.signal)("Cancellable paragraph","zh-CN");
    const rejected=expect(task).rejects.toMatchObject({name:"AbortError"}); await vi.waitFor(()=>expect(fetch).toHaveBeenCalled());
    controller.abort(); await rejected; expect(transport.aborted).toBe(true);
    fetch.mockImplementation(async()=>response({errorCode:"0",translation:["重试成功"]}) as any);
    expect(await createTranslator("zh-CN")("Cancellable paragraph","zh-CN")).toBe("重试成功");
  });
  it("combines timeout and user cancellation on hosts without AbortSignal.any", () => {
    const deadline=new AbortController(), user=new AbortController();
    vi.stubGlobal("AbortSignal",{timeout:()=>deadline.signal});
    const signal=combineSignal(user.signal,10)!; expect(signal.aborted).toBe(false); deadline.abort(); expect(signal.aborted).toBe(true);
  });
  it("releases a provider slot immediately when a rate-limit wait is cancelled", async () => {
    pref("translate.engineType","deepl"); z.credentials.set("translate.deepl.apiKey","synthetic-deepl-key");
    const fetch=vi.fn()
      .mockResolvedValueOnce(new Response("rate limited",{status:429,headers:{"Retry-After":"60"}}))
      .mockResolvedValueOnce(response({translations:[{text:"新请求成功"}]}));
    vi.stubGlobal("fetch",fetch);
    const controller=new AbortController();
    const task=createTranslator("zh-CN","en",controller.signal)("Retryable text","zh-CN","en");
    const rejected=expect(task).rejects.toMatchObject({name:"AbortError"});
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1)); controller.abort(); await rejected;
    expect(await createTranslator("zh-CN","en")("A new paragraph","zh-CN","en")).toBe("新请求成功");
    expect(fetch).toHaveBeenCalledTimes(2);
  }, 1500);
  it("preserves every Unicode code point while chunking and rejects zero-length limits", () => {
    const source="First sentence. Second sentence 🧬🧪 {v123} end.";
    const chunks=splitLongText(source,18); expect(chunks.join("")).toBe(source);
    expect(chunks.every(value=>Array.from(value).length<=18)).toBe(true);
    expect(chunks.some(value=>/\{v\d*$/.test(value))).toBe(false);
    expect(()=>splitLongText(source,0)).toThrow();
  });
});

describe("credentials and model configuration", () => {
  it("stores and removes credentials outside plaintext prefs, migrates legacy values, and redacts errors", async () => {
    const key="translate.ai.apiKey"; pref(key,"legacy-secret-for-test");
    await migrateCredentials(); expect(getCredential(key)).toBe("legacy-secret-for-test"); expect(z.prefs.has(`${z.prefix}.${key}`)).toBe(false);
    await setCredential(key,"new-secret-for-test"); expect(getCredential(key)).toBe("new-secret-for-test");
    expect(redactTranslationError(new Error("request new-secret-for-test Authorization: Bearer new-secret-for-test"))).not.toContain("new-secret-for-test");
    const identity=engineCacheIdentity(); expect(identity).not.toContain("secret-for-test");
    await clearCredential(key); expect(getCredential(key)).toBe("");
  });
  it("fails closed when the password manager is unavailable", async () => {
    vi.stubGlobal("Services",{});
    await expect(setCredential("translate.ai.apiKey","secret")).rejects.toThrow(/安全存储/);
    expect(z.prefs.has(`${z.prefix}.translate.ai.apiKey`)).toBe(false);
  });
  it("normalizes endpoint path without losing benign query parameters and rejects keys in URLs", () => {
    expect(normalizeChatCompletionsUrl("https://example.org/route/v1/?api-version=2026#ignored")).toBe("https://example.org/route/v1/chat/completions?api-version=2026");
    expect(normalizeChatCompletionsUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(()=>normalizeChatCompletionsUrl("https://example.org/?api_key=hidden")).toThrow(/API Key/);
    expect(()=>normalizeChatCompletionsUrl("http://remote.example/v1")).toThrow(/HTTPS/);
  });
  it("flags whitespace-only and formula-corrupted batch results", () => {
    expect(sanitizeTranslations(["  ","译文 {v1}","译文 {v2}"],["Original","Original {v0}","Original {v2}"])).toEqual({translations:["Original","Original {v0}","译文 {v2}"],failedIndices:[0,1]});
  });
  it("rejects invalid AI prompt before a batch network request", async () => {
    pref("translate.engineType","ai"); pref("translate.ai.apiUrl","https://example.org/v1"); pref("translate.ai.prompt","missing text variable");
    const fetch=vi.fn(); vi.stubGlobal("fetch",fetch); await expect(createAIBatchTranslator("zh-CN")).rejects.toThrow(/模板无效/); expect(fetch).not.toHaveBeenCalled();
  });
});

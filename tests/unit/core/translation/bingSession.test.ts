import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../../src/utils/prefs", () => ({ getPrefDynamic: (key: string) => key === "translate.engineType" ? "bing-web" : key === "translate.cache.enabled" ? false : undefined }));
vi.mock("../../../../src/core/translation/translationCache", () => ({ cacheAvailable: () => false }));
vi.mock("../../../../src/utils/locale", () => ({ getString: (key: string) => key }));
afterEach(() => vi.unstubAllGlobals());
describe("Bing cold session sharing", () => {
  it("four concurrent paragraphs share one token fetch and one cancellation leaves other consumers running", async () => {
    let finishToken: (value: any) => void = () => {};
    const fetch = vi.fn(async (url: string) => {
      if (url === "https://www.bing.com/translator") return new Promise(resolve => { finishToken = resolve; });
      return { ok: true, json: async () => [{ translations: [{ text: "译文" }] }] };
    });
    vi.stubGlobal("fetch", fetch);
    const { createTranslator } = await import("../../../../src/core/translation/translationEngines");
    const controller = new AbortController();
    const first = createTranslator("zh-CN", "en", controller.signal)("sentence A", "zh-CN").catch(e => e);
    const others = ["B", "C", "D"].map(id => createTranslator("zh-CN", "en")("sentence " + id, "zh-CN"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    finishToken({ ok: true, url: "https://www.bing.com/translator", text: async () => 'IG:"ABCDEF0123456789"; params_AbusePreventionHelper = [123, "token", 3600000]; id="rich_tta" data-iid="translator.5023"' });
    expect(await first).toMatchObject({ name: "AbortError" });
    expect(await Promise.all(others)).toEqual(["译文", "译文", "译文"]);
    expect(fetch.mock.calls.filter(([url]) => url === "https://www.bing.com/translator")).toHaveLength(1);
  });
});

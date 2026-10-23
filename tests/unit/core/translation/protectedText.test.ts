import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { protectedTextUnchanged, splitProtectedText } from "../../../../src/core/translation/protectedText";
import { clearTranslationCache, createTranslator } from "../../../../src/core/translation/translationEngines";
import { sanitizeTranslations } from "../../../../src/core/translation/prompts";
import { setCacheDirForTests } from "../../../../src/core/translation/translationCache";
import { createZoteroMock, type ZoteroMock } from "../../../qa/harness/zotero-mock";

vi.mock("../../../../src/utils/locale", () => ({ getString: (key: string) => key }));
let zotero: ZoteroMock;
beforeEach(() => {
  zotero = createZoteroMock();
  zotero.install();
  // 这些用例校验的是「免注册试用引擎不接收公式」，线格式以有道试用的
  // form 请求为基准；出厂引擎是必应试用，故此处显式钉住有道。
  zotero.prefs.set(`${zotero.prefix}.translate.engineType`, "youdao");
  setCacheDirForTests(null);
  clearTranslationCache();
});
afterEach(() => { zotero.uninstall(); vi.unstubAllGlobals(); setCacheDirForTests(null); });

describe("explicit mathematical text protection", () => {
  it("identifies every supported delimiter and preserves the exact input", () => {
    const source = String.raw`With {v12}, $x_1$, $$y = \frac{1}{2}$$, \(z^2 + \alpha\), and \[\sum_i x_i = 1\].`;
    const parts = splitProtectedText(source);
    expect(parts.map(part => part.text).join("")).toBe(source);
    expect(parts.filter(part => part.protected).map(part => part.text)).toEqual([
      "{v12}", "$x_1$", String.raw`$$y = \frac{1}{2}$$`,
      String.raw`\(z^2 + \alpha\)`, String.raw`\[\sum_i x_i = 1\]`,
    ]);
  });

  it("keeps multiline display math but does not protect escaped currency or guess variables", () => {
    const display = [String.raw`\[x = 1`, String.raw`+ 2\]`].join(String.fromCharCode(10));
    const source = String.raw`The cost is \$5 or \$10; x denotes cost. ` + display;
    const parts = splitProtectedText(source);
    expect(parts.filter(part => part.protected).map(part => part.text)).toEqual([display]);
    expect(parts[0]).toMatchObject({ protected: false });
    expect(splitProtectedText("The cost is $5 or $10.").every(part => !part.protected)).toBe(true);
    expect(splitProtectedText(String.raw`Literal \\(x\\) and an unmatched $$x`).every(part => !part.protected)).toBe(true);
  });

  it("allows translated ordering but detects loss, changes, duplication and invented math", () => {
    expect(protectedTextUnchanged("With $x$ and {v0}", "{v0} 与 $x$")).toBe(true);
    expect(protectedTextUnchanged("With $x$ and $x$", "只有 $x$")).toBe(false);
    expect(protectedTextUnchanged(String.raw`With \(x_1\)`, String.raw`带 \(x_2\)`)).toBe(false);
    expect(protectedTextUnchanged("No equation", "公式 $x$")).toBe(false);
  });

  it("never sends supported math to the default free engine", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(new URLSearchParams(String(init.body)).get("q")!);
      return new Response(JSON.stringify({ errorCode: "0", translation: ["译文"] }));
    }));
    const source = String.raw`With \(x_1\), \[y^2\], $z$ and {v0}.`;
    const result = await createTranslator("zh-CN", "en")(source, "zh-CN", "en");
    expect(protectedTextUnchanged(source, result)).toBe(true);
    // One full-sentence attempt, then five safe fragments if all markers vanish.
    expect(requests).toHaveLength(6);
    expect(requests.join("")).not.toMatch(/x_1|y\^2|\$z\$|\{v0\}/);
  });

  it("keeps the entire sentence in one request when the provider preserves placeholders", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const text = new URLSearchParams(String(init.body)).get("q")!; requests.push(text);
      return new Response(JSON.stringify({ errorCode: "0", translation: [text.replace("The gradient", "梯度")] }));
    }));
    const source = "The gradient {v1} and the Hessian {v2} were computed separately.";
    const translated = await createTranslator("zh-CN", "en")(source, "zh-CN");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("and the Hessian");
    expect(protectedTextUnchanged(source, translated)).toBe(true);
  });

  it("passes pure formulas through without any network call", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const source = String.raw`\[\frac{a}{b}\]`;
    expect(await createTranslator("zh-CN")(source, "zh-CN")).toBe(source);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an AI formula edit on every retry instead of caching it", async () => {
    zotero.prefs.set(`${zotero.prefix}.translate.engineType`, "ai");
    zotero.prefs.set(`${zotero.prefix}.translate.ai.apiUrl`, "http://localhost:11434/v1");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: String.raw`这里 \(x_2\)` } }] })));
    vi.stubGlobal("fetch", fetch);
    const translate = createTranslator("zh-CN");
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(translate(String.raw`Here \(x_1\)`, "zh-CN")).rejects.toThrow(/公式/);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("flags corrupt batch math and preserves valid or currency-only results", () => {
    const originals = [String.raw`With \(x\)`, String.raw`With \[y\]`, String.raw`Cost \$5`];
    expect(sanitizeTranslations(["丢失", String.raw`有 \[y\]`, String.raw`费用 \$5`], originals)).toEqual({
      translations: [originals[0], String.raw`有 \[y\]`, String.raw`费用 \$5`], failedIndices: [0],
    });
  });
});

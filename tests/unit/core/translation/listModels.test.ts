import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, modelsUrl } from "../../../../src/core/translation/listModels";
vi.mock("../../../../src/utils/locale", () => ({ getString: (key: string) => key }));
afterEach(() => vi.unstubAllGlobals());
describe("same-service model discovery", () => {
  it.each([
    ["https://api.deepseek.com/chat/completions", "https://api.deepseek.com/models"],
    ["http://127.0.0.1:11434/v1", "http://127.0.0.1:11434/v1/models"],
    ["https://gateway.example/prefix/v1/chat/completions", "https://gateway.example/prefix/v1/models"],
    ["https://gateway.example/prefix", "https://gateway.example/prefix/v1/models"],
  ])("preserves endpoint prefix %s", (url, expected) => expect(modelsUrl(url)).toBe(expected));
  it("accepts local keyless lists without changing any model preference", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: "b" }, { id: "a" }, { id: "a" }, {}] }) }));
    vi.stubGlobal("fetch", fetch);
    expect(await listModels({ apiUrl: "http://localhost:11434/v1", apiKey: "" })).toEqual(["a", "b"]);
    expect(fetch.mock.calls[0][1].headers).toEqual({});
  });
  it.each([401, 404, 500])("reports HTTP %i and keeps manual input possible", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status })));
    await expect(listModels({ apiUrl: "https://example.org/v1", apiKey: "current-key" })).rejects.toThrow();
  });
  it("reports an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })));
    await expect(listModels({ apiUrl: "https://example.org/v1", apiKey: "" })).rejects.toThrow("models-empty");
  });
  it("uses the currently entered credential", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: "model" }] }) })); vi.stubGlobal("fetch", fetch);
    await listModels({ apiUrl: "https://example.org/custom/chat/completions", apiKey: "draft-key" });
    expect(fetch.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer draft-key" });
  });
  it("aborts a stalled list request within its timeout", async () => {
    vi.stubGlobal("fetch", (_url: string, opts: RequestInit) => new Promise((_resolve, reject) => opts.signal!.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")))));
    await expect(listModels({ apiUrl: "http://localhost:11434/v1", apiKey: "", timeoutMs: 5 })).rejects.toMatchObject({ name: "AbortError" });
  });
});

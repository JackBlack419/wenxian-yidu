import { describe, it, expect, vi } from "vitest";
import { translateDocumentSegments } from "../../../../src/core/pdf/translation/documentSegments";
import type { DocumentSegment } from "../../../../src/core/pdf/translation/documentJobs";
vi.mock("../../../../src/core/translation/translationCache", () => ({ cacheAvailable: () => false }));

const pages = [Array.from({ length: 20 }, (_, i) => `Research paragraph ${i}`)];
describe("durable failed-segment recovery without general cache", () => {
  it("automatically retries exactly five failed paragraphs once, then supports manual recovery after reload", async () => {
    const calls: string[] = [];
    let disk = "";
    const translate = vi.fn(async (text: string) => {
      calls.push(text); if (Number(text.split(" ").at(-1)) < 5) throw new Error("network unavailable"); return `译：${text}`;
    });
    const first = await translateDocumentSegments({ pages, target: "zh-CN", translate, concurrency: 4,
      checkpoint: async segments => { disk = JSON.stringify(segments); } });
    expect(first.failedCount).toBe(5); expect(calls).toHaveLength(25);
    for (let i = 0; i < 20; i++) expect(calls.filter(t => t === pages[0][i])).toHaveLength(i < 5 ? 2 : 1);
    const manual = vi.fn(async text => `补：${text}`);
    const resumed = await translateDocumentSegments({ pages, previous: JSON.parse(disk), target: "zh-CN", translate: manual, concurrency: 2, checkpoint: async () => {} });
    expect(manual).toHaveBeenCalledTimes(5); expect(resumed.failedCount).toBe(0);
    expect(resumed.translatedSets[0][19]).toBe("译：Research paragraph 19");
  });
  it("retries a transient set once and does not resubmit successes", async () => {
    const seen = new Set<string>(), retryStages: boolean[] = [];
    const translate = vi.fn(async text => { if (!seen.has(text) && /[0-4]$/.test(text)) { seen.add(text); throw Error("temporary"); } return "译：" + text; });
    const result = await translateDocumentSegments({ pages: [pages[0].slice(0, 10)], target: "zh-CN", translate, concurrency: 1, checkpoint: async (_s, retry) => { retryStages.push(retry); } });
    expect(result.failedCount).toBe(0); expect(translate).toHaveBeenCalledTimes(15); expect(retryStages).toEqual([false, true]);
  });
  it("cancellation flushes completed siblings and does not enter the retry round", async () => {
    const controller = new AbortController(); let disk: DocumentSegment[] = [];
    const translate = vi.fn(async text => { if (text.endsWith("2")) controller.abort(); return "译：" + text; });
    await expect(translateDocumentSegments({ pages, target: "zh-CN", signal: controller.signal, translate, concurrency: 1, checkpoint: async s => { disk = s; } })).rejects.toMatchObject({ name: "AbortError" });
    expect(translate).toHaveBeenCalledTimes(3); expect(disk.filter(s => s.status === "success")).toHaveLength(2);
  });
  it("credential failure stops dispatch and never receives an automatic retry", async () => {
    const translate = vi.fn(async () => { throw Object.assign(new Error("Unauthorized"), { status: 401 }); });
    await expect(translateDocumentSegments({ pages, target: "zh-CN", translate, concurrency: 1, checkpoint: async () => {} })).rejects.toMatchObject({ status: 401 });
    expect(translate).toHaveBeenCalledTimes(1);
  });
  it("changed parser output cannot reuse a successful segment at the same position", async () => {
    const previous: DocumentSegment[] = [{ position: "0:0", source: "old", translated: "旧译", status: "success" }];
    const translate = vi.fn(async () => "新译");
    const result = await translateDocumentSegments({ pages: [["new"]], previous, target: "zh-CN", translate, concurrency: 1, checkpoint: async () => {} });
    expect(translate).toHaveBeenCalledTimes(1); expect(result.translatedSets).toEqual([["新译"]]);
  });
});

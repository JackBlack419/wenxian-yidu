// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildInterleave } from "../../../../src/core/pdf/sdt/interleaveView";
import { translateDocumentSegments } from "../../../../src/core/pdf/translation/documentSegments";
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("../../../../src/core/translation/translationCache", () => ({
  cacheAvailable: () => true,
  cacheKey: async (identity: string, source: string, target: string, text: string) => JSON.stringify([identity, source, target, text]),
  getCachedTranslations: async (keys: string[]) => new Map(keys.filter(k => disk.has(k)).map(k => [k, disk.get(k)!])),
  putCachedTranslation: async (identity: string, source: string, target: string, text: string, result: string) => { disk.set(JSON.stringify([identity, source, target, text]), result); },
}));
const handles: Array<{ dispose(): Promise<void> }> = [];
beforeEach(() => { disk.clear(); document.body.innerHTML = ""; });
afterEach(async () => { for (const h of handles.splice(0)) await h.dispose(); });
function documentRun(text: string, translate: any, identity = "provider-A") {
  return translateDocumentSegments({ pages: [[text]], target: "zh-CN", concurrency: 1, cacheIdentity: identity, translate, checkpoint: async () => {} });
}
async function viewRun(text: string, translate: any, identity = "provider-A") {
  const container = document.createElement("article"), p = document.createElement("p");
  p.dataset.refPath = "0"; p.textContent = text; container.appendChild(p); document.body.appendChild(container);
  const back = vi.fn(async () => {});
  const handle = await buildInterleave({ doc: document, container, blocks: [{ el: p, text, refPath: "0" }], exit: async () => {} } as any,
    { targetLanguage: "zh-CN", cacheIdentity: identity, batchTranslate: translate, onReturn: back });
  handles.push(handle); handle.translateAll();
  await vi.waitFor(() => expect(handle.stats().done).toBe(1));
  return { handle, container, back };
}
describe("shared text cache across document and contrast views", () => {
  it("reuses a document paragraph in contrast view without another provider request", async () => {
    await documentRun("The error decreased by 5%.", vi.fn(async () => "误差降低5%。"));
    const translate = vi.fn();
    const { handle, container, back } = await viewRun("The error decreased by 5%.", translate);
    expect(translate).not.toHaveBeenCalled(); expect(handle.translationOf("0")).toBe("误差降低5%。");
    (container.querySelector(".wenxianyidu-bi-controls button") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(back).toHaveBeenCalledOnce());
  });
  it("reuses contrast text for document output and isolates a different engine", async () => {
    await viewRun("No increase was observed.", vi.fn(async texts => ({ translations: texts.map(() => "未观察到增加。"), failedIndices: [] })));
    const translate = vi.fn(async () => "another result");
    const reused = await documentRun("No increase was observed.", translate);
    expect(translate).not.toHaveBeenCalled(); expect(reused.translatedSets).toEqual([["未观察到增加。"]]);
    await documentRun("No increase was observed.", translate, "provider-B");
    expect(translate).toHaveBeenCalledOnce();
  });
});

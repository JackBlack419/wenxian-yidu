import { afterEach, describe, expect, it, vi } from "vitest";
import { returnFromSplitView } from "../../../../src/core/pdf/splitview/splitViewFactory";
import { stateMap } from "../../../../src/core/pdf/splitview/splitViewSync";
afterEach(() => { stateMap.clear(); vi.unstubAllGlobals(); });
function makeState() {
  const left = { item: { id: 55 }, getPreciseState: () => ({ pageIndex: 4, scale: 1.2, top: 30, left: 2 }), destroy: vi.fn() };
  const right = { destroy: vi.fn() };
  const close = vi.fn();
  stateMap.set("split", { leftAdapter: left, rightAdapter: right, win: { Zotero_Tabs: { close } }, eventListeners: [], timeoutIds: [] } as any);
  return { left, right, close };
}
describe("return from a translated split", () => {
  it("opens or reuses the source PDF at the current page before closing the split", async () => {
    const { left, right, close } = makeState();
    const apply = vi.fn(), open = vi.fn(async () => ({ _internalReader: { _primaryView: { _setState: apply } } }));
    vi.stubGlobal("Zotero", { Reader: { open } });
    await returnFromSplitView("split");
    expect(open).toHaveBeenCalledWith(55, { pageIndex: 4, top: 30, left: 2 });
    expect(apply).toHaveBeenCalledWith({ pageNumber: 5, scale: 1.2, top: 30, left: 2 });
    expect(close).toHaveBeenCalledWith("split");
    expect(left.destroy).toHaveBeenCalledOnce(); expect(right.destroy).toHaveBeenCalledOnce();
    expect(stateMap.size).toBe(0);
  });
  it("keeps the split open if the source reader cannot be opened", async () => {
    const { close } = makeState();
    vi.stubGlobal("Zotero", { Reader: { open: vi.fn(async () => { throw Error("source unavailable"); }) } });
    await expect(returnFromSplitView("split")).rejects.toThrow("source unavailable");
    expect(close).not.toHaveBeenCalled(); expect(stateMap.has("split")).toBe(true);
  });
});

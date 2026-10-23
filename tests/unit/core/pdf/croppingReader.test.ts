import { describe, it, expect, vi } from "vitest";
import { acquireCroppingReader } from "../../../../src/core/pdf/translation/croppingReader";
describe("cropping reader ownership", () => {
  it("preserves the already open source even when Reader.open would return it", async () => {
    const reader = { itemID: 5 }, open = vi.fn(async () => reader);
    expect(await acquireCroppingReader({ _readers: [reader], open }, 5)).toEqual({ reader, openedNew: false });
    expect(open).not.toHaveBeenCalled();
  });
  it("owns only a newly opened reader", async () => {
    const reader = { _itemID: 5 };
    expect(await acquireCroppingReader({ _readers: [], open: async () => reader }, 5)).toEqual({ reader, openedNew: true });
  });
  it("does not claim ownership when open resolves undefined and a reader becomes available", async () => {
    const manager = { _readers: [] as any[], open: async () => { manager._readers.push({ _itemID: 5 }); } };
    expect((await acquireCroppingReader(manager, 5))?.openedNew).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { getOfflinePreparationStatus, updateOfflinePreparationStatus, subscribeOfflinePreparationStatus } from "../../../../src/core/translation/offlinePreparationStatus";
import { getOfflineStatus } from "../../../../src/core/translation/offlineManager";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); updateOfflinePreparationStatus("missing"); });
describe("offline progress state", () => {
  it("replays snapshots, isolates listener failures and stops detached listeners", () => {
    updateOfflinePreparationStatus("models", 32); const seen = vi.fn();
    const remove = subscribeOfflinePreparationStatus(seen); expect(seen.mock.calls[0][0].percent).toBe(32);
    let calls = 0;
    const bad = subscribeOfflinePreparationStatus(() => { if (++calls > 1) throw Error("detached view"); });
    updateOfflinePreparationStatus("models", 33); expect(seen).toHaveBeenCalledTimes(2);
    const snapshot = getOfflinePreparationStatus(); snapshot.phase = "ready";
    expect(getOfflinePreparationStatus().phase).toBe("models"); remove(); bad();
    updateOfflinePreparationStatus("trial"); expect(seen).toHaveBeenCalledTimes(2);
  });
  it("clears stale percent/error on a new stage and deduplicates identical readiness", () => {
    vi.useFakeTimers(); updateOfflinePreparationStatus("failed", 500, "network"); expect(getOfflinePreparationStatus().percent).toBe(100);
    updateOfflinePreparationStatus("downloading", -2); expect(getOfflinePreparationStatus()).toMatchObject({ percent: 0, active: true, error: undefined });
    updateOfflinePreparationStatus("trial"); expect(getOfflinePreparationStatus().percent).toBeUndefined();
    updateOfflinePreparationStatus("ready"); const initial = getOfflinePreparationStatus(); vi.advanceTimersByTime(5000); updateOfflinePreparationStatus("ready");
    expect(getOfflinePreparationStatus().updatedAt).toBe(initial.updatedAt);
  });
  it("a readiness marker cannot report success during trial, cancellation or failure", async () => {
    vi.stubGlobal("Zotero", { DataDirectory: { dir: "E:/qa" } }); vi.stubGlobal("PathUtils", { join: (...parts: string[]) => parts.join("/") }); vi.stubGlobal("IOUtils", { exists: async () => true });
    for (const phase of ["trial", "cancelling", "cancelled", "failed"]) { updateOfflinePreparationStatus(phase); expect((await getOfflineStatus()).ready).toBe(false); }
    updateOfflinePreparationStatus("ready"); expect((await getOfflineStatus()).ready).toBe(true);
  });
});

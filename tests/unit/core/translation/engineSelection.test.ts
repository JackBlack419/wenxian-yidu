import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { ensureEngineSelected, ensureEngineAvailable } from "../../../../src/core/translation/engineSelection";
const state = vi.hoisted(() => ({ confirmed: false, explicit: false, engine: "bing-web", offline: false }));
vi.mock("../../../../src/utils/prefs", () => ({ getPref: (key: string) => key.endsWith("engineConfirmed") ? state.confirmed : state.engine, setPref: (_k: string, value: boolean) => { state.confirmed = value; } }));
vi.mock("../../../../src/core/translation/offlineManager", () => ({ getOfflineStatus: async () => ({ ready: state.offline }) }));
const alert = vi.fn(), open = vi.fn();
beforeEach(() => {
  Object.assign(state, { confirmed: false, explicit: false, engine: "bing-web", offline: false });
  alert.mockClear(); open.mockClear();
  vi.stubGlobal("Services", { prefs: { prefHasUserValue: () => state.explicit }, prompt: { alert } });
  vi.stubGlobal("Zotero", { Utilities: { Internal: { openPreferences: open } } });
});
afterEach(() => vi.unstubAllGlobals());
describe("engine selection before translation", () => {
  it("opens settings and stops on first use, without confirming a default", () => {
    expect(ensureEngineSelected()).toBe(false); expect(alert).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledWith("zotero-prefpane-wenxianyidu"); expect(state.confirmed).toBe(false);
  });
  it("keeps a previously selected provider on upgrade", () => {
    state.explicit = true; expect(ensureEngineSelected()).toBe(true); expect(state.confirmed).toBe(true); expect(open).not.toHaveBeenCalled();
  });
  it("does not start downloads when offline assets are missing", async () => {
    state.confirmed = true; state.engine = "mtranserver";
    expect(await ensureEngineAvailable()).toBe(false); expect(open).toHaveBeenCalledOnce();
    state.offline = true; expect(await ensureEngineAvailable()).toBe(true);
  });
});

// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { openTranslationPanel, closeAllTranslationPanels } from "../../../src/ui/translationPanel";
const mocks = vi.hoisted(() => ({ mount: vi.fn(), reader: null as any }));
vi.mock("../../../src/ui/translationWorkspace", () => ({ mountTranslationWorkspace: mocks.mount }));
vi.mock("../../../src/ui/translatePane", () => ({ resolveCurrentReader: () => mocks.reader }));
vi.mock("../../../src/utils/locale", () => ({ getString: (key: string) => key }));
vi.mock("../../../src/utils/prefs", () => ({ getPref: () => 380, setPref: vi.fn() }));
beforeEach(() => {
  document.body.innerHTML = '<div id="appcontent" style="display:flex;flex-direction:column"><div id="zotero-pane-stack"><div id="library-sentinel"></div></div></div>';
  mocks.reader = null;
  mocks.mount.mockReset().mockImplementation((opts: any) => { let mode = opts.initialMode; return { showMode: vi.fn(next => { mode = next; }), getMode: () => mode, destroy: vi.fn() }; });
});
afterEach(() => { closeAllTranslationPanels(); vi.unstubAllGlobals(); });
describe("window translation sidebar", () => {
  it("opens input in the library, reuses one panel, and switches modes directly", () => {
    openTranslationPanel("input", undefined, window);
    openTranslationPanel("selection", undefined, window);
    expect(document.querySelectorAll("#wenxianyidu-translation-panel")).toHaveLength(1);
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    expect(mocks.mount.mock.results[0].value.showMode).toHaveBeenCalledWith("selection");
    expect(document.querySelector("#wenxianyidu-input-translation")).toBeNull();
  });
  it("never reparents the live Zotero tab tree, and closing restores layout", () => {
    const parent = document.getElementById("appcontent")!, anchor = document.getElementById("zotero-pane-stack")!, sentinel = document.getElementById("library-sentinel");
    const original = parent.getAttribute("style");
    openTranslationPanel("input", undefined, window);
    expect(anchor.parentElement).toBe(parent); expect(parent.style.flexDirection).toBe("row");
    (document.querySelector('#wenxianyidu-translation-panel button[aria-label="panel-close"]') as HTMLButtonElement).click();
    expect(parent.getAttribute("style")).toBe(original);
    expect(document.getElementById("library-sentinel")).toBe(sentinel);
    expect(anchor.parentElement).toBe(parent);
    expect(document.querySelector('[role="separator"]')).toBeNull();
    expect(mocks.mount.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
  });
  it("destroys the old reader binding before opening another document", () => {
    openTranslationPanel("selection", { itemID: 1 }, window);
    openTranslationPanel("selection", { itemID: 2 }, window);
    expect(mocks.mount.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.mount.mock.calls[1][0].itemID).toBe(2);
  });
});

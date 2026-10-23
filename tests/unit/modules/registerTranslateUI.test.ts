import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerTranslateUI, unregisterTranslateUI } from "../../../src/modules/registerTranslateUI";
import { createZoteroMock } from "../../qa/harness/zotero-mock";
let z: ReturnType<typeof createZoteroMock>;
beforeEach(() => { z = createZoteroMock(); z.install(); });
afterEach(() => { unregisterTranslateUI(); z.uninstall(); });
describe("window panel replaces the duplicate item-pane section", () => {
  it("never registers a translation section in Zotero's note pane", async () => {
    z.prefs.load({ "translate.enabled": true }, "extensions.zotero.wenxianyidu");
    expect(await registerTranslateUI()).toBe(true);
    expect(await registerTranslateUI()).toBe(true);
    expect(z.registeredPanes).toHaveLength(0);
  });
  it("respects the disabled feature", async () => {
    z.prefs.load({ "translate.enabled": false }, "extensions.zotero.wenxianyidu");
    expect(await registerTranslateUI()).toBe(false);
  });
  it("does not depend on ItemPaneManager being available", async () => {
    z.prefs.load({ "translate.enabled": true }, "extensions.zotero.wenxianyidu");
    (globalThis as any).Zotero = { ...z.Zotero, ItemPaneManager: undefined };
    expect(await registerTranslateUI()).toBe(true);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerItemTreeMenu, unregisterItemTreeMenu } from "../../../src/modules/registerItemTreeMenu";

vi.mock("../../../src/utils/locale", () => ({ getString: (key: string) => key }));
vi.mock("../../../src/core/pdf/translation/opendataloaderSplitAdapter", () => ({ translateAndSplitWithOpenDataLoader: vi.fn() }));
vi.mock("../../../src/core/pdf/splitview/splitViewFactory", () => ({ friendlyOdlError: vi.fn(), isJavaMissingCause: vi.fn(), handleMissingJava: vi.fn() }));
vi.mock("../../../src/core/pdf/splitview/splitViewCleanup", () => ({ findExistingTranslation: vi.fn(), findTranslationByRelation: vi.fn(), findSplitTabForItem: vi.fn() }));
vi.mock("../../../src/core/pdf/sdt/bilingualLauncher", () => ({ getActiveBilingualModeForItem: vi.fn(), startBilingualSessionByItemID: vi.fn() }));

// Exact positional contract in Zotero 10.0.6 buildItemContextMenu. Native
// labels/visibility are written through childNodes[index], not element IDs.
const nativeOptions = ["showInLibrary", "sep1", "addNote", "createNoteFromAnnotations", "addAttachments", "sep2", "findFile", "sep3", "toggleRead", "changeParentItem", "addToCollection", "removeItems", "duplicateAndConvert", "duplicateItem", "restoreToLibrary", "moveToTrash", "deleteFromLibrary", "mergeItems", "relateItems", "sep4", "exportItems", "createBib", "loadReport", "sep5", "recognizePDF", "unrecognize", "createParent", "reindexItem"];
let popup: HTMLElement, nativeNodes: HTMLElement[], trashed: number, duplicated: number;
beforeEach(() => {
  document.body.innerHTML = '<menupopup id="zotero-itemmenu"></menupopup>';
  popup = document.getElementById("zotero-itemmenu")!;
  (document as any).createXULElement = (name: string) => document.createElement(name);
  nativeNodes = nativeOptions.map(name => { const n = document.createElement(name.startsWith("sep") ? "menuseparator" : "menuitem"); n.id = `native-${name}`; popup.appendChild(n); return n; });
  trashed = 0; duplicated = 0;
  nativeNodes[13].addEventListener("command", () => { duplicated++; });
  nativeNodes[15].addEventListener("command", () => { trashed++; });
  (window as any).ZoteroPane = { itemsView: { getSelectedItems: () => [{ id: 50, isAttachment: () => true, attachmentContentType: "application/pdf" }] } };
  vi.stubGlobal("Zotero", { getMainWindows: () => [window], debug: vi.fn() });
});
afterEach(() => { unregisterItemTreeMenu(); vi.unstubAllGlobals(); delete (window as any).ZoteroPane; });
function hostBuild() {
  nativeOptions.forEach((_, i) => (popup.childNodes[i] as HTMLElement).setAttribute("hidden", "true"));
  (popup.childNodes[15] as HTMLElement).setAttribute("label", "移到回收站");
  (popup.childNodes[15] as HTMLElement).setAttribute("hidden", "false");
  (popup.childNodes[16] as HTMLElement).setAttribute("label", "永久删除");
  popup.dispatchEvent(new Event("popupshowing"));
}
describe("native item-menu command identity", () => {
  it("preserves every native position across repeated builds and unregisters only its own nodes", () => {
    registerItemTreeMenu(); registerItemTreeMenu();
    for (let round = 0; round < 3; round++) {
      hostBuild();
      expect([...popup.childNodes].slice(0, nativeNodes.length)).toEqual(nativeNodes);
      expect(document.getElementById("wenxianyidu-itemmenu")?.getAttribute("hidden")).toBe("false");
    }
    unregisterItemTreeMenu();
    expect([...popup.childNodes]).toEqual(nativeNodes);
  });
  it("the visible trash command deletes one item instead of duplicating it", () => {
    registerItemTreeMenu(); hostBuild();
    const shownTrash = [...popup.children].find(n => n.getAttribute("label") === "移到回收站")!;
    expect(shownTrash).toBe(nativeNodes[15]);
    shownTrash.dispatchEvent(new Event("command"));
    expect(trashed).toBe(1); expect(duplicated).toBe(0);
    expect(nativeNodes[13].getAttribute("label")).not.toBe("移到回收站");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZoteroMock, resetReaderEventListeners } from "../../qa/harness/zotero-mock";
import { registerReaderToolbar, unregisterReaderToolbar } from "../../../src/modules/registerReaderToolbar";
import { resetTranslationStatus, updateTranslationStatus } from "../../../src/core/pdf/splitview/translationStatus";
import * as splitView from "../../../src/core/pdf/splitview/splitViewFactory";
import * as bilingual from "../../../src/core/pdf/sdt/bilingualLauncher";
import { saveDocumentJob, trackDocumentJob, releaseDocumentJob } from "../../../src/core/pdf/translation/documentJobs";

let z: ReturnType<typeof createZoteroMock>;
let button: HTMLButtonElement;
let panel: HTMLElement;

beforeEach(() => {
  resetReaderEventListeners();
  resetTranslationStatus();
  document.documentElement.removeAttribute("data-wenxianyidu-toolbar-listeners");
  document.head.replaceChildren();
  document.body.replaceChildren();
  z = createZoteroMock();
  z.install();
  registerReaderToolbar();
  z.fireReaderEvent("renderToolbar", {
    reader: { itemID: 11 }, doc: document,
    append: (node: Node) => document.body.appendChild(node),
  });
  button = document.querySelector(".wenxianyidu-tb-btn")!;
  panel = document.getElementById("wenxianyidu-toolbar-panel")!;
});

afterEach(() => {
  unregisterReaderToolbar();
  z.uninstall();
  vi.useRealTimers();
  vi.restoreAllMocks();
  releaseDocumentJob("toolbar-a");
  releaseDocumentJob("toolbar-b");
});

function click(detail = 1) {
  button.querySelector("span")!.dispatchEvent(new MouseEvent("click", {
    bubbles: true, cancelable: true, button: 0, detail,
  }));
}

describe("toolbar activation", () => {
  it("continues a cancelled contrast session in the same mode", () => {
    vi.spyOn(bilingual, "getActiveBilingualModeForItem").mockReturnValue("interleave");
    const contrast = vi.spyOn(splitView, "startBilingualFromReader").mockResolvedValue();
    const pdf = vi.spyOn(splitView, "translateCurrentReader").mockResolvedValue();
    updateTranslationStatus({ sourceItemID: 11, phase: "cancelled", done: 3, total: 10 });
    click(); panel.querySelector<HTMLButtonElement>('[data-action="resume"]')!.click();
    expect(contrast).toHaveBeenCalledWith({ itemID: 11 }, "interleave"); expect(pdf).not.toHaveBeenCalled();
  });
  it("opens on the first ordinary click, including clicks on its label", () => {
    expect(panel.hidden).toBe(true);
    click();
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("still opens when the host cancels pointerdown and suppresses mousedown", () => {
    button.addEventListener("pointerdown", event => event.preventDefault(), { capture: true });
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    click();
    expect(panel.hidden).toBe(false);
  });

  it("does not toggle twice for a double click", () => {
    click(1);
    click(2);
    button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    expect(panel.hidden).toBe(false);
  });

  it("does not drop consecutive single activations within 320 ms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    click();
    expect(panel.hidden).toBe(false);
    vi.advanceTimersByTime(100);
    click();
    expect(panel.hidden).toBe(true);
    button.click();
    expect(panel.hidden).toBe(false);
  });

  it("opens via keyboard and closes with Escape", () => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(panel.hidden).toBe(false);
    expect(document.activeElement?.getAttribute("data-action")).toBe("translate");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel.hidden).toBe(true);
  });

  it("keeps progress and resume actions with their own document", () => {
    updateTranslationStatus({ sourceItemID: 11, phase: "cancelled", title: "Paper A", done: 3, total: 10 });
    const otherDoc = document.implementation.createHTMLDocument();
    z.fireReaderEvent("renderToolbar", {
      reader: { itemID: 22 }, doc: otherDoc,
      append: (node: Node) => otherDoc.body.appendChild(node),
    });
    expect(otherDoc.getElementById("wenxianyidu-toolbar")!.dataset.phase).toBe("idle");
    expect(otherDoc.querySelector('[data-action="resume"]')).toBeNull();
    expect(otherDoc.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.disabled).toBe(true);
    updateTranslationStatus({ sourceItemID: 22, phase: "running", title: "Paper B", done: 1, total: 8 });
    expect(document.getElementById("wenxianyidu-toolbar")!.dataset.phase).toBe("cancelled");
    expect(document.getElementById("wenxianyidu-toolbar")!.dataset.done).toBe("3");
    click();
    expect(panel.querySelector('[data-action="resume"]')).not.toBeNull();
    expect(panel.textContent).not.toContain("Paper B");
  });

  it("resumes a partial translation without asking to reuse its incomplete PDF", () => {
    const translate = vi.spyOn(splitView, "translateCurrentReader").mockResolvedValue();
    updateTranslationStatus({ sourceItemID: 11, phase: "partial", done: 7, total: 10, failed: 3 });
    click();
    panel.querySelector<HTMLButtonElement>('[data-action="resume"]')!.click();
    expect(translate).toHaveBeenCalledWith({ itemID: 11 });
  });

  it("cancels only this document while another document keeps running", async () => {
    const a = new AbortController(), b = new AbortController();
    const jobA = { id: "toolbar-a", sourceItemID: 11, status: "running" } as any;
    const jobB = { id: "toolbar-b", sourceItemID: 22, status: "running" } as any;
    await saveDocumentJob(jobA); await saveDocumentJob(jobB);
    trackDocumentJob(jobA, a); trackDocumentJob(jobB, b);
    click();
    panel.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
  });
});

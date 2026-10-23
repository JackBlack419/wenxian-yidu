// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { bindReflowSelection, readReflowSelection, subscribeReflowSelection, unbindReflowSelection } from "../../../src/core/pdf/sdt/selectionBridge";
import { enterBilingualSession, returnToOriginalPdf } from "../../../src/core/pdf/sdt/sdtBridge";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function page() {
  const dom = new JSDOM('<button>Toolbar</button><article id="sdt-content"><p>Original sentence.</p><p>译文内容。</p></article>');
  cleanups.push(() => dom.window.close());
  const doc = dom.window.document;
  return { doc, select(selector: string) {
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector(selector)!);
    doc.getSelection()!.removeAllRanges();
    doc.getSelection()!.addRange(range);
    doc.dispatchEvent(new dom.window.Event("selectionchange"));
  } };
}

describe("reflow selection lifecycle", () => {
  it("the real session entry binds its document and returning to PDF releases it", async () => {
    const p = page();
    p.doc.querySelector("p")!.setAttribute("data-ref-path", "0");
    const internal = {
      _loadSDT: vi.fn(),
      _handleReadingModeEnabledChange: vi.fn(async () => {}),
      _setReadingMode: vi.fn(async () => {}),
      _primarySDTView: { _iframe: { contentDocument: p.doc } },
    };
    const reader = { _internalReader: internal };
    const session = await enterBilingualSession(reader);
    expect(session).not.toBeNull();
    p.select("p");
    expect(readReflowSelection(reader)).toBe("Original sentence.");
    await returnToOriginalPdf(reader);
    expect(internal._setReadingMode).toHaveBeenCalledWith(true, false);
    expect(readReflowSelection(reader)).toBeNull();
    await session!.exit(); // Repeated session disposal stays safe.
  });

  it("reads original and translated DOM text, ignoring controls and cleared selections", () => {
    const p = page(), reader = { _internalReader: {} };
    expect(readReflowSelection(reader)).toBeNull();
    cleanups.push(bindReflowSelection(reader, p.doc));
    expect(readReflowSelection(reader)).toBe("");
    p.select("p");
    expect(readReflowSelection(reader)).toBe("Original sentence.");
    p.select("p + p");
    expect(readReflowSelection(reader)).toBe("译文内容。");
    p.select("button");
    expect(readReflowSelection(reader)).toBe("");
    p.doc.getSelection()!.removeAllRanges();
    expect(readReflowSelection(reader)).toBe("");
  });

  it("isolates readers, unwraps content readers and removes old document listeners", () => {
    const a = page(), b = page(), internal = {}, reader = { _internalReader: { wrappedJSObject: internal } }, other = {};
    const listener = vi.fn();
    cleanups.push(subscribeReflowSelection(listener));
    const unbindA = bindReflowSelection(reader, a.doc);
    cleanups.push(unbindA);
    a.select("p");
    expect(readReflowSelection(internal)).toBe("Original sentence.");
    expect(readReflowSelection(other)).toBeNull();
    cleanups.push(bindReflowSelection(reader, b.doc));
    unbindA(); // A stale disposer must not remove the replacement document.
    expect(readReflowSelection(reader)).toBe("");
    listener.mockClear();
    a.select("p + p");
    expect(listener).not.toHaveBeenCalled();
    b.select("p + p");
    expect(listener).toHaveBeenLastCalledWith(reader, "译文内容。");
  });

  it("unload and explicit exit revoke listeners and restore PDF selection reads", () => {
    const p = page(), reader = {}, listener = vi.fn();
    cleanups.push(subscribeReflowSelection(listener));
    cleanups.push(bindReflowSelection(reader, p.doc));
    p.doc.defaultView!.dispatchEvent(new p.doc.defaultView!.Event("unload"));
    expect(readReflowSelection(reader)).toBeNull();
    listener.mockClear();
    p.select("p");
    expect(listener).not.toHaveBeenCalled();
    cleanups.push(bindReflowSelection(reader, p.doc));
    unbindReflowSelection(reader);
    unbindReflowSelection(reader);
    expect(readReflowSelection(reader)).toBeNull();
  });
});

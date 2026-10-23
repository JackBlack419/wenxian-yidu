// @vitest-environment jsdom
/**
 * sdtBridge#collectBlocks tests — the block inventory rules over a fabricated
 * SDT container (top-level tags, ref-path presence, reference skipping,
 * whitespace filtering).
 */

import { describe, expect, it } from "vitest";
import { collectBlocks } from "../../../src/core/pdf/sdt/sdtBridge";

function fakeEl(opts: {
  tag: string;
  refPath?: string;
  text?: string;
  reference?: boolean;
  className?: string;
  role?: string;
  children?: any[];
}): HTMLElement {
  const el = document.createElement(opts.tag);
  if (opts.refPath !== undefined) el.dataset.refPath = opts.refPath;
  if (opts.reference) el.classList.add("sdt-reference");
  if (opts.className) el.classList.add(opts.className);
  if (opts.role) el.setAttribute("role", opts.role);
  if (opts.text) el.textContent = opts.text;
  for (const child of opts.children ?? []) el.appendChild(child);
  return el;
}

function container(children: HTMLElement[]): HTMLElement {
  const root = document.createElement("article");
  root.append(...children);
  return root;
}

describe("sdtBridge#collectBlocks", () => {
  it("collects translatable top-level blocks with their ref-path", () => {
    const blocks = collectBlocks(container([
      fakeEl({ tag: "p", refPath: "0", text: "First paragraph text." }),
      fakeEl({ tag: "h2", refPath: "1", text: "2. Methods" }),
      fakeEl({ tag: "figcaption", refPath: "2", text: "Figure 1: results." }),
    ]));
    expect(blocks.map((b) => b.refPath)).toEqual(["0", "1", "2"]);
    expect(blocks[1].text).toBe("2. Methods");
  });

  it("skips non-translatable containers (tables, lists, images, math)", () => {
    const blocks = collectBlocks(container([
      fakeEl({ tag: "p", refPath: "0", text: "Real paragraph." }),
      fakeEl({ tag: "table", refPath: "1", text: "aggregated cell text" }),
      fakeEl({ tag: "ul", refPath: "2", text: "list items aggregated" }),
      fakeEl({ tag: "figure", refPath: "3", text: "" }),
      fakeEl({ tag: "div", refPath: "4", text: "math" }),
    ]));
    expect(blocks.map((b) => b.refPath)).toEqual(["0"]);
  });

  it("collects nested list items once and keeps an LI's paragraph text with its LI", () => {
    const nestedLeaf = fakeEl({ tag: "li", refPath: "4.0.0", text: "Nested leaf." });
    const nestedList = fakeEl({ tag: "ol", refPath: "4.0", children: [nestedLeaf] });
    const paragraph = fakeEl({ tag: "p", refPath: "4.0.p", text: "Parent item." });
    const parent = fakeEl({
      tag: "li",
      refPath: "4.0",
      children: [paragraph, nestedList],
    });
    const sibling = fakeEl({ tag: "li", refPath: "4.1", text: "Sibling item." });
    const list = fakeEl({ tag: "ul", refPath: "4", children: [parent, sibling] });

    const blocks = collectBlocks(container([list]));
    expect(blocks.map((b) => b.refPath)).toEqual(["4.0", "4.0.0", "4.1"]);
    expect(blocks.map((b) => b.text)).toEqual([
      "Parent item.",
      "Nested leaf.",
      "Sibling item.",
    ]);
    expect(new Set(blocks.map((b) => b.refPath)).size).toBe(blocks.length);
    expect(blocks[0].el).toBe(parent);
  });

  it("does not collect LI descendants from tables, formulas, or reference sections", () => {
    const tableItem = fakeEl({ tag: "li", refPath: "8.0", text: "Cell text." });
    const table = fakeEl({ tag: "table", children: [tableItem] });
    const formulaItem = fakeEl({ tag: "li", refPath: "8.1", text: "x plus y." });
    const formula = fakeEl({ tag: "div", className: "sdt-math", children: [formulaItem] });
    const referenceItem = fakeEl({ tag: "li", refPath: "8.2", text: "Citation." });
    const referenceList = fakeEl({ tag: "ul", children: [referenceItem] });
    const reference = fakeEl({
      tag: "div",
      reference: true,
      children: [referenceList],
    });
    const list = fakeEl({ tag: "ul", refPath: "8", children: [table, formula, reference] });

    expect(collectBlocks(container([list]))).toEqual([]);
  });

  it("skips the reference section and whitespace-only blocks", () => {
    const blocks = collectBlocks(container([
      fakeEl({ tag: "p", refPath: "0", text: "Body text." }),
      fakeEl({ tag: "p", refPath: "1", text: "[1] Author, Title (2020).", reference: true }),
      fakeEl({ tag: "p", refPath: "2", text: "   " }),
      fakeEl({ tag: "p", text: "no ref path" }),
    ]));
    expect(blocks.map((b) => b.refPath)).toEqual(["0"]);
  });
});

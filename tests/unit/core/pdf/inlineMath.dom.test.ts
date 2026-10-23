// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { protectInlineMath } from "../../../../src/core/pdf/sdt/inlineMath";

describe("source inline math", () => {
  it("restores scripts and MathML from the source without changing the source", () => {
    const source = document.createElement("p");
    source.innerHTML = 'Features z<sup>r</sup><sub>e</sub> and <math><mi>φ</mi><msup><mi>x</mi><mn>2</mn></msup></math>.';
    const original = source.innerHTML, protectedText = protectInlineMath(source, source.textContent!);
    expect(protectedText.text).toContain("{v");
    expect(protectedText.valid(protectedText.text)).toBe(true);
    expect(protectedText.valid("missing formula")).toBe(false);
    const target = document.createElement("div");
    protectedText.render(target, protectedText.text.replace("Features", "特征"));
    expect(target.querySelector("sup")!.textContent).toBe("r");
    expect(target.querySelector("sub")!.textContent).toBe("e");
    expect(target.querySelector("math")!.textContent).toBe("φx2");
    expect(target.textContent).toContain("特征 zre");
    expect(source.innerHTML).toBe(original);
  });
  it("does not interpret model HTML and strips active content from source fragments", () => {
    const source = document.createElement("p"); source.innerHTML = 'x<sup onclick="evil()">2<script>evil()</script></sup>';
    const protectedText = protectInlineMath(source, source.textContent!);
    const target = document.createElement("div");
    protectedText.render(target, protectedText.text + '<img src=x onerror=evil()>');
    expect(target.querySelector("img,script,[onclick]")).toBeNull();
    expect(target.textContent).toContain("<img");
  });
  it("uses distinct tokens and cache sources for distinct formulas with the same prose", () => {
    const a = document.createElement("p"), b = document.createElement("p");
    a.innerHTML = 'Value x<sup>2</sup>'; b.innerHTML = 'Value x<sup>3</sup>';
    const one = protectInlineMath(a, a.textContent!), two = protectInlineMath(b, b.textContent!);
    expect(one.text).not.toBe(two.text); expect(one.cacheText).not.toBe(two.cacheText);
    expect(protectInlineMath(a, a.textContent!).text).toBe(one.text);
  });
  it("leaves unformatted prose and literal math unchanged", () => {
    const source = document.createElement("p"); source.textContent = 'where $x_1$ is measured';
    expect(protectInlineMath(source, source.textContent).text).toBe(source.textContent);
  });
});

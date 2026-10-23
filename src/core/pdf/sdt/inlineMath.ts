/** Preserve source-owned inline math as DOM, never interpret provider HTML. */
export function protectInlineMath(source: HTMLElement, fallback: string) {
  const doc = source.ownerDocument!;
  const copy = source.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("ul,ol,table,figure,.wenxianyidu-bi").forEach((n: Element) => n.remove());
  const fragments = new Map<string, Element>();
  let index = 0;
  const prefix = "{v";
  const nextToken = (signature: string) => {
    let hash = 2166136261;
    for (const char of signature) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    let token: string;
    do { token = `${prefix}${hash >>> 0}${index++}}`; } while (fallback.includes(token));
    return token;
  };
  const selector = "math,[role='math'],.katex,.sdt-math,.sdt-formula,sup,sub";
  const nodes = [...copy.querySelectorAll(selector)].filter(n => !n.parentElement?.closest(selector));
  for (const node of nodes) {
    const fragment = doc.createElement("span");
    // Include the variable immediately before a superscript/subscript.
    const previous = node.previousSibling;
    if ((node.tagName === "SUP" || node.tagName === "SUB") && previous?.nodeType === 3) {
      const text = previous.textContent || "";
      const base = /[A-Za-z\u0370-\u03ff]+$/.exec(text)?.[0];
      if (base) { previous.textContent = text.slice(0, -base.length); fragment.appendChild(doc.createTextNode(base)); }
    }
    fragment.appendChild(node.cloneNode(true));
    // Remove active content and attributes even though this is source-owned DOM.
    fragment.querySelectorAll("script,style,iframe,object,embed,img,a,link").forEach((n: Element) => n.remove());
    for (const element of [fragment, ...fragment.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) {
        if (!/^(class|display|mathvariant|mathsize|mathcolor|stretchy|fence|separator|accent|accentunder|columnalign|rowalign|columnspacing|rowspacing|xmlns)$/.test(attribute.name)) element.removeAttribute(attribute.name);
      }
    }
    const token = nextToken(String(fragment.outerHTML)); fragments.set(token, fragment);
    node.replaceWith(doc.createTextNode(token));
  }
  const text = fragments.size ? (copy.textContent || "").replace(/\s+/g, " ").trim() : fallback;
  const cacheText = text.replace(/\{v\d+\}/g, token => String(fragments.get(token)?.outerHTML ?? token));
  function valid(translated: string) { return [...fragments.keys()].every(token => translated.split(token).length === 2); }
  function render(target: HTMLElement, translated: string) {
    target.replaceChildren();
    // Unknown tokens and any HTML from the provider remain literal text.
    for (const part of translated.split(/(\{v\d+\})/)) {
      const fragment = fragments.get(part);
      target.appendChild(fragment ? fragment.cloneNode(true) : doc.createTextNode(part));
    }
  }
  const plain = (translated: string) => translated.replace(/\{v\d+\}/g, token => fragments.get(token)?.textContent ?? token);
  return { text, cacheText, valid, render, plain, hasMath: fragments.size > 0 };
}

/** Explicit math is kept verbatim; ordinary letters are never guessed as math. */
export interface ProtectedTextPart {
  text: string;
  protected: boolean;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  while (index > 0 && text[--index] === "\\") slashes++;
  return slashes % 2 === 1;
}

/** Split {vN}, $...$, $$...$$, \(...\) and \[...\] without changing text. */
export function splitProtectedText(text: string): ProtectedTextPart[] {
  const parts: ProtectedTextPart[] = [];
  let plainStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (isEscaped(text, i)) continue;
    let end = -1;
    const token = text[i] === "{" ? /^\{v\d+\}/.exec(text.slice(i)) : null;
    if (token) end = i + token[0].length;
    else {
      const open = text.startsWith("\\(", i) ? "\\("
        : text.startsWith("\\[", i) ? "\\["
        : text.startsWith("$$", i) ? "$$"
        : text[i] === "$" ? "$" : "";
      if (!open) continue;
      const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open;
      for (let j = i + open.length; j < text.length; j++) {
        if (open === "$" && (text[j] === "\n" || text[j] === "\r")) break;
        if (!text.startsWith(close, j) || isEscaped(text, j)) continue;
        if (open === "$" && (text[j - 1] === "$" || text[j + 1] === "$")) continue;
        // A second currency amount is not a closing inline-math delimiter.
        if (open === "$" && /\d/.test(text[j + 1] || "")) continue;
        if (j > i + open.length) end = j + close.length;
        break;
      }
      // Do not reinterpret one half of an unmatched display delimiter.
      if (end < 0) { i += open.length - 1; continue; }
    }
    if (end < 0) continue;
    if (i > plainStart) parts.push({ text: text.slice(plainStart, i), protected: false });
    parts.push({ text: text.slice(i, end), protected: true });
    plainStart = end;
    i = end - 1;
  }
  if (plainStart < text.length) parts.push({ text: text.slice(plainStart), protected: false });
  return parts;
}

/** Reordering is allowed for translation, but duplication, loss and edits are not. */
export function protectedTextUnchanged(source: string, translated: string): boolean {
  const math = (value: string) => splitProtectedText(value)
    .filter(part => part.protected).map(part => part.text).sort();
  const original = math(source), result = math(translated);
  return original.length === result.length && original.every((part, i) => part === result[i]);
}

export function maskProtectedSentence(text: string) {
  const parts = splitProtectedText(text);
  const protectedParts = parts.filter(part => part.protected);
  let prefix = "XQZWYMATH";
  while (text.includes(prefix)) prefix += "Z";
  const tokens = protectedParts.map((_part, i) => `${prefix}${i}QZX`);
  let cursor = 0;
  const masked = parts.map(part => part.protected ? tokens[cursor++] : part.text).join("");
  const restore = (translated: string): string | null => {
    if (!tokens.every(token => translated.split(token).length === 2)) return null;
    let restored = translated;
    tokens.forEach((token, i) => { restored = restored.replace(token, protectedParts[i].text); });
    return protectedTextUnchanged(text, restored) ? restored : null;
  };
  return { masked, restore, parts };
}

/** Preserve sentence context around math; only fall back if a provider edits markers. */
export async function translateProtectedSentence(text: string, translate: (value: string) => Promise<string>): Promise<string> {
  const { masked, restore, parts } = maskProtectedSentence(text);
  if (!parts.some(part => !part.protected && part.text.trim())) return text;
  const restored = restore(await translate(masked));
  if (restored !== null) return restored;
  const fallback: string[] = [];
  for (const part of parts) fallback.push(part.protected || !part.text.trim() ? part.text : await translate(part.text));
  return fallback.join("");
}

import fs from "node:fs";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
const catalog = JSON.parse(fs.readFileSync("tests/qa/fixtures/translation-quality/public-abstracts-60.json", "utf8"));
const decode = new JSDOM().window.document.createElement("textarea");
const texts = new Map();
for (const source of new Set(catalog.cases.map(row => row.source))) {
  const response = await fetch(source, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "WenxianYidu-QA/0.2 (public abstract benchmark)" } });
  if (!response.ok) throw Error(`Public corpus source failed: ${source} (${response.status})`);
  const page = await response.text();
  const match = /<blockquote[^>]*class="abstract[^>]*>([\s\S]*?)<\/blockquote>/.exec(page);
  if (!match) throw Error(`Abstract missing: ${source}`);
  decode.innerHTML = match[1].replace(/<[^>]+>/g, " ");
  const text = decode.value.replace(/^\s*Abstract:\s*/, "").replace(/\s+/g, " ").trim();
  texts.set(source, text.split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(sentence => sentence.split(/\s+/).length >= 5));
}
const corpus = { version: 1, provenance: "Public arXiv abstracts, retrieved 2026-10-23. At most 180 source words per paper. English inputs stay in the ignored QA directory; the repository stores source pointers and a checksum.",
  cases: catalog.cases.map(row => ({ id: row.id, text: texts.get(row.source)[row.sentenceIndex], source: row.source, sentenceIndex: row.sentenceIndex })) };
const bytes = JSON.stringify(corpus, null, 2);
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== catalog.sha256) {
  fs.mkdirSync(".verify", { recursive: true });
  fs.writeFileSync(".verify/public-corpus-candidate.json", bytes);
  throw Error("Public abstract snapshot changed; candidate saved separately. Review it before comparing benchmark results.");
}
fs.mkdirSync(".verify", { recursive: true });
fs.writeFileSync(".verify/public-corpus-60.json", bytes);
console.log("Prepared frozen public abstract corpus (60 sentences, 20 papers)");

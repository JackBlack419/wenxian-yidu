import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
const engine = process.argv[2] || "bing-web";
if (!["bing-web", "google", "mtranserver"].includes(engine)) throw Error("Unsupported benchmark engine");
const corpusName = process.argv[3] === "public" ? "public-abstracts-60" : "scientific-60";
const corpus = JSON.parse(fs.readFileSync(corpusName.startsWith("public") ? ".verify/public-corpus-60.json" : `tests/qa/fixtures/translation-quality/${corpusName}.json`, "utf8"));
const output = path.resolve(`.verify/quality-020-${engine}${corpusName.startsWith("public") ? "-public" : ""}.json`);
const state = { engine, corpus: corpusName, corpusSha256: createHash("sha256").update(JSON.stringify(corpus)).digest("hex"), provenance: corpus.provenance, started: new Date().toISOString(), phase: "running" };
const save = () => fs.writeFileSync(output, JSON.stringify(state, null, 2));
async function command(action, argument) {
  const { stdout } = await exec(process.execPath, ["scripts/qa/real-machine.mjs", "send", action, typeof argument === "object" ? JSON.stringify(argument) : argument], { windowsHide: true, maxBuffer: 5e6 });
  const response = JSON.parse(stdout); if (!response.ok) throw Error(response.error);
  return response.result;
}
async function run(name, rows, cache) {
  state.stage = name; state.done = 0; save();
  await command("setPref", `translate.cache.enabled=${cache}`);
  const result = { ms: 0, wallMs: 0, results: [] };
  const at = Date.now();
  for (let i = 0; i < rows.length; i += 5) {
    const part = await command("productTranslation", { engine, segments: rows.slice(i, i + 5).map(c => ({ id: c.id, text: c.text })) });
    result.ms += part.ms; result.results.push(...part.results); state.done = result.results.length;
    state[name] = result; save();
  }
  result.wallMs = Date.now() - at; state[name] = result; save();
}
try {
  await run("cold", corpus.cases.slice(0, 1), false);
  await run("withoutCache", corpus.cases, false);
  await run("populateCache", corpus.cases, true);
  await run("cacheHit", corpus.cases, true);
  state.phase = "complete"; console.log(`${engine}: ${state.withoutCache.ms} ms without cache; ${state.cacheHit.ms} ms with cache`);
} catch (error) { state.phase = "failed"; state.error = String(error); throw error; }
finally { await command("setPref", "translate.cache.enabled=true").catch(() => {}); save(); }

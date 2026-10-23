import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve("addon/content/offline");
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8").replace(/^\uFEFF/, ""));
const provenance = read("PROVENANCE.json"), lock = read("package-lock.json"), records = read("records.json");
function check(condition, message) { if (!condition) throw Error(message); }
check(provenance.node.version === "24.22.1" && provenance.mtranserver.version === "5.0.1", "Pinned versions changed");
check(lock.packages["node_modules/mtranserver"].version === "5.0.1", "Wrong npm release");
check(lock.packages["node_modules/mtranserver"].integrity === provenance.mtranserver.integrity, "npm integrity differs from verified release");
check(lock.packages["node_modules/koffi"].version === "2.15.1" && provenance.nativeLoader.version === "2.15.1", "Native Unicode DLL loader is not pinned");
for (const [name, digest] of Object.entries(provenance.files)) {
  const bytes = fs.readFileSync(path.join(root, name));
  check(createHash("sha256").update(bytes).digest("hex") === digest, `Source checksum mismatch: ${name}`);
  const built = path.resolve(".scaffold/build/addon/content/offline", name);
  if (fs.existsSync(built)) check(bytes.equals(fs.readFileSync(built)), `Built asset differs: ${name}`);
}
check(records.data.length === 4, "Expected four pinned English–Simplified Chinese model files");
for (const record of records.data) {
  check(record.sourceLanguage === "en" && record.targetLanguage === "zh-Hans" && record.version === "3.0", "Unexpected model pair or version");
  check(/^[a-f0-9]{64}$/.test(record.attachment.hash) && /^[a-f0-9]{64}$/.test(record.decompressedHash), "Missing model checksums");
  check(path.basename(record.attachment.filename) === record.attachment.filename, "Invalid model filename");
}
for (const [name, entry] of Object.entries(lock.packages)) if (name) {
  check(/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved ?? ""), `Unexpected package source: ${name}`);
  check(/^sha(?:256|512)-/.test(entry.integrity ?? ""), `Missing package integrity: ${name}`);
}
console.log("OK: Node 24.22.1, npm MTranServer 5.0.1, locked dependencies, and four checksum-pinned en→zh-Hans model assets");

// Only pinned Mozilla assets are prepared. Completed ranges survive cancellation.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export async function prepareModelAssets(root, { fetcher = fetch, report = async () => {}, decode } = {}) {
  const registry = JSON.parse(await fs.readFile(path.join(root, "config", "records.json"), "utf8"));
  const dir = path.join(root, "models", "en_zh-Hans");
  await fs.mkdir(dir, { recursive: true });
  const decompress = decode ?? (await import("fzstd")).decompress;
  const records = registry.data;
  if (!Array.isArray(records) || records.length !== 4) throw new Error("Invalid pinned registry");
  const totalBytes = records.reduce((sum, record) => sum + Number(record.attachment?.size || 0), 0);
  let completedBytes = 0;
  for (let n = 0; n < records.length; n++) {
    const record = records[n], attachment = record.attachment;
    if (record.sourceLanguage !== "en" || record.targetLanguage !== "zh-Hans" ||
        !/^[a-z0-9.]+\.zst$/i.test(attachment.filename) ||
        !/^main-workspace\/translations-models-v2\/[a-f0-9-]+\.zst$/i.test(attachment.location) ||
        !/^[a-f0-9]{64}$/i.test(attachment.hash) || !/^[a-f0-9]{64}$/i.test(record.decompressedHash) ||
        !Number.isSafeInteger(attachment.size) || attachment.size < 1 || attachment.size > 100000000) throw new Error("Invalid pinned model asset");
    const output = path.join(dir, attachment.filename.replace(/\.zst$/, ""));
    try { if (hash(await fs.readFile(output)) === record.decompressedHash) { completedBytes += attachment.size; await report({ phase: "models", percent: Math.round(completedBytes / totalBytes * 100) }); continue; } } catch { /* missing */ }
    const chunkSize = 1024 * 1024, count = Math.ceil(attachment.size / chunkSize);
    const parts = new Array(count), loaded = new Array(count).fill(0);
    const partPath = i => path.join(dir, `${attachment.filename}.part.${i}`);
    let cursor = 0, whole;
    const progress = async () => report({ phase: "models", percent: Math.round((completedBytes + Math.min(attachment.size, loaded.reduce((a, b) => a + b, 0))) / totalBytes * 100) });
    const worker = async () => {
      while (cursor < count && !whole) {
        const i = cursor++, start = i * chunkSize, end = Math.min(attachment.size, start + chunkSize) - 1;
        try { const bytes = await fs.readFile(partPath(i)); if (bytes.length === end - start + 1) { parts[i] = bytes; loaded[i] = bytes.length; await progress(); continue; } } catch { /* missing range */ }
        const response = await fetcher(`https://firefox-settings-attachments.cdn.mozilla.net/${attachment.location}`, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(180000) });
        if (!response.ok) throw new Error(`Model download HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (response.status === 200 && bytes.length === attachment.size) { whole = bytes; loaded.fill(0); loaded[0] = bytes.length; await progress(); return; }
        if (response.status !== 206 || bytes.length !== end - start + 1) throw new Error("Model range download was incomplete");
        await fs.writeFile(partPath(i) + ".tmp", bytes); await fs.rename(partPath(i) + ".tmp", partPath(i));
        parts[i] = bytes; loaded[i] = bytes.length; await progress();
      }
    };
    const settled = await Promise.allSettled(Array.from({ length: 3 }, worker));
    const failure = settled.find(r => r.status === "rejected");
    if (failure && !whole) throw failure.reason;
    const compressed = whole || Buffer.concat(parts);
    await report({ phase: "verifying-model" });
    if (compressed.length !== attachment.size || hash(compressed) !== attachment.hash) {
      await Promise.all(Array.from({ length: count }, (_, i) => fs.rm(partPath(i), { force: true })));
      throw new Error("Model download checksum mismatch; retry preparation");
    }
    await report({ phase: "model-extracting" });
    const unpacked = decompress(compressed);
    if (unpacked.length !== record.decompressedSize || hash(unpacked) !== record.decompressedHash) throw new Error("Model decompression checksum mismatch");
    await fs.writeFile(output + ".unpacked", unpacked); await fs.rename(output + ".unpacked", output);
    await fs.writeFile(output + ".source.json", JSON.stringify({ attachmentHash: attachment.hash, localHash: record.decompressedHash }));
    await Promise.all(Array.from({ length: count }, (_, i) => fs.rm(partPath(i), { force: true })));
    completedBytes += attachment.size;
    await report({ phase: "models", percent: Math.round(completedBytes / totalBytes * 100) });
  }
}

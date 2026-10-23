import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
// @ts-ignore bundled worker helper is also exercised directly in Node
import { prepareModelAssets } from "../../addon/content/offline/modelDownload.mjs";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "译读-model-"));
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 17, 61);
  const records = Array.from({ length: 4 }, (_, i) => ({ sourceLanguage: "en", targetLanguage: "zh-Hans", decompressedHash: hash(bytes), decompressedSize: bytes.length,
    attachment: { filename: `model.${i}.bin.zst`, location: `main-workspace/translations-models-v2/abcd-${i}.zst`, size: bytes.length, hash: hash(bytes) } }));
  await fs.mkdir(path.join(root, "config")); await fs.writeFile(path.join(root, "config/records.json"), JSON.stringify({ data: records }));
  return { root, bytes, records };
}
describe("offline pinned model downloads", () => {
  it("reports model bytes across unequal files and distinguishes verification/extraction from readiness", async () => {
    const { root, records } = await fixture();
    const payloads = [8192, 1024, 1024, 2048].map((size, i) => Buffer.alloc(size, 61 + i));
    records.forEach((record, i) => { record.attachment.size = payloads[i].length; record.attachment.hash = hash(payloads[i]); record.decompressedSize = payloads[i].length; record.decompressedHash = hash(payloads[i]); });
    const events: Array<{ phase: string; percent?: number }> = [];
    try {
      await fs.writeFile(path.join(root, "config/records.json"), JSON.stringify({ data: records }));
      await prepareModelAssets(root, { decode: (b: Buffer) => b, report: async (event: any) => { events.push(event); }, fetcher: async (url: string) => {
        const i = records.findIndex(record => url.endsWith(record.attachment.location)); return new Response(payloads[i], { status: 200 });
      } });
      expect(events.find(event => event.phase === "models")!.percent).toBe(67);
      expect(events.map(event => event.phase)).toContain("verifying-model"); expect(events.map(event => event.phase)).toContain("model-extracting");
      expect(events.at(-1)).toEqual({ phase: "models", percent: 100 }); expect(events.some(event => event.phase === "ready")).toBe(false);
      const cached: any[] = [];
      await prepareModelAssets(root, { report: async (event: any) => { cached.push(event); }, decode: (b: Buffer) => b, fetcher: () => { throw Error("must reuse verified models"); } });
      expect(cached.at(-1)).toEqual({ phase: "models", percent: 100 });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it("keeps completed ranges on interruption, requests only missing ranges, then verifies and reuses all assets", async () => {
    const { root, bytes, records } = await fixture(); const seen: string[] = [];
    try {
      const fetcher = async (url: string, init: any) => {
        const range = init.headers.Range; seen.push(url + range);
        if (range === "bytes=0-1048575") throw Error("interrupted");
        const [start, end] = range.match(/\d+/g).map(Number);
        return new Response(bytes.subarray(start, end + 1), { status: 206 });
      };
      await expect(prepareModelAssets(root, { fetcher, decode: (b: Buffer) => b })).rejects.toThrow("interrupted");
      const dir = path.join(root, "models/en_zh-Hans");
      expect((await fs.readdir(dir)).filter(n => n.includes(".part.")).length).toBe(3);
      seen.length = 0;
      await prepareModelAssets(root, { decode: (b: Buffer) => b, fetcher: async (url: string, init: any) => {
        const [start, end] = init.headers.Range.match(/\d+/g).map(Number); seen.push(url + init.headers.Range);
        return new Response(bytes.subarray(start, end + 1), { status: 206 });
      } });
      expect(seen.filter(s => s.includes("abcd-0.zst"))).toHaveLength(1);
      for (const r of records) expect(hash(await fs.readFile(path.join(dir, r.attachment.filename.replace(/\.zst$/, ""))))).toBe(r.decompressedHash);
      await prepareModelAssets(root, { decode: (b: Buffer) => b, fetcher: () => { throw Error("offline: no network allowed"); } });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it("rejects damaged content before decompression and unsafe registry paths before fetching", async () => {
    const { root, bytes } = await fixture(); let decoded = false;
    try {
      await expect(prepareModelAssets(root, { decode: () => { decoded = true; return bytes; }, fetcher: async () => new Response(Buffer.alloc(bytes.length), { status: 200 }) })).rejects.toThrow("checksum mismatch");
      expect(decoded).toBe(false);
      const file = path.join(root, "config/records.json"), data = JSON.parse(await fs.readFile(file, "utf8"));
      data.data[0].attachment.filename = "../model.zst"; await fs.writeFile(file, JSON.stringify(data));
      await expect(prepareModelAssets(root, { decode: () => bytes, fetcher: () => { throw Error("must not fetch"); } })).rejects.toThrow("Invalid pinned model");
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});

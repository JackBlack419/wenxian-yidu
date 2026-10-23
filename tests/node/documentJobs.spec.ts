import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const state = vi.hoisted(() => ({ identity: "youdao", target: "zh-CN" }));
vi.mock("../../src/core/translation/translationEngines", () => ({ engineCacheIdentity: () => state.identity }));
vi.mock("../../src/utils/prefs", () => ({ getPrefDynamic: () => state.target }));
let root: string;
let source: any;
beforeEach(async () => {
  vi.resetModules(); state.identity = "youdao"; state.target = "zh-CN";
  root = await fs.mkdtemp(path.join(os.tmpdir(), "wenxianyidu-jobs-"));
  const pdf = path.join(root, "文献 with spaces.pdf");
  await fs.writeFile(pdf, "%PDF-1.4 synthetic version one");
  source = { id: 123, key: "SOURCE01", libraryID: 1, getFilePath: () => pdf, getField: () => "Test paper" };
  vi.stubGlobal("PathUtils", { join: path.join });
  vi.stubGlobal("IOUtils", {
    read: async (file: string) => new Uint8Array(await fs.readFile(file)),
    makeDirectory: async (dir: string) => { await fs.mkdir(dir, { recursive: true }); },
    write: async (file: string, bytes: Uint8Array) => { await fs.writeFile(file, bytes); },
    getChildren: async (dir: string) => (await fs.readdir(dir)).map(name => path.join(dir, name)),
  });
  vi.stubGlobal("Zotero", { DataDirectory: { dir: root }, Items: { get: vi.fn() } });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  const relative = path.relative(os.tmpdir(), root);
  if (!relative.startsWith("wenxianyidu-jobs-") || relative.includes(path.sep)) throw new Error("Unexpected test cleanup target");
  await fs.rm(root, { recursive: true, force: true });
});
describe("durable PDF tasks", () => {
  it("changes identity for source bytes, provider configuration and language", async () => {
    const jobs = await import("../../src/core/pdf/translation/documentJobs");
    const first = await jobs.prepareDocumentJob(source);
    expect((await jobs.prepareDocumentJob(source)).id).toBe(first.id);
    state.identity = "ai|modelB|promptB";
    expect((await jobs.prepareDocumentJob(source)).id).not.toBe(first.id);
    state.identity = "youdao"; state.target = "zh-TW";
    expect((await jobs.prepareDocumentJob(source)).id).not.toBe(first.id);
    state.target = "zh-CN";
    await fs.writeFile(source.getFilePath(), "%PDF-1.4 changed source");
    expect((await jobs.prepareDocumentJob(source)).id).not.toBe(first.id);
  });
  it("restores interrupted progress after module restart and serializes last checkpoint", async () => {
    let jobs = await import("../../src/core/pdf/translation/documentJobs");
    const record = await jobs.prepareDocumentJob(source);
    record.total = 10; record.done = 3;
    await jobs.saveDocumentJob(record);
    const first = jobs.saveDocumentJob({ ...record, done: 4 });
    const last = jobs.saveDocumentJob({ ...record, done: 5 });
    await Promise.all([first, last]);
    vi.resetModules(); jobs = await import("../../src/core/pdf/translation/documentJobs");
    const restored = await jobs.prepareDocumentJob(source);
    expect(restored.status).toBe("interrupted"); expect(restored.done).toBe(5);
    expect((await jobs.listDocumentJobs())[0].done).toBe(5);
  });
  it("only reuses a complete existing PDF, and cancellation aborts active work", async () => {
    const jobs = await import("../../src/core/pdf/translation/documentJobs");
    const record = await jobs.prepareDocumentJob(source);
    const attachment = { id: 456, attachmentContentType: "application/pdf", fileExists: async () => true, deleted: false };
    (globalThis as any).Zotero.Items.get.mockReturnValue(attachment);
    record.attachmentID = attachment.id; record.status = "partial";
    expect(await jobs.reusableAttachment(record)).toBeNull();
    record.status = "complete"; expect(await jobs.reusableAttachment(record)).toBe(attachment);
    attachment.deleted = true; expect(await jobs.reusableAttachment(record)).toBeNull();
    const controller = new AbortController();
    await jobs.saveDocumentJob(record); jobs.trackDocumentJob(record, controller);
    expect(jobs.cancelDocumentJob(record.id)).toBe(true); expect(controller.signal.aborted).toBe(true);
    jobs.releaseDocumentJob(record.id); expect(jobs.cancelDocumentJob(record.id)).toBe(false);
  });
});

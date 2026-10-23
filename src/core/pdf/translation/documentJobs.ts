/** Durable document tasks. Only a matching source checksum and configuration can reuse an output. */
import { engineCacheIdentity } from "../../translation/translationEngines";
import { getPrefDynamic } from "../../../utils/prefs";
import { sha256Hex } from "../../../utils/hash";

export type DocumentJobStatus = "running" | "interrupted" | "cancelled" | "failed" | "partial" | "complete";
export interface DocumentJob {
  version: 1;
  id: string;
  sourceItemID: number;
  sourceKey: string;
  libraryID: number;
  title: string;
  sourceHash: string;
  configIdentity: string;
  targetLanguage: string;
  status: DocumentJobStatus;
  stage: string;
  done: number;
  total: number;
  failed: number;
  updatedAt: number;
  attachmentID?: number;
  segments?: DocumentSegment[];
}
export interface DocumentSegment { position: string; source: string; translated: string; status: "success" | "failed" | "pending"; retryAt?: number; }
const memory = new Map<string, DocumentJob>();
const writes = new Map<string, Promise<void>>();
const active = new Map<string, AbortController>();
const io = () => (globalThis as any).IOUtils;
function root(): string | null {
  const dir = (globalThis as any).Zotero?.DataDirectory?.dir;
  return dir ? join(dir, "wenxianyidu", "document-jobs") : null;
}
function join(...parts: string[]): string {
  return (globalThis as any).PathUtils?.join?.(...parts) ?? parts.join("/");
}
function file(id: string): string | null {
  const dir = root();
  return dir && /^[a-f0-9]{64}$/.test(id) ? join(dir, `${id}.json`) : null;
}
async function read(id: string): Promise<DocumentJob | null> {
  if (memory.has(id)) return { ...memory.get(id)! };
  try {
    const path = file(id);
    if (!path) return null;
    const r = JSON.parse(new TextDecoder().decode(await io().read(path)));
    if (r?.version !== 1 || r.id !== id || !Number.isInteger(r.sourceItemID)) return null;
    if (r.status === "running" && !active.has(id)) r.status = "interrupted";
    memory.set(id, r);
    return { ...r };
  } catch { return null; }
}
export async function saveDocumentJob(record: DocumentJob): Promise<void> {
  record.updatedAt = Date.now();
  memory.set(record.id, { ...record });
  const path = file(record.id);
  const dir = root();
  if (!path || !dir || !io()?.write) return;
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  const work = (writes.get(record.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await io().makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
    await io().write(path, bytes, { tmpPath: `${path}.tmp` });
  });
  writes.set(record.id, work);
  // Failed persistence must never be presented as durable success.
  await work;
}
export async function prepareDocumentJob(sourceItem: any): Promise<DocumentJob> {
  const path = sourceItem?.getFilePath?.();
  if (!path || !io()?.read) throw new Error("无法读取 PDF，请先下载或重新关联附件。");
  const sourceHash = await sha256Hex(await io().read(path));
  if (!sourceHash) throw new Error("无法校验源文件，请重新启动 Zotero 后重试。");
  const configIdentity = engineCacheIdentity();
  const targetLanguage = String(getPrefDynamic("translate.targetLanguage") || "zh-CN");
  const id = await sha256Hex(new TextEncoder().encode(JSON.stringify([
    sourceItem.libraryID, sourceItem.key ?? sourceItem.id, sourceHash, configIdentity, targetLanguage,
  ])));
  if (!id) throw new Error("无法建立翻译任务。");
  const previous = await read(id);
  if (previous) return previous;
  return {
    version: 1, id, sourceItemID: sourceItem.id, sourceKey: sourceItem.key ?? String(sourceItem.id),
    libraryID: sourceItem.libraryID ?? 1, title: sourceItem.getField?.("title") || "PDF",
    sourceHash, configIdentity, targetLanguage, status: "running", stage: "准备中", done: 0,
    total: 0, failed: 0, updatedAt: Date.now(),
  };
}
export function trackDocumentJob(job: DocumentJob, controller: AbortController): void {
  active.set(job.id, controller);
}
export function releaseDocumentJob(id: string): void { active.delete(id); }
export function cancelDocumentJob(id: string): boolean {
  const controller = active.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}
export function cancelAllDocumentJobs(): void {
  for (const controller of active.values()) controller.abort();
}
export function getRunningDocumentJobs(): DocumentJob[] {
  return [...active.keys()].map(id => memory.get(id)).filter((r): r is DocumentJob => !!r).map(r => ({ ...r }));
}
export async function listDocumentJobs(): Promise<DocumentJob[]> {
  const dir = root();
  if (dir && io()?.getChildren) {
    try {
      for (const path of await io().getChildren(dir)) {
        const id = String(path).split(/[\\/]/).pop()?.replace(/\.json$/, "");
        if (id && /^[a-f0-9]{64}$/.test(id)) await read(id);
      }
    } catch { /* no tasks yet */ }
  }
  return [...memory.values()].map(r => ({ ...r, status: r.status === "running" && !active.has(r.id) ? "interrupted" as const : r.status }))
    .sort((a,b) => b.updatedAt-a.updatedAt);
}
export async function reusableAttachment(job: DocumentJob): Promise<any | null> {
  if (job.status !== "complete" || !job.attachmentID) return null;
  const attachment = (globalThis as any).Zotero?.Items?.get?.(job.attachmentID);
  if (!attachment || attachment.deleted || attachment.attachmentContentType !== "application/pdf") return null;
  try { return await attachment.fileExists?.() ? attachment : null; } catch { return null; }
}

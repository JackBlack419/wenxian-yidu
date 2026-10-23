/**
 * translatedAttachment — Save translated PDF bytes as a Zotero attachment.
 *
 * Zotero.Attachments has no "import from bytes" API — only importFromFile (which
 * takes an nsIFile). So we write the bytes to a temp file, import it, then delete
 * the temp.
 *
 * The attachment is attached to the ORIGINAL's parent item, so the split-view's
 * sibling-PDF lookup (splitViewCleanup.findLatestTranslation) finds it as the
 * right pane, and the manual "Split View" menu works too.
 *
 * Ported from leadero's src/core/pdf/translation/translatedAttachment.ts (temp
 * file prefix renamed to the z-transplit addon).
 *
 * @module core/pdf/translation/translatedAttachment
 */

/**
 * Save `bytes` as a Zotero PDF attachment.
 *
 * When `parentItemID` is set the translation is attached next to the source
 * under the same parent item (so split-view's sibling-PDF lookup
 * splitViewCleanup.findLatestTranslation finds it). When the source PDF is a
 * STANDALONE attachment (no parent — TransLift fixed the same gap in 2.7.0),
 * the translation is imported as a new top-level attachment item instead of
 * silently failing.
 *
 * @param bytes Translated PDF bytes (already merged across pages).
 * @param parentItemID The original attachment's parentItemID (the journal
 *   article etc.), or null/undefined for a standalone source.
 * @param title Display title for the new attachment (e.g.
 *   "Translated (zh-CN) · paper" — see translatedTitleWithSource).
 * @param sourceItem The source PDF attachment, when known — used to link the
 *   translation back via dc:relation so the dedup lookups also work for
 *   top-level sources.
 * @returns The created Zotero.Item (attachment).
 */
import { getString } from "../../../utils/locale";
import { safeDebug } from "../../../utils/logger";

/**
 * Base name of the source PDF file without extension ("paper" from
 * ".../paper.pdf"). Prefers the attachment's own filename, falls back to its
 * file path, and finally to a constant so a name is always produced.
 */
export function translatedSourceBaseName(sourceItem: any): string {
  const raw = String(
    sourceItem?.attachmentFilename ?? sourceItem?.getFilePath?.() ?? "",
  );
  const file = raw.split(/[\\/]/).pop() ?? "";
  const base = file.replace(/\.pdf$/i, "").trim();
  return base || "pdf";
}

/**
 * Disk file base name for the translated copy: the original name with a
 * Translated_ prefix, so the two PDFs in the parent's storage area can never
 * be confused (Zotero's default naming would give them identical names).
 */
export function translatedFileBaseName(sourceItem: any): string {
  return `Translated_${translatedSourceBaseName(sourceItem)}`;
}

/**
 * Display title for the translated attachment. MUST keep starting with
 * `Translated (<lang>) (` — splitViewCleanup's TRANSLATION_TITLE_RE and the
 * item-tree menu's inline copy anchor on exactly that shape for dedup and
 * split-reuse. The source base name is appended so the library row names
 * which paper this translation belongs to.
 */
export function translatedTitleWithSource(
  lang: string,
  sourceBaseName: string,
): string {
  return `Translated (${lang}) · ${sourceBaseName}`;
}

/** Merge `uri` into the item's dc:relation list (keeps other predicates). */
function addDcRelation(item: any, uri: string): void {
  const relations: Record<string, unknown> = { ...(item.getRelations?.() || {}) };
  const prev = relations["dc:relation"];
  const list: string[] = Array.isArray(prev)
    ? prev.slice()
    : prev
      ? [String(prev)]
      : [];
  if (!list.includes(uri)) list.push(uri);
  relations["dc:relation"] = list;
  item.setRelations(relations);
}

/**
 * 找出这篇源 PDF 之前生成的译文附件（用于「重译时替换旧的」）。
 *
 * 背景（实机 2026-10-22）：每次重新翻译都会再导入一个同名附件，用户重跑几次
 * 后同一条目下堆出 6 个「Translated (zh-CN) · … · 部分译文（5 段失败）」，删掉
 * 一个、下一次运行又补一个，看起来像「删了反而变多」。
 *
 * 只认我们自己的产物：标题符合 `Translated (…)` / `译文 (…)`，并且**带有「译文」
 * 标签或与源条目存在 dc:relation 关联**。用户改过名的、手工加的 PDF 不会被误删。
 */
export function findSupersededTranslations(
  sourceItem: any,
  parentItemID: number | null | undefined,
  keepItemID?: number,
): any[] {
  try {
    const Z = (globalThis as any).Zotero;
    const titleRe = /^(?:译文|Translated)\s*\(/i;
    const candidates: any[] = [];
    if (parentItemID != null) {
      const parent = Z?.Items?.get?.(parentItemID);
      for (const id of parent?.getAttachments?.() ?? []) {
        const att = Z?.Items?.get?.(id);
        if (att && !att.deleted) candidates.push(att);
      }
    }
    const relation = sourceItem?.getRelations?.()?.["dc:relation"];
    if (relation) {
      // 顶层附件的译文没有父条目，只能靠反向关联找到。
      const list: string[] = Array.isArray(relation) ? relation : [String(relation)];
      for (const uri of list) {
        const id = Number(String(uri).split("/").pop());
        const att = Number.isInteger(id) ? Z?.Items?.get?.(id) : null;
        if (att && !att.deleted) candidates.push(att);
      }
    }
    const tag = getString("translated-tag");
    const seen = new Set<number>();
    return candidates.filter((att: any) => {
      if (!att?.isAttachment?.()) return false;
      if (att.attachmentContentType !== "application/pdf") return false;
      if (!titleRe.test(att.getField?.("title") || "")) return false;
      const ours =
        (tag && (att.getTags?.() ?? []).some((t: any) => t?.tag === tag)) ||
        Boolean(relation);
      if (!ours) return false;
      if (att.id === keepItemID) return false;
      if (seen.has(att.id)) return false;
      seen.add(att.id);
      return true;
    });
  } catch (e) {
    safeDebug("[文献译读] translatedAttachment: superseded lookup failed: " + e);
    return [];
  }
}

/** 把被新译文取代的旧附件放进回收站（可恢复，不是永久删除）。 */
export async function trashSupersededTranslations(
  sourceItem: any,
  parentItemID: number | null | undefined,
  keepItemID: number,
): Promise<number> {
  const stale = findSupersededTranslations(sourceItem, parentItemID, keepItemID);
  let removed = 0;
  for (const att of stale) {
    try {
      att.deleted = true;
      await att.saveTx();
      removed++;
    } catch (e) {
      safeDebug("[文献译读] translatedAttachment: could not trash old translation: " + e);
    }
  }
  return removed;
}

export async function importTranslatedBytes(bytes: Uint8Array,
  parentItemID: number | null | undefined,
  title: string,
  sourceItem?: any,
): Promise<any> {
  const tmpDir = (Zotero as any).getTempDirectory();
  const tmpFile = tmpDir.clone();
  tmpFile.append(`wenxianyidu-translated-${Date.now()}.pdf`);

  try {
    const IOUtils = (globalThis as any).IOUtils;
    if (!IOUtils || typeof IOUtils.write !== "function") {
      throw new Error("IOUtils.write unavailable — cannot write temp PDF");
    }
    await IOUtils.write(tmpFile.path, bytes);

    // importFromFile without parentItemID creates a top-level attachment item.
    // fileBaseName pins the disk name to Translated_<original>.pdf — without
    // it Zotero names both PDFs after the parent item (autoRenameFiles), and
    // the two files in storage become indistinguishable.
    const importOptions: Record<string, unknown> = {
      file: tmpFile,
      fileBaseName: translatedFileBaseName(sourceItem),
    };
    if (parentItemID != null) importOptions.parentItemID = parentItemID;
    const attachment = await (Zotero as any).Attachments.importFromFile(importOptions);

    // Give it a recognizable title so it's distinguishable from the source PDF
    // and so future re-translations could detect an existing translation.
    // Also link translation ↔ source via dc:relation (both directions, like
    // Zotero's Related pane) — the only way dedup finds translations of
    // top-level sources, which have no parent item to scan. The「译文」tag is
    // the at-a-glance library marker (item pane + tags column + tag selector).
    // All best-effort: a failed mark only costs identification, never the
    // translation itself.
    try {
      attachment.setField("title", title);
      const tag = getString("translated-tag");
      if (tag) attachment.addTag(tag);
      const URI = (Zotero as any).URI;
      const sourceURI = sourceItem ? URI?.getItemURI?.(sourceItem) : null;
      if (sourceURI) {
        addDcRelation(attachment, sourceURI);
        const translationURI = URI?.getItemURI?.(attachment);
        if (translationURI) addDcRelation(sourceItem, translationURI);
      }
      await attachment.saveTx();
      if (sourceURI) await sourceItem.saveTx();
    } catch (e) {
      safeDebug("[文献译读] translatedAttachment: " + e);
      /* best-effort — title/tag/relation are cosmetic */
    }

    return attachment;
  } finally {
    try {
      if (tmpFile.exists()) tmpFile.remove(false);
    } catch (e) {
      safeDebug("[文献译读] translatedAttachment: " + e);
      /* best-effort cleanup */
    }
  }
}

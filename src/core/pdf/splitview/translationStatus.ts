/**
 * translationStatus — 全文与对照翻译的可见状态（工具栏按钮文案的唯一数据源）。
 *
 * 运行中显示翻译中；完成、失败和取消后恢复翻译，继续/补译保留在菜单中。
 *
 * 这里只存一份内存态 + 一份订阅表，不做持久化：真正的持久记录在
 * `documentJobs`（可跨重启恢复），本模块只负责「此刻界面上该显示什么」。
 * 纯状态、无 Zotero 依赖，便于单测。
 */

export type TranslationPhase =
  // 没有进行中的翻译，也没有待续的失败/取消任务。
  | "idle"
  // 正在跑（done/total 可能暂时为 0，解析阶段还没算出总段数）。
  | "running"
  // 用户取消：任务记录已落盘，可继续。
  | "cancelled"
  // 处理失败（解析/排版/异常）：任务记录已落盘，可继续或重试。
  | "failed"
  // 译完了但有失败段落：可「继续翻译」补齐。
  | "partial"
  // 全部译完且无失败。
  | "complete";

export interface TranslationStatus {
  phase: TranslationPhase;
  /** 已译完的段数。 */
  done: number;
  /** 总段数；解析阶段可能还是 0。 */
  total: number;
  /** 失败段数。 */
  failed: number;
  /** 状态对应的源 PDF 条目 id（用于「这是哪个文档的进度」）。 */
  sourceItemID: number | null;
  /** 源条目标题，用于按钮 tooltip。 */
  title: string;
  message?: string;
}

export const INITIAL_TRANSLATION_STATUS: TranslationStatus = Object.freeze({
  phase: "idle",
  done: 0,
  total: 0,
  failed: 0,
  sourceItemID: null,
  title: "",
});

let current: TranslationStatus = { ...INITIAL_TRANSLATION_STATUS };
const documents = new Map<number, TranslationStatus>();
const listeners = new Set<(status: TranslationStatus) => void>();

/** 当前可见状态（副本，调用方改不坏内部值）。 */
export function getTranslationStatus(sourceItemID?: number): TranslationStatus {
  return { ...(sourceItemID === undefined
    ? current
    : documents.get(sourceItemID) ?? INITIAL_TRANSLATION_STATUS) };
}

/** 合并更新并通知订阅者（异常隔离：一个订阅者抛错不影响其他人）。 */
export function updateTranslationStatus(patch: Partial<TranslationStatus>): void {
  current = { ...current, ...patch };
  const snapshot = { ...current };
  if (snapshot.sourceItemID !== null) documents.set(snapshot.sourceItemID, snapshot);
  for (const fn of [...listeners]) {
    try {
      fn(snapshot);
    } catch {
      /* 订阅者自身的错不该打断翻译流程 */
    }
  }
}

/** 回到初始态（新任务开始前 / 完成后清场）。 */
export function resetTranslationStatus(): void {
  documents.clear();
  updateTranslationStatus({ ...INITIAL_TRANSLATION_STATUS });
}

/** Release ended reading sessions; running jobs remain visible across tab closes. */
export function releaseTranslationSession(sourceItemID: number): void {
  const status = documents.get(sourceItemID);
  if (status?.phase === "running") return;
  documents.delete(sourceItemID);
  if (current.sourceItemID === sourceItemID) current = { ...INITIAL_TRANSLATION_STATUS };
  for (const listener of [...listeners]) { try { listener({ ...INITIAL_TRANSLATION_STATUS, sourceItemID }); } catch { /* isolate */ } }
}

/** 订阅状态变化，返回退订函数。 */
export function subscribeTranslationStatus(
  fn: (status: TranslationStatus) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 是否该提供「继续翻译」：取消、失败、部分完成后都能从任务记录续上
 * （`documentJobs.prepareDocumentJob` 会带回 done/total/failed，缓存命中已译段落）。
 */
export function isResumableStatus(status: TranslationStatus): boolean {
  return (
    status.phase === "cancelled" ||
    status.phase === "failed" ||
    status.phase === "partial"
  );
}

/**
 * 按钮主文案（不含尾部「▾」和失败后缀）。`t` 传 getString，便于单测替换。
 *   idle/complete → 「翻译」
 *   running       → 「翻译中 7/18」/（还不知总段数时）「翻译中…」
 *   cancelled/failed → 「翻译」
 *   partial       → 「翻译」
 */
export function toolbarButtonText(
  status: TranslationStatus,
  t: (id: string, args?: Record<string, unknown>) => string,
): string {
  switch (status.phase) {
    case "running":
      return status.total > 0
        ? t("toolbar-progress-running", {
            done: status.done,
            total: status.total,
          })
        : t("toolbar-progress-starting");
    default:
      return t("toolbar-title");
  }
}

/**
 * 失败段数后缀（含前导分隔符），没有失败段落时返回空串。
 * 单独拆出来是为了窄窗（<680px）能用纯 CSS 隐藏它，按钮不至于被撑爆。
 */
export function toolbarFailureSuffix(
  status: TranslationStatus,
  t: (id: string, args?: Record<string, unknown>) => string,
): string {
  if (status.failed <= 0) return "";
  // running 时进度与失败数同时显示；partial 的主文案已经是失败数，不重复。
  if (status.phase !== "running") return "";
  return ` · ${t("toolbar-progress-failed", { failed: status.failed })}`;
}

export function releaseInactiveTranslationSessions(openItems: Set<number>): void {
  for (const id of [...documents.keys()]) if (!openItems.has(id)) releaseTranslationSession(id);
}

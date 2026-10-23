/**
 * progressRow — 单个「原地更新」的进度行。
 *
 * 背景（实机 2026-10-22）：`Zotero.ProgressWindow.addDescription(text)` 每次调用
 * 都会**追加一行**。而组件下载每个网络分片回调一次（40 MB 的 JRE 可达数百次）、
 * 全文流水线每译完一段回调一次，于是进度窗口里堆出几十行「下载中 4%」「下载中
 * 5%」的历史记录，把窗口撑成一条长列表，用户既看不出当前进度也读不到结论。
 *
 * Zotero 自己的长任务用的是 `ProgressWindow.ItemProgress`：一行文字 + 一个环形
 * 进度指示，后续只更新这一行的文字与百分比。本模块把它包成小接口，窗口不可用
 * 时退化为追加描述（保持旧行为，绝不因为 UI 失败中断下载或翻译）。
 */

const ownedProgress = new Set<any>();
/** Never enumerate/close host or other add-ons' windows. */
export function createOwnedProgressWindow(options?: any): any {
  const progress = new (globalThis as any).Zotero.ProgressWindow({ ...options, closeOnClick: true });
  ownedProgress.add(progress);
  let dismissed = false;
  const show = progress.show.bind(progress);
  progress.show = () => dismissed ? false : show();
  const close = progress.close.bind(progress);
  progress.close = () => { dismissed = true; ownedProgress.delete(progress); close(); };
  return progress;
}
export function closeOwnedProgressWindows(): void {
  for (const progress of [...ownedProgress]) { try { progress.close(); } catch { /* host closed */ } }
  ownedProgress.clear();
}

export interface ProgressRow {
  /** 更新这一行的文字。 */
  setText(text: string): void;
  /** 更新这一行的环形进度（0–100，内部钳制并避免 0 时不画弧）。 */
  setProgress(percent: number): void;
  /** 结束：可选替换为结论文字，并把进度标记为完成。 */
  complete(text?: string): void;
}

export function createProgressRow(
  progress: any,
  initialText: string,
): ProgressRow {  let row: any = null;
  try {
    // itemType = null：不带 Zotero 条目类型图标，只保留文字与进度弧。
    row = new progress.ItemProgress(null, initialText);
  } catch {
    row = null;
  }
  const append = (text: string) => {
    try {
      progress.addDescription(text);
    } catch {
      /* 窗口已关闭 —— 进度永远不能影响主流程 */
    }
  };
  return {
    setText(text: string) {
      try {
        if (row) row.setText(text);
        else append(text);
      } catch {
        /* 窗口已关闭 */
      }
    },
    setProgress(percent: number) {
      try {
        if (!row) return;
        const value = Math.max(1, Math.min(100, Math.round(percent)));
        row.setProgress(value);
      } catch {
        /* 窗口已关闭 */
      }
    },
    complete(text?: string) {
      try {
        if (text) {
          if (row) row.setText(text);
          else append(text);
        }
        row?.setProgress(100);
      } catch {
        /* 窗口已关闭 */
      }
    },
  };
}

/**
 * 让进度窗口在任务结束后自己消失。
 *
 * 只调 `startCloseTimer` 不够稳：其内部条件（窗口是否加载完成、是否有悬停）在
 * 长任务里可能不满足，实机出现过「翻译已经完成、窗口堆满历史行并一直留在屏幕
 * 上」。这里再排一个硬关闭作为兜底，用户既能看到结论，也不会被窗口挡住阅读区。
 */
export function scheduleProgressClose(progress: any, ms: number): void {
  try {
    progress?.startCloseTimer?.(ms);
  } catch {
    /* 窗口已关闭 */
  }
  try {
    const win = (globalThis as any).Zotero?.getMainWindow?.();
    win?.setTimeout?.(() => {
      try {
        progress?.close?.();
      } catch {
        /* 已关闭 */
      }
    }, ms + 2500);
  } catch {
    /* 没有可用窗口 */
  }
}

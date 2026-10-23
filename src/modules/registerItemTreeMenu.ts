import { updateTranslationStatus } from "../core/pdf/splitview/translationStatus";
import { ensureEngineAvailable } from "../core/translation/engineSelection";
/**
 * registerItemTreeMenu — library item context-menu entries for the PDF
 * translation flows.
 *
 * Four entries (all checkbox-typed: a checkmark marks the live state — an
 * active bilingual session or an open split tab on the selected PDF):
 *   - 「翻译全文（生成译文附件）」— runs the pipeline with outcome "attachment"
 *     (auto-opens the result);
 *   - 「翻译并分屏对照」— the existing split-view flow from the library;
 *   - 「上下对照双语阅读」/「仅译文双语阅读」— the shared bilingual launcher
 *     (same lifecycle as the reader context menu and the sidebar).
 *
 * Host API reality (verified against Zotero 7.0.15 and 10.x source):
 *   - Zotero 10 has Zotero.MenuManager.registerMenu but NOT
 *     ItemTreeManager.registerMenuItem;
 *   - Zotero 7.0.15 has NEITHER — plugins inject into the `zotero-itemmenu`
 *     popup directly (zotero-pdf2zh's approach).
 * So this module uses ONE code path — DOM injection into `zotero-itemmenu`
 * with a popupshowing visibility gate — which works identically on both. When
 * MenuManager becomes detectable we could migrate. Direct injection must
 * preserve native child positions because the host updates them by index.
 *
 * Loaded dynamically by src/hooks.ts (onMainWindowLoad / onStartup), tracked
 * and revoked by onShutdown.
 *
 * @module modules/registerItemTreeMenu
 */

import { getString } from "../utils/locale";
import { safeDebug } from "../utils/logger";
import { toErrorMessage } from "../utils/error";
import { alertDialog } from "../utils/dialog";
import { createOwnedProgressWindow, createProgressRow, scheduleProgressClose } from "../utils/progressRow";
import {
  translateAndSplitWithOpenDataLoader,
} from "../core/pdf/translation/opendataloaderSplitAdapter";
import {
  friendlyOdlError,
  isJavaMissingCause,
  handleMissingJava,
} from "../core/pdf/splitview/splitViewFactory";
import {
  findExistingTranslation,
  findTranslationByRelation,
  findSplitTabForItem,
} from "../core/pdf/splitview/splitViewCleanup";
import {
  getActiveBilingualModeForItem,
  startBilingualSessionByItemID,
} from "../core/pdf/sdt/bilingualLauncher";

const MENU_ID = "wenxianyidu-itemmenu";
const SEP_ID = "wenxianyidu-itemmenu-sep";

interface TrackedWindow {
  win: any;
  popup: any;
  menu: any;
  separator: any;
  onShowing: EventListener;
}

const tracked: TrackedWindow[] = [];
let registered = false;

/**
 * All PDF attachments in the selection, in selection order: the item itself
 * when it is a PDF, otherwise every PDF among its child attachments.
 */
function resolveAllSourcePdfAttachments(items: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<number>();
  for (const item of items || []) {
    if (!item) continue;
    try {
      if (item.isAttachment?.() && item.attachmentContentType === "application/pdf") {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          out.push(item);
        }
        continue;
      }
      const attIDs: number[] = item.getAttachments?.() || [];
      for (const id of attIDs) {
        if (seen.has(id)) continue;
        const att = (globalThis as any).Zotero?.Items?.get?.(id);
        if (att?.attachmentContentType === "application/pdf") {
          seen.add(id);
          out.push(att);
        }
      }
    } catch (e) {
      safeDebug(
        `[文献译读] resolveAllSourcePdfAttachments scan error: ${e}`,
      );
      /* not an item we understand — keep scanning */
    }
  }
  return out;
}

/** Pick the first PDF attachment from the current selection. */
function resolveSourcePdfAttachment(items: any[]): any | null {
  return resolveAllSourcePdfAttachments(items)[0] || null;
}

function selectionHasPdf(items: any[]): boolean {
  return resolveSourcePdfAttachment(items) != null;
}

/**
 * True when a translation attachment already sits under the source's parent
 * (title convention: the adapter produces `Translated (lang)`; legacy
 * `译文 (…)` still counts), or when the source carries a dc:relation link to
 * one (the only path for top-level sources). Used to skip duplicate
 * translations.
 */
function hasExistingTranslation(sourceItem: any): boolean {
  try {
    const parentID = sourceItem?.parentItemID;
    if (parentID != null) {
      const parent = (globalThis as any).Zotero?.Items?.get?.(parentID);
      const attIDs: number[] = parent?.getAttachments?.() || [];
      const re = /^(译文|Translated)\s*\(/i;
      if (attIDs.some((id) => re.test(
        (globalThis as any).Zotero?.Items?.get?.(id)?.getField?.("title") || "",
      ))) {
        return true;
      }
    }
    return findTranslationByRelation(sourceItem) != null;
  } catch {
    return false;
  }
}

/**
 * Open an attachment in the host window; on failure (missing ZoteroPane API or
 * viewAttachment throwing) tell the user instead of failing silently.
 * Returns true when the attachment was opened.
 */
function openAttachmentOrAlert(win: any, attachmentId: number): boolean {
  try {
    const pane = win?.ZoteroPane;
    if (typeof pane?.viewAttachment === "function") {
      pane.viewAttachment(attachmentId);
      return true;
    }
  } catch (e) {
    safeDebug("[文献译读] itemTreeMenu viewAttachment: " + e);
  }
  alertDialog(getString("app-title"), getString("itemtree-open-failed"), win);
  return false;
}

/**
 * Run the pipeline for every selected PDF, serially. Single selection keeps
 * the exact previous behavior; multi selection labels each progress window
 * with its ordinal and keeps going when one item fails.
 */
async function runPipelines(
  win: any,
  sources: any[],
  outcome: "attachment" | "split",
): Promise<void> {
  if (sources.length === 0) return;
  if (sources.length === 1) {
    await runPipeline(win, sources[0], outcome);
    return;
  }
  for (let i = 0; i < sources.length; i++) {
    try {
      await runPipeline(win, sources[i], outcome, `${i + 1}/${sources.length}`);
    } catch (e) {
      // runPipeline handles its own errors; this guard just guarantees one
      // failure can't stop the remaining items.
      safeDebug(`[文献译读] itemTreeMenu batch item failed: ${e}`);
    }
  }
}

/**
 * Run the pipeline for one source PDF. Shared by both menu items — they differ
 * only in outcome ("attachment" vs "split") and dedup behavior.
 */
async function runPipeline(
  win: any,
  sourceItem: any,
  outcome: "attachment" | "split",
  label?: string,
): Promise<void> {
  if (!await ensureEngineAvailable()) return;
  const Zotero = (globalThis as any).Zotero;
  const progress = null;
  const row = { setText: (message: string) => updateTranslationStatus({ sourceItemID: sourceItem.id, message }) };
  updateTranslationStatus({ sourceItemID: sourceItem.id, phase: "running", done: 0, total: 0, failed: 0,
    title: String(sourceItem.getField?.("title") || ""), message: getString(outcome === "attachment" ? "itemtree-progress-attachment" : "odl-progress-translating") });

  try {
    // Deduplication and resumption are shared by the document pipeline.
    await translateAndSplitWithOpenDataLoader({
      sourceItem,
      // The split outcome opens the side-by-side reader through the same
      // factory the pre-existing ODL menu uses; without it the pipeline
      // aborts with "分屏打开器不可用" (found in the README-shot round —
      // the menu item produced an attachment-like flow and no split view).
      openSplitView: (async (win2: any, item: any, att: any) => {
        const { openSplitView } = await import("../core/pdf/splitview/splitViewFactory");
        return openSplitView(win2, item, att);
      }) as any,
      onProgress: (msg: string) => {
        try {
          row.setText(msg);
          // The window panel carries progress.
        } catch {
          /* progress window closed */
        }
      },
      onCheckpoint: job => updateTranslationStatus({ sourceItemID: sourceItem.id, phase: job.status === "running" ? "running" : job.status === "partial" ? "partial" : job.status === "complete" ? "complete" : job.status === "cancelled" ? "cancelled" : "failed", done: job.done, total: job.total, failed: job.failed }),
      outcome,
      openAttachment: (attachmentId: number) => {
        openAttachmentOrAlert(win, attachmentId);
      },
    });
    scheduleProgressClose(progress, 6000);
  } catch (e: any) {
    if (e?.name === "WenxianYiduCancelled") {
      row.setText("已取消翻译；已完成段落已保留，可在“翻译任务”中继续。");
      scheduleProgressClose(progress, 5000);
      return;
    }
    // 10 s, matching the reader entry point — 2 s was too short to read the
    // "✗" line (the modal dialog below is the real carrier, this is backup).
    scheduleProgressClose(progress, 10000);
    const raw = toErrorMessage(e);
    // Structured reason first (isJavaMissingCause) — the preflight error's
    // message is a pinned English hint with the localized detail dropped, and
    // shell-wrapped/JVM-crash texts defeat signature matching.
    if (isJavaMissingCause(e)) {
      await handleMissingJava();
      return;
    }
    const friendly = friendlyOdlError(raw);
    safeDebug(`[文献译读] itemTreeMenu pipeline failed: ${raw}`);
    try {
      row.setText("✗ " + friendly);
    } catch {
      /* progress window already closed */
    }
    alertDialog(getString("app-title"), friendly, win);
  }
}

function injectIntoWindow(win: any): boolean {
  try {
    const doc = win.document;
    const popup = doc.getElementById("zotero-itemmenu");
    if (!popup || doc.getElementById(MENU_ID)) return false;

    const menu = doc.createXULElement("menu");
    menu.id = MENU_ID;
    // Label via getString (our Localization instance) — deliberately NOT
    // data-l10n-id: the menu is JS-injected, and a DOM overlay id that the
    // checker cannot statically resolve is worse than a static label set at
    // creation time (initLocale has already run by then).
    menu.setAttribute("label", getString("itemtree-menu"));

    const menupopup = doc.createXULElement("menupopup");
    menu.appendChild(menupopup);

    const mkItem = (id: string, l10nKey: string, handler: () => void): any => {
      const mi = doc.createXULElement("menuitem");
      mi.id = id;
      mi.setAttribute("label", getString(l10nKey));
      // Checkbox type + per-showing `checked` writes (see onShowing) give the
      // entries Zotero's native checkmark while their state is live. XUL
      // auto-toggles the visual state on click, but the menu closes on click
      // and the next popupshowing re-asserts the truth, so it self-corrects.
      mi.setAttribute("type", "checkbox");
      mi.setAttribute("checked", "false");
      mi.addEventListener("command", handler);
      return mi;
    };

    // Visibility gate: only show the submenu when the selection contains a PDF.
    const onShowing = ((event: Event) => {
      try {
        if (event.target !== popup) return; // nested popups also fire here
        const zp = win.ZoteroPane || win.wrappedJSObject?.ZoteroPane;
        const items: any[] = zp?.itemsView?.getSelectedItems?.() || [];
        const show = selectionHasPdf(items);
        menu.setAttribute("hidden", show ? "false" : "true");
        // The leading separator must follow the menu — otherwise an orphan
        // divider stays visible whenever the submenu hides.
        separator.setAttribute("hidden", show ? "false" : "true");
        // Refresh our label only. Native menu positions must remain unchanged:
        // Zotero's buildItemContextMenu updates labels by childNodes[index].
        menu.setAttribute("label", getString("itemtree-menu"));

        // Checkmark state, recomputed on every showing so it can never go
        // stale: the bilingual entries checkmark only while the single live
        // session runs on the selected PDF, the split entry while any split
        // tab shows it. 「翻译全文」 produces an attachment, not a live state —
        // never checkmarked. resolveSourcePdfAttachment already returns the
        // FIRST attachment — do not index it again.
        const source = resolveSourcePdfAttachment(items);
        const liveMode = getActiveBilingualModeForItem(source?.id);
        const splitOpen = source
          ? findSplitTabForItem(source.id) != null
          : false;
        translateAttachment.setAttribute("checked", "false");
        translateSplit.setAttribute("checked", splitOpen ? "true" : "false");
        interleaveItem.setAttribute(
          "checked",
          liveMode === "interleave" ? "true" : "false",
        );
        transOnlyItem.setAttribute(
          "checked",
          liveMode === "transOnly" ? "true" : "false",
        );
      } catch (e) {
        safeDebug("[文献译读] itemTreeMenu onShowing: " + e);
      }
    }) as EventListener;

    const translateAttachment = mkItem(
      "wenxianyidu-itemmenu-attachment",
      "itemtree-translate-attachment",
      () => {
        const zp = win.ZoteroPane || win.wrappedJSObject?.ZoteroPane;
        const items: any[] = zp?.itemsView?.getSelectedItems?.() || [];
        void runPipelines(win, resolveAllSourcePdfAttachments(items), "attachment");
      },
    );
    const translateSplit = mkItem(
      "wenxianyidu-itemmenu-split",
      "itemtree-translate-split",
      () => {
        const zp = win.ZoteroPane || win.wrappedJSObject?.ZoteroPane;
        const items: any[] = zp?.itemsView?.getSelectedItems?.() || [];
        void runPipelines(win, resolveAllSourcePdfAttachments(items), "split");
      },
    );
    // Bilingual launch with visible feedback: the reader-menu path shows a
    // progress window, and this path used to run SILENTLY — a reader that
    // wasn't ready, an SDT view that failed to build or an engine error all
    // left nothing but the freshly opened plain reader (the user-facing
    // symptom of issue "双语菜单只是打开了阅读器"). Mirror the reader path:
    // progress while preparing, done/failed lines, and a disclosure message
    // when the document-structure session can't be established at all.
    const runBilingual = async (mode: "interleave" | "transOnly"): Promise<void> => {
      if (!await ensureEngineAvailable()) return;
      const Zotero = (globalThis as any).Zotero;
      const zp = win.ZoteroPane || win.wrappedJSObject?.ZoteroPane;
      const progress = createOwnedProgressWindow({ window: win });
      progress.changeHeadline(getString("app-title"));
      // 段落队列每译完一段回调一次：用一行原地更新进度，不堆历史记录。
      const row = createProgressRow(progress, getString("itemtree-launch-progress"));
      progress.show();
      try {
        const source = resolveSourcePdfAttachment(
          zp?.itemsView?.getSelectedItems?.() || [],
        );
        if (!source) {
          progress.startCloseTimer?.(2000);
          return;
        }
        const handle = await startBilingualSessionByItemID({
          win,
          itemID: source.id,
          mode,
          onProgress: (stats) => {
            try {
              row.setText(
                getString("bilingual-progress", {
                  done: stats.done,
                  total: stats.total,
                }),
              );
              // The window panel carries progress.
            } catch {
              /* progress window closed */
            }
          },
        });
        if (!handle) {
          row.setText(getString("bilingual-sdt-missing"));
          scheduleProgressClose(progress, 8000);
          return;
        }
        if (handle.stats().total === 0) {
          // Scanned / text-layer-less PDF: an empty session would otherwise
          // report "done" over a document with nothing in it.
          row.setText(getString("bilingual-no-text"));
          progress.startCloseTimer?.(8000);
          return;
        }
        row.complete(getString("itemtree-launch-done"));
        scheduleProgressClose(progress, 3000);
      } catch (e) {
        safeDebug(`[文献译读] itemTreeMenu bilingual (${mode}) failed: ${e}`);
        try {
          row.setText("✗ " + toErrorMessage(e));
          progress.startCloseTimer?.(8000);
        } catch {
          /* progress window already closed */
        }
      }
    };
    const interleaveItem = mkItem(
      "wenxianyidu-itemmenu-interleave",
      "itemtree-interleave",
      async () => {
        const source = resolveSourcePdfAttachment(
          (win.ZoteroPane || win.wrappedJSObject?.ZoteroPane)?.itemsView
            ?.getSelectedItems?.() || [],
        );
        if (!source) return;
        openAttachmentOrAlert(win, source.id);
        await runBilingual("interleave");
      },
    );
    const transOnlyItem = mkItem(
      "wenxianyidu-itemmenu-trans-only",
      "itemtree-trans-only",
      async () => {
        const source = resolveSourcePdfAttachment(
          (win.ZoteroPane || win.wrappedJSObject?.ZoteroPane)?.itemsView
            ?.getSelectedItems?.() || [],
        );
        if (!source) return;
        openAttachmentOrAlert(win, source.id);
        await runBilingual("transOnly");
      },
    );

    menupopup.appendChild(translateAttachment);
    menupopup.appendChild(translateSplit);
    menupopup.appendChild(interleaveItem);
    menupopup.appendChild(transOnlyItem);

    const separator = doc.createXULElement("menuseparator");
    separator.id = SEP_ID;

    // Zotero indexes the original menu children when assigning labels and
    // visibility. Prepending two nodes made its "Move to Trash" label land on
    // the native Duplicate command: deleting appeared to create more items.
    // Keep all native indices intact and append our own group at the end.
    popup.appendChild(separator);
    popup.appendChild(menu);

    popup.addEventListener("popupshowing", onShowing);

    tracked.push({ win, popup, menu, separator, onShowing });
    return true;
  } catch (e) {
    safeDebug("[文献译读] registerItemTreeMenu inject failed: " + e);
    return false;
  }
}

/**
 * Register the library item context-menu entries for every open main window.
 * Idempotent per window; called from hooks.onStartup and onMainWindowLoad.
 */
export function registerItemTreeMenu(): void {
  if (registered) return;
  try {
    const Zotero = (globalThis as any).Zotero;
    const wins: any[] = Zotero?.getMainWindows?.() || [];
    let any = false;
    for (const win of wins) any = injectIntoWindow(win) || any;
    if (any) registered = true;
    safeDebug(`[文献译读] itemTreeMenu registered (windows: ${wins.length})`);
  } catch (e) {
    safeDebug("[文献译读] registerItemTreeMenu failed: " + e);
  }
}

/** Register for one newly opened main window (hooks.onMainWindowLoad). */
export function registerItemTreeMenuForWindow(win: any): void {
  if (!win || tracked.some((t) => t.win === win)) return;
  injectIntoWindow(win);
}

/**
 * Revoke one window's injected menu (main-window unload). Removes the tracked
 * entry and its injected nodes/listener; no-op when the window isn't tracked.
 */
export function unregisterItemTreeMenuForWindow(win: any): void {
  const idx = tracked.findIndex((t) => t.win === win);
  if (idx === -1) return;
  const t = tracked[idx];
  tracked.splice(idx, 1);
  try {
    t.popup.removeEventListener("popupshowing", t.onShowing);
    t.menu.remove();
    t.separator.remove();
  } catch (e) {
    safeDebug("[文献译读] unregisterItemTreeMenuForWindow: " + e);
  }
}

/** Revoke all injected menus (plugin shutdown). */
export function unregisterItemTreeMenu(): void {
  while (tracked.length > 0) {
    unregisterItemTreeMenuForWindow(tracked[0].win);
  }
  registered = false;
}

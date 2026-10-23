import { releaseInactiveTranslationSessions } from "./core/pdf/splitview/translationStatus";
import { cancelOfflinePreparation, stopOfflineService } from "./core/translation/offlineManager";
import { closeOwnedProgressWindows } from "./utils/progressRow";
let readingSessionObserver: any;
import { initLocale } from "./utils/locale";
import { safeDebug } from "./utils/logger";
import { toErrorMessage } from "./utils/error";
import { migratePrefs } from "./utils/prefMigrations";
import { migrateCredentials } from "./utils/credentials";
import { registerDocumentTasks, registerDocumentTasksForWindow, unregisterDocumentTasks, unregisterDocumentTasksForWindow } from "./modules/registerDocumentTasks";

/**
 * Plugin startup.
 *
 * Order matters: wait for Zotero to finish initializing (the promises are what
 * the bootstrap guarantees are resolvable) → register the Fluent sources →
 * hand over to the UI registration module → register the reader context-menu
 * entry points of the PDF split-view pipeline.
 */
async function onStartup() {
  await Promise.allSettled([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // 偏好结构迁移（src/utils/prefMigrations.ts）：Zotero 已在此前应用完
  // prefs.js 默认值，是执行迁移的正确时机；迁移内部自防御，失败只记录，
  // 绝不阻断后续 UI 注册。
  migratePrefs();
  try { await migrateCredentials(); } catch { safeDebug("[文献译读] 安全凭据迁移未完成，请在设置中重新保存密钥。"); }

  // Re-entrancy latch: some hosts fire onStartup more than once per process
  // (main-window reload), and re-running the UI registration would double
  // register the menu entries / reader sections.
  if (_globalThis.addon.data.initialized) {
    safeDebug("[文献译读] already initialized, skipping repeated startup");
    return;
  }

  readingSessionObserver = (Zotero as any).Notifier?.registerObserver?.({ notify(action: string) {
    if (action !== "close") return;
    setTimeout(() => {
      const open = new Set<number>();
      for (const win of (Zotero as any).getMainWindows?.() ?? []) for (const tab of win.Zotero_Tabs?._tabs ?? []) if (tab.data?.itemID) open.add(tab.data.itemID);
      releaseInactiveTranslationSessions(open);
    }, 0);
  } }, ["tab"], "wenxianyidu-reading-session");

  try {
    const input = await import("./modules/registerInputTranslation");
    input.registerInputTranslation();
    registerDocumentTasks();
  } catch { safeDebug("[文献译读] 输入翻译入口加载失败。"); }

  // Translation UI belongs to the window panel; revoke the retired item section.
  try {
    const mod = await import("./modules/registerTranslateUI");
    if (typeof mod?.registerTranslateUI === "function") {
      mod.registerTranslateUI();
    } else {
      safeDebug(
        "[文献译读] ./modules/registerTranslateUI exports no registerTranslateUI() — UI not registered",
      );
    }
  } catch (e) {
    safeDebug(
      `[文献译读] ./modules/registerTranslateUI unavailable: ${toErrorMessage(e)}`,
    );
  }

  // Register reader menu entries; each action checks its own dependencies.
  try {
    const mod = await import("./core/pdf/splitview/splitViewFactory");
    mod.registerReaderContextMenu();
  } catch (e) {
    safeDebug(
      `[文献译读] ./core/pdf/splitview/splitViewFactory unavailable: ${toErrorMessage(e)}`,
    );
  }

  // Library item context-menu entries (translate-to-attachment + split).
  try {
    const mod = await import("./modules/registerItemTreeMenu");
    mod.registerItemTreeMenu();
  } catch (e) {
    safeDebug(
      `[文献译读] ./modules/registerItemTreeMenu unavailable: ${toErrorMessage(e)}`,
    );
  }

  // Reader-toolbar entry: 「翻译 ▾」with split / interlinear / translation-only /
  // selection / input / cancel / settings. Same pipeline as the context menu —
  // see src/modules/registerReaderToolbar.ts.
  try {
    const mod = await import("./modules/registerReaderToolbar");
    mod.registerReaderToolbar();
  } catch (e) {
    safeDebug(
      `[文献译读] ./modules/registerReaderToolbar unavailable: ${toErrorMessage(e)}`,
    );
  }

  // Word-cards entry points: the reader-toolbar listener (global, once per
  // plugin lifecycle) plus library toolbar buttons for windows that already
  // exist; windows opened later are covered by onMainWindowLoad. Each button
  // preflights its own anchor and degrades to a log — see
  // src/modules/registerWordCardsUI.ts.
  try {
    const mod = await import("./modules/registerWordCardsUI");
    mod.registerWordCardsUI();
  } catch (e) {
    safeDebug(
      `[文献译读] ./modules/registerWordCardsUI unavailable: ${toErrorMessage(e)}`,
    );
  }

  // Fire-and-forget cache maintenance (prune is LRU, size from prefs).
  void (async () => {
    try {
      const { getPrefDynamic } = await import("./utils/prefs");
      const { pruneCache } = await import("./core/translation/translationCache");
      const maxMB = Number(getPrefDynamic("translate.cache.maxSizeMB")) || 200;
      const removed = await pruneCache(maxMB * 1024 * 1024);
      if (removed > 0) {
        safeDebug(`[文献译读] translation cache pruned: ${removed} files`);
      }
    } catch {
      /* best-effort */
    }
  })();

  _globalThis.addon.data.initialized = true;
}

async function onMainWindowLoad(window: any) {
  registerDocumentTasksForWindow(window);
  try { (await import("./modules/registerInputTranslation")).registerInputTranslationForWindow(window); } catch { /* host closing */ }
  safeDebug(
    `[文献译读] main window loaded: ${window?.location?.href ?? "(unknown)"}`,
  );
  try {
    const mod = await import("./modules/registerItemTreeMenu");
    mod.registerItemTreeMenuForWindow(window);
  } catch {
    /* best-effort */
  }
  // This window's word-cards library toolbar button.
  try {
    const mod = await import("./modules/registerWordCardsUI");
    mod.registerWordCardsUIForWindow(window);
  } catch {
    /* best-effort */
  }
}

async function onMainWindowUnload(window: any) {
  unregisterDocumentTasksForWindow(window);
  try { (await import("./modules/registerInputTranslation")).unregisterInputTranslationForWindow(window); } catch { /* host closing */ }
  safeDebug("[文献译读] main window unloaded");
  // Revoke this window's injected item-tree menu; without this a closed main
  // window leaked its tracked entry (and its injected popup nodes) until full
  // plugin shutdown.
  try {
    const mod = await import("./modules/registerItemTreeMenu");
    mod.unregisterItemTreeMenuForWindow(window);
  } catch (e) {
    safeDebug(
      `[文献译读] ./modules/registerItemTreeMenu unavailable on window unload: ${toErrorMessage(e)}`,
    );
  }
  // Revoke this window's word-cards library toolbar button.
  try {
    const mod = await import("./modules/registerWordCardsUI");
    mod.unregisterWordCardsUIForWindow(window);
  } catch (e) {
    safeDebug(
      `[文献译读] ./modules/registerWordCardsUI unavailable on window unload: ${toErrorMessage(e)}`,
    );
  }
}

async function onShutdown() {
  closeOwnedProgressWindows();
  cancelOfflinePreparation(); stopOfflineService();
  if (readingSessionObserver !== undefined) (Zotero as any).Notifier?.unregisterObserver?.(readingSessionObserver);
  unregisterDocumentTasks();
  try { (await import("./modules/registerInputTranslation")).unregisterInputTranslation(); } catch { /* best effort */ }
  _globalThis.addon.data.alive = false;
  // Revoke the item-pane section. Zotero also auto-removes sections carrying
  // our pluginID, but doing it explicitly keeps a dev "Reload Plugins" in the
  // same process from stacking registrations (the latch in onStartup is
  // per-process and a reload builds a fresh addon.data).
  try {
    const mod = await import("./modules/registerTranslateUI");
    if (typeof mod?.unregisterTranslateUI === "function") {
      mod.unregisterTranslateUI();
    }
  } catch (e) {
    safeDebug(
      `[文献译读] ./modules/registerTranslateUI unavailable on shutdown: ${toErrorMessage(e)}`,
    );
  }
  // Mirror the startup registration: revoke the reader context-menu submenu
  // listener so a plugin reload in the same process cannot stack duplicate
  // menu items.
  try {
    const mod = await import("./core/pdf/splitview/splitViewFactory");
    mod.unregisterReaderContextMenu();
  } catch (e) {
    safeDebug(
      `[文献译读] ./core/pdf/splitview/splitViewFactory unavailable on shutdown: ${toErrorMessage(e)}`,
    );
  }
  // Revoke the library item context-menu injections.
  try {
    const mod = await import("./modules/registerItemTreeMenu");
    mod.unregisterItemTreeMenu();
  } catch {
    /* best-effort */
  }
  // Revoke the reader toolbar listener.
  try {
    const mod = await import("./modules/registerReaderToolbar");
    mod.unregisterReaderToolbar();
  } catch {
    /* best-effort */
  }
  // Revoke the word-cards entry buttons and close an open word-cards tab.
  try {
    const mod = await import("./modules/registerWordCardsUI");
    mod.unregisterWordCardsUI();
  } catch (e) {
    safeDebug(
      `[文献译读] ./modules/registerWordCardsUI unavailable on shutdown: ${toErrorMessage(e)}`,
    );
  }
  // Stop the split-view sync pollers; a live 400ms interval would otherwise
  // survive disable/reload for as long as the user keeps a split tab open.
  try {
    const mod = await import("./core/pdf/splitview/splitViewCleanup");
    mod.stopAllSyncPollers();
  } catch (e) {
    safeDebug(
      `[文献译读] ./core/pdf/splitview/splitViewCleanup unavailable on shutdown: ${toErrorMessage(e)}`,
    );
  }
  // Tear down any active bilingual-control session (timers/DOM in the reader).
  try {
    const mod = await import("./ui/bilingualControl");
    if (typeof mod?.disposeActiveBilingualSession === "function") {
      await mod.disposeActiveBilingualSession();
    }
  } catch (e) {
    safeDebug(
      `[文献译读] ./ui/bilingualControl unavailable on shutdown: ${toErrorMessage(e)}`,
    );
  }
  safeDebug("[文献译读] shutdown");
}

export default {
  onStartup,
  onMainWindowLoad,
  onMainWindowUnload,
  onShutdown,
};

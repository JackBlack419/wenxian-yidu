/**
 * registerWordCardsUI — entries for the Word Cards tab.
 *
 * Three entries, one destination (wordCardsTab#openWordCardsTab):
 *
 *   - A library toolbar button (XUL toolbarbutton) injected into the main
 *     window per window, following registerItemTreeMenu's tracked-window
 *     pattern: idempotent by element id, tracked in a module array, revoked
 *     per window on window unload and wholly on plugin shutdown.
 *   - A「工具 → 生词本」menu item injected into the main window's menubar
 *     Tools popup, same tracked-window pattern (the anchor id is Zotero-
 *     internal; a miss degrades to a debug log).
 *   - A reader toolbar button via Zotero.Reader#registerEventListener
 *     ("renderToolbar"), following splitViewFactory's module-scope handler
 *     pattern (unregister needs the same function reference).
 *
 * None of the anchors are part of a public Zotero API, so each is resolved
 * defensively and a miss degrades to a debug log — the remaining entries still
 * reach the tab, and nothing else in the addon depends on any single one.
 *
 * All entries lazy-import the tab module on first activation, keeping the tab
 * UI (and its stylesheet string) off the startup path.
 */

import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { safeDebug } from "../utils/logger";

/** Element id of the injected library toolbar button (idempotency key). */
const BUTTON_ID = "wenxianyidu-wordcards-button";

/** Element id of the injected Tools-menu item (idempotency key). */
const TOOLS_MENUITEM_ID = "wenxianyidu-tools-wordcards";

/**
 * Tools-menu anchors, by menupopup id then menu id. Both Zotero 7.0.15 and 10
 * use `toolsMenu` + `menu_ToolsPopup` (verified against both hosts' sources);
 * the older-style ids stay in the chain as a defensive fallback.
 */
const TOOLS_POPUP_IDS = ["menu_ToolsPopup", "menu-tools-popup"];
const TOOLS_MENU_IDS = ["toolsMenu", "menu-tools"];

/**
 * Library toolbar anchor candidates, in order of preference. None of these
 * ids are contract — they are Zotero-internal element ids, verified against
 * the running main window during QA.
 */
const TOOLBAR_ANCHOR_IDS = [
  "zotero-items-toolbar",
  "zotero-toolbar",
  "zotero-collections-toolbar",
];

interface TrackedWindow {
  win: any;
  button: any | null;
  toolsItem: any | null;
}

const tracked: TrackedWindow[] = [];

/** Reader-toolbar event handler; module scope because unregister is by reference. */
let readerToolbarHandler: ((event: any) => void) | null = null;

/**
 * This addon's ID (package.json config), with a runtime fallback to
 * `addon.data.config.addonID` — same resolution order as
 * src/modules/registerTranslateUI.ts#addonID.
 */
function addonID(): string {
  try {
    const fromData = (globalThis as any)?.addon?.data?.config?.addonID;
    if (fromData) return fromData;
  } catch {
    /* no addon global (node) — fall through to the config import */
  }
  return config.addonID;
}

/** Register the reader listener + buttons for every known main window. */
export function registerWordCardsUI(): void {
  registerReaderToolbarButton();
  for (const win of (globalThis as any)?.Zotero?.getMainWindows?.() ?? []) {
    registerWordCardsUIForWindow(win);
  }
}

/**
 * Inject the library toolbar button and the Tools-menu item into one main
 * window. Each injection is idempotent by its own element id, and a missing
 * anchor skips that one entry with a log rather than breaking the others
 * (or startup).
 */
export function registerWordCardsUIForWindow(win: any): void {
  try {
    const doc: Document | undefined = win?.document;
    if (!doc) return;
    const existing = tracked.find((t) => t.win === win);
    const entry: TrackedWindow = existing ?? { win, button: null, toolsItem: null };

    if (!doc.getElementById(BUTTON_ID)) {
      entry.button = injectLibraryToolbarButton(win, doc) ?? entry.button;
    }
    if (!doc.getElementById(TOOLS_MENUITEM_ID)) {
      entry.toolsItem = injectToolsMenuItem(win, doc) ?? entry.toolsItem;
    }
    if ((entry.button || entry.toolsItem) && !existing) tracked.push(entry);
  } catch (e) {
    safeDebug("[文献译读] wordCards: window injection failed: " + e);
  }
}

/**
 * Build and append the library toolbar button. Returns the element, or null
 * when no toolbar anchor exists (logged, non-fatal).
 */
function injectLibraryToolbarButton(
  win: any,
  doc: Document,
): any | null {
  try {
    const toolbar = resolveToolbar(doc);
    if (!toolbar) {
      safeDebug(
        "[文献译读] wordCards: no library toolbar anchor found — library button skipped",
      );
      return null;
    }

    const button = doc.createXULElement("toolbarbutton");
    button.id = BUTTON_ID;
    button.className = "zotero-tb-button";
    button.setAttribute("tooltiptext", getString("wordcards-toolbar-tooltip"));
    // currentColor stroke icons pick the toolbar's colour up via the image's
    // own color inheritance — the same rule as every other chrome:// icon in
    // this addon (see the QA note in addon/content/icons/).
    button.setAttribute(
      "style",
      "list-style-image: url(chrome://wenxianyidu/content/icons/wordcards-16.svg);",
    );
    button.addEventListener("command", () => {
      void import("../ui/wordCardsTab").then((mod) =>
        mod.openWordCardsTab(win),
      );
    });
    toolbar.appendChild(button);
    safeDebug("[文献译读] wordCards: library toolbar button injected");
    return button;
  } catch (e) {
    safeDebug("[文献译读] wordCards: library button injection failed: " + e);
    return null;
  }
}

/**
 * Build and append the「工具 → 生词本」item. Returns the element, or null when
 * the Tools menu cannot be found (logged, non-fatal). See TOOLS_POPUP_IDS for
 * the anchor-resolution order.
 */
function injectToolsMenuItem(win: any, doc: Document): any | null {
  try {
    let popup: Element | null = null;
    for (const id of TOOLS_POPUP_IDS) {
      popup = doc.getElementById(id);
      if (popup) break;
    }
    if (!popup) {
      for (const id of TOOLS_MENU_IDS) {
        const menu = doc.getElementById(id);
        popup = menu?.querySelector("menupopup") ?? null;
        if (popup) break;
      }
    }
    if (!popup) {
      safeDebug(
        "[文献译读] wordCards: no Tools menu found — tools entry skipped",
      );
      return null;
    }

    const menuitem = doc.createXULElement("menuitem");
    menuitem.id = TOOLS_MENUITEM_ID;
    menuitem.setAttribute("label", getString("tools-wordcards"));
    menuitem.addEventListener("command", () => {
      void import("../ui/wordCardsTab").then((mod) =>
        mod.openWordCardsTab(win),
      );
    });
    popup.appendChild(menuitem);
    safeDebug("[文献译读] wordCards: Tools menu item injected");
    return menuitem;
  } catch (e) {
    safeDebug("[文献译读] wordCards: tools item injection failed: " + e);
    return null;
  }
}

/** Revoke one window's entries (window unload). */
export function unregisterWordCardsUIForWindow(win: any): void {
  for (let i = tracked.length - 1; i >= 0; i--) {
    if (tracked[i].win !== win) continue;
    for (const node of [tracked[i].button, tracked[i].toolsItem]) {
      try {
        node?.remove();
      } catch {
        /* best-effort */
      }
    }
    tracked.splice(i, 1);
  }
}

/** Revoke everything: reader listener, all injected entries, and an open tab. */
export function unregisterWordCardsUI(): void {
  const Reader = (globalThis as any)?.Zotero?.Reader;
  if (readerToolbarHandler && typeof Reader?.unregisterEventListener === "function") {
    try {
      Reader.unregisterEventListener("renderToolbar", readerToolbarHandler);
    } catch (e) {
      safeDebug("[文献译读] wordCards: reader listener revoke failed: " + e);
    }
  }
  readerToolbarHandler = null;
  for (const entry of tracked.splice(0)) {
    for (const node of [entry.button, entry.toolsItem]) {
      try {
        node?.remove();
      } catch {
        /* best-effort */
      }
    }
  }
  // Closing the tab fires its onClose, which tears the DOM down.
  void import("../ui/wordCardsTab").then((mod) => mod.closeWordCardsTab());
}

function resolveToolbar(doc: Document): Element | null {
  for (const id of TOOLBAR_ANCHOR_IDS) {
    try {
      const anchor = doc.getElementById(id);
      if (anchor) return anchor;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reader toolbar button
// ─────────────────────────────────────────────────────────────────────────────

const READER_STYLE_ID = "wenxianyidu-wordcards-reader-style";
const READER_BUTTON_CLASS = "wenxianyidu-wc-reader-btn";

const READER_BUTTON_CSS = `
.${READER_BUTTON_CLASS} {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border: none; border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.${READER_BUTTON_CLASS}:hover { background: rgba(127,127,127,0.2); }
.${READER_BUTTON_CLASS}:focus-visible {
  outline: 2px solid var(--color-focus-border, #4072e5); outline-offset: -2px;
}
.${READER_BUTTON_CLASS} svg { width: 20px; height: 20px; display: block; }
`;

function registerReaderToolbarButton(): void {
  const Reader = (globalThis as any)?.Zotero?.Reader;
  if (!Reader || typeof Reader.registerEventListener !== "function") {
    safeDebug(
      "[文献译读] wordCards: Zotero.Reader.registerEventListener unavailable — reader button skipped",
    );
    return;
  }
  readerToolbarHandler = (event: any) => {
    try {
      const { doc, append } = event;
      if (!doc || typeof append !== "function") return;
      append(buildReaderButton(doc));
    } catch (e) {
      safeDebug("[文献译读] wordCards: reader button build failed: " + e);
    }
  };
  Reader.registerEventListener("renderToolbar", readerToolbarHandler, addonID());
}

/**
 * Build the reader toolbar button in the reader's own HTML document. The
 * geometry is the wordcards-20 icon inlined as markup — reader documents
 * render once per reader instance, and an inline SVG avoids a chrome fetch
 * per open while still colouring via currentColor.
 */
function buildReaderButton(doc: Document): HTMLElement {
  const head = doc.head ?? doc.documentElement;
  if (head && !doc.getElementById(READER_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = READER_STYLE_ID;
    style.textContent = READER_BUTTON_CSS;
    head.appendChild(style);
  }

  const button = doc.createElement("div");
  button.className = READER_BUTTON_CLASS;
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.setAttribute("title", getString("wordcards-toolbar-tooltip"));
  button.setAttribute("aria-label", getString("wordcards-toolbar-tooltip"));
  button.innerHTML = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">',
    '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">',
    '<rect x="3.8" y="2.9" width="12.5" height="14.2" rx="1.7"/>',
    '<path d="M7.7 12.1 L10 6.7 L12.3 12.1"/>',
    '<path d="M8.7 10.2 H11.3"/>',
    '<path d="M7.1 14.6 H12.9"/>',
    "</g></svg>",
  ].join("");

  const open = () => {
    void import("../ui/wordCardsTab").then((mod) =>
      mod.openWordCardsTab(
        (globalThis as any)?.Zotero?.getMainWindow?.() ??
          (doc.defaultView as any)?.Zotero?.getMainWindow?.(),
      ),
    );
  };
  button.addEventListener("click", open);
  button.addEventListener("keydown", (event) => {
    const e = event as KeyboardEvent;
    if (e.isComposing) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
  return button;
}

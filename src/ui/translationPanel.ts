import { mountTranslationWorkspace } from "./translationWorkspace";
import { resolveCurrentReader } from "./translatePane";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { subscribeTranslationStatus, getTranslationStatus, toolbarButtonText } from "../core/pdf/splitview/translationStatus";

export type TranslationPanelMode = "selection" | "input";
const XHTML = "http://www.w3.org/1999/xhtml";
const panels = new Map<any, { close(): void; show(mode: TranslationPanelMode, reader?: any): void }>();
const draftKeys = new WeakMap<object, string>();
let windowSequence = 0;

/** A plugin-owned sibling of the main content, never a note editor or a tab. */
export function openTranslationPanel(mode: TranslationPanelMode, reader?: any, owner?: any): void {
  const win = owner ?? (globalThis as any).Zotero?.getMainWindows?.()?.find((w: any) => w.document === reader?._iframeWindow?.top?.document) ?? (globalThis as any).Zotero?.getMainWindow?.();
  const doc: Document = win?.document;
  if (!doc) return;
  if (!draftKeys.has(win)) draftKeys.set(win, `window-panel:${++windowSequence}`);
  const existing = panels.get(win);
  if (existing) { existing.show(mode, reader); return; }
  const anchor = doc.getElementById("zotero-pane-stack") ?? doc.getElementById("zotero-pane");
  if (!anchor?.parentElement) throw new Error("Translation panel host unavailable");
  const node = (tag: string) => doc.createElementNS(XHTML, tag) as HTMLElement;
  // Reparenting tab-content disconnects Zotero custom elements and destroys their
  // library UI. Adjust only this existing container's layout, and restore it.
  const layout = anchor.parentElement as HTMLElement;
  const oldLayoutStyle = layout.getAttribute("style");
  layout.style.cssText += ";display:flex;flex-direction:row;min-height:0;min-width:0;overflow:hidden;";
  const oldAnchorStyle = anchor.getAttribute("style");
  (anchor as HTMLElement).style.cssText += ";flex:1 1 0;min-width:0;min-height:0;overflow:hidden;grid-template-columns:minmax(0,1fr);";
  const root = node("aside"); root.id = "wenxianyidu-translation-panel";
  root.setAttribute("aria-label", getString("workspace-modes"));
  const width = Math.max(300, Math.min(700, Number(getPref("ui.translation.width")) || 380));
  root.style.cssText = `position:relative;z-index:2;display:flex;flex-direction:column;width:${width}px;min-width:280px;max-width:65vw;min-height:0;flex:none;overflow:hidden;background:var(--material-background,#fff);color:var(--fill-primary,#333);border-inline-start:1px solid var(--material-border-quinary,#aaa);`;
  const layoutStyle = node("style");
  layoutStyle.textContent = "#zotero-pane-stack > hbox{min-width:0;min-height:0;max-width:100%}";
  root.append(layoutStyle);
  const header = node("div"); header.style.cssText = "display:flex;justify-content:space-between;padding:10px;flex:none";
  const title = node("strong"); title.textContent = getString("app-title");
  const close = node("button") as HTMLButtonElement; close.type = "button"; close.textContent = "×"; close.setAttribute("aria-label", getString("panel-close"));
  header.append(title, close); root.append(header);
  const body = node("div"); body.style.cssText = "overflow:auto;padding:12px;flex:1;min-height:0"; root.append(body);
  const progress = node("div"); progress.setAttribute("role", "status"); progress.style.cssText = "padding:8px;white-space:pre-wrap"; root.append(progress);
  const showProgress = () => { const status = getTranslationStatus(boundReader?.itemID); progress.textContent = status.phase === "idle" ? "" : `${toolbarButtonText(status, getString)}${status.message ? `\n${status.message}` : ""}`; };
  const unsubscribe = subscribeTranslationStatus(showProgress);
  const splitter = node("div"); splitter.setAttribute("role", "separator"); splitter.setAttribute("tabindex", "0"); splitter.setAttribute("aria-orientation", "vertical"); splitter.setAttribute("aria-label", getString("panel-resize"));
  splitter.style.cssText = "width:5px;flex:none;cursor:ew-resize;background:var(--fill-quinary,transparent)";
  anchor.after(splitter, root);
  let mounted: ReturnType<typeof mountTranslationWorkspace> | undefined;
  let boundReader: any;
  let currentMode = mode;
  const show = (next: TranslationPanelMode, explicit?: any) => {
    currentMode = next;
    const active = explicit ?? resolveCurrentReader(doc);
    if (!mounted || active !== boundReader) {
      mounted?.destroy(); boundReader = active;
      mounted = mountTranslationWorkspace({ doc, body, itemID: active?.itemID, panelOnly: true, initialMode: next, draftKey: draftKeys.get(win) });
    } else mounted.showMode(next);
    showProgress();
  };
  const resize = (next: number) => { root.style.width = `${Math.max(280, Math.min(win.innerWidth * .65, next))}px`; };
  const move = (ev: PointerEvent) => resize(win.innerWidth - ev.clientX);
  const up = () => { doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", up); setPref("ui.translation.width", Math.round(root.getBoundingClientRect().width)); };
  splitter.addEventListener("pointerdown", ev => { ev.preventDefault(); doc.addEventListener("pointermove", move); doc.addEventListener("pointerup", up); });
  splitter.addEventListener("keydown", event => { const ev = event as KeyboardEvent; if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") { ev.preventDefault(); resize(root.getBoundingClientRect().width + (ev.key === "ArrowLeft" ? 20 : -20)); setPref("ui.translation.width", Math.round(root.getBoundingClientRect().width)); } });
  const notifier = (globalThis as any).Zotero?.Notifier;
  const observer = notifier?.registerObserver?.({ notify: () => show((mounted?.getMode() as TranslationPanelMode) ?? currentMode) }, ["tab"], "wenxianyidu-panel");
  const destroy = () => {
    unsubscribe();
    mounted?.destroy(); up();
    if (observer !== undefined) notifier?.unregisterObserver?.(observer);
    win.removeEventListener("unload", destroy); root.remove(); splitter.remove();
    if (oldLayoutStyle === null) layout.removeAttribute("style"); else layout.setAttribute("style", oldLayoutStyle);
    if (oldAnchorStyle === null) anchor.removeAttribute("style"); else anchor.setAttribute("style", oldAnchorStyle);
    panels.delete(win);
  };
  panels.set(win, { close: destroy, show }); close.addEventListener("click", destroy); win.addEventListener("unload", destroy);
  show(mode, reader);
}

export function closeTranslationPanel(win: any): void { panels.get(win)?.close(); }
export function closeAllTranslationPanels(): void { for (const entry of [...panels.values()]) entry.close(); }

import { mountTranslatePane, resolveCurrentReader } from "./translatePane";
import { mountBilingualControl } from "./bilingualControl";
import { mountInputTranslation } from "./inputTranslation";
import { getPref, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { getActiveSession, stopBilingualSession } from "../core/pdf/sdt/bilingualLauncher";
import { returnToOriginalPdf } from "../core/pdf/sdt/sdtBridge";
import { toErrorMessage } from "../utils/error";
import { config } from "../../package.json";

const XHTML = "http://www.w3.org/1999/xhtml";
export const MAIN_ENGINES = ["bing-web", "google", "youdao", "niutrans", "youdao-official", "ai", "mtranserver"] as const;
type Mode = "split" | "paragraph" | "selection" | "input";
const modes: Mode[] = ["split", "paragraph", "selection", "input"];
const workspaces = new Set<() => void>();
const CONFIG_KEYS = ["translate.engineType", "translate.targetLanguage", "translate.credentialsRevision", "translate.ai.apiUrl", "translate.ai.model", "translate.ai.prompt", "translate.custom.apiUrl", "translate.custom.model", "translate.deepl.useFree", "translate.bing.region"];

export function openTranslationSettings(doc?: Document): void {
  const win = (doc?.defaultView as any) ?? (globalThis as any).Zotero?.getMainWindow?.();
  const z = (globalThis as any).Zotero ?? win?.Zotero;
  z?.Utilities?.Internal?.openPreferences?.("zotero-prefpane-wenxianyidu");
}

export function mountTranslationWorkspace(options: { doc: Document; body: HTMLElement; itemID?: number; inputOnly?: boolean; panelOnly?: boolean; initialMode?: "selection" | "input"; draftKey?: string }) {
  const { doc, body, itemID, inputOnly } = options;
  let destroyed = false;
  const node = (tag: string, cls = "") => { const el = doc.createElementNS(XHTML, tag) as HTMLElement; el.className = cls; return el; };
  const root = node("div", "wenxianyidu-workspace");
  const style = node("style");
  style.textContent = `.wenxianyidu-workspace{display:flex;flex-direction:column;gap:12px;min-width:0;font:inherit}.wenxianyidu-workspace [hidden]{display:none!important}.wenxianyidu-workspace button,.wenxianyidu-workspace select{font:inherit;color:inherit;cursor:pointer}.wenxianyidu-workspace select{max-width:100%;padding:4px;background:var(--material-background,transparent)}.wenxianyidu-workspace button{padding:5px 10px;border:1px solid var(--fill-tertiary,#888);border-radius:5px;background:var(--fill-quinary,rgba(127,127,127,.08))}.wenxianyidu-workspace button:hover{background:var(--fill-quinary,rgba(127,127,127,.12))}.wenxianyidu-mode-nav{display:grid;grid-template-columns:1fr 1fr;gap:6px}.wenxianyidu-mode-nav button{min-height:34px;box-shadow:0 1px 2px rgba(0,0,0,.12)}.wenxianyidu-mode-nav button:focus-visible{outline:2px solid #b5343a;outline-offset:2px}.wenxianyidu-mode-nav button[aria-pressed=true]{border-color:#b5343a;background:rgba(181,52,58,.08);font-weight:600}.wenxianyidu-engine-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.wenxianyidu-service-note{font-size:.85em;line-height:1.6;color:var(--fill-secondary,inherit)}.wenxianyidu-panel-actions{display:flex;gap:6px;flex-wrap:wrap}.wenxianyidu-panel-status{line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}`;
  root.appendChild(style);
  const engineRow = node("div", "wenxianyidu-engine-row");
  const engineLabel = node("label"); engineLabel.textContent = getString("workspace-engine");
  const engine = node("select") as HTMLSelectElement;
  engine.setAttribute("aria-label", getString("workspace-engine"));
  for (const id of MAIN_ENGINES) { const option = node("option") as HTMLOptionElement; option.value = id; option.textContent = getString(`engine-label-${id}`); engine.appendChild(option); }
  const currentEngine = String(getPref("translate.engineType") || "youdao");
  if (!MAIN_ENGINES.includes(currentEngine as any)) { const option = node("option") as HTMLOptionElement; option.value = currentEngine; option.textContent = currentEngine; engine.appendChild(option); }
  engine.value = currentEngine;
  engineLabel.appendChild(engine); engineRow.appendChild(engineLabel);
  const settings = node("button") as HTMLButtonElement; settings.type = "button"; settings.textContent = getString("workspace-settings");
  settings.addEventListener("click", () => openTranslationSettings(doc)); engineRow.appendChild(settings); root.appendChild(engineRow);
  const notice = node("div", "wenxianyidu-service-note"); root.appendChild(notice);
  const serviceNotice = () => { const id = engine.value; notice.textContent = getString(id === "mtranserver" ? "workspace-offline-notice" : id === "youdao" || id === "bing-web" ? "workspace-trial-notice" : "workspace-provider-notice"); };
  const onEngine = () => {
    setPref("translate.engineType", engine.value);
    setPref("translate.engineConfirmed", true);
    for (const refresh of workspaces) refresh();
  };
  engine.addEventListener("change", onEngine); serviceNotice();
  const nav = node("div", "wenxianyidu-mode-nav"); nav.setAttribute("role", "group"); nav.setAttribute("aria-label", getString("workspace-modes"));
  if (!inputOnly) root.appendChild(nav);
  const panels = new Map<Mode, HTMLElement>(); const buttons = new Map<Mode, HTMLButtonElement>();
  for (const mode of modes) {
    const panel = node("div", `wenxianyidu-mode-${mode}`); panel.hidden = true; panels.set(mode, panel);
    if (!inputOnly && (!options.panelOnly || mode === "selection" || mode === "input")) { const btn = node("button") as HTMLButtonElement; btn.type = "button"; btn.setAttribute("data-mode", mode); btn.textContent = getString(`workspace-mode-${mode}`); btn.addEventListener("click", () => showMode(mode)); nav.appendChild(btn); buttons.set(mode, btn); }
    root.appendChild(panel);
  }
  let selection: ReturnType<typeof mountTranslatePane> | null = null;
  const input = mountInputTranslation({ doc, body: panels.get("input")!, draftKey: options.draftKey ?? (inputOnly ? "standalone" : `sidebar:${itemID ?? "library"}`) });
  const paragraphPanel = panels.get("paragraph")!;
  const paragraphHint = node("p", "wenxianyidu-service-note"); paragraphHint.textContent = getString("workspace-paragraph-hint"); paragraphPanel.appendChild(paragraphHint);
  const bilingualHost = node("div"); paragraphPanel.appendChild(bilingualHost);
  let bilingual: { destroy(): void } | null = null;
  const paragraphActions = node("div", "wenxianyidu-panel-actions"); paragraphPanel.appendChild(paragraphActions);
  const status = node("div", "wenxianyidu-panel-status"); status.setAttribute("aria-live", "polite");
  const action = (parent: HTMLElement, label: string, callback: () => void) => { const button = node("button") as HTMLButtonElement; button.type = "button"; button.textContent = getString(label); button.addEventListener("click", callback); parent.appendChild(button); return button; };
  action(paragraphActions, "workspace-translate-all", () => {
    const reader = resolveCurrentReader(doc, itemID);
    const session = getActiveSession();
    if (!reader || !session || session.itemID !== reader.itemID) { status.textContent = getString("workspace-start-paragraph"); return; }
    const handle = session.handle as any;
    if (typeof handle.translateAll === "function") { handle.translateAll(); status.textContent = getString("workspace-all-queued"); }
  });
  action(paragraphActions, "workspace-return-pdf", () => {
    const reader = resolveCurrentReader(doc, itemID);
    void (async () => { try { await stopBilingualSession(); if (reader) await returnToOriginalPdf(reader); if (!destroyed) status.textContent = ""; } catch (error) { if (!destroyed) status.textContent = toErrorMessage(error); } })();
  });
  paragraphPanel.appendChild(status);
  const splitPanel = panels.get("split")!;
  const splitHint = node("p", "wenxianyidu-service-note"); splitHint.textContent = getString("workspace-split-hint"); splitPanel.appendChild(splitHint);
  const splitStatus = node("div", "wenxianyidu-panel-status"); splitStatus.setAttribute("aria-live", "polite");
  const splitButton = action(splitPanel, "workspace-open-split", () => {
    const reader = resolveCurrentReader(doc, itemID);
    if (!reader) { splitStatus.textContent = getString("workspace-open-pdf"); return; }
    splitButton.disabled = true; splitStatus.textContent = getString("workspace-preparing-split");
    void import("../core/pdf/splitview/splitViewFactory").then(mod => mod.translateCurrentReader(reader)).then(() => { if (!destroyed) splitStatus.textContent = getString("workspace-split-finished"); }).catch(error => { if (!destroyed) splitStatus.textContent = toErrorMessage(error); }).finally(() => { if (!destroyed) splitButton.disabled = false; });
  });
  splitPanel.appendChild(splitStatus);
  body.appendChild(root);
  let activeMode: Mode;
  function showMode(mode: Mode) {
    activeMode = mode;
    if (mode !== "input") input.suspend?.();
    // A hidden selection pane must not watch reader events or submit automatic
    // requests while the user is typing or preparing a document translation.
    if (mode !== "selection") { selection?.destroy(); selection = null; }
    for (const [id, panel] of panels) panel.hidden = id !== mode;
    for (const [id, button] of buttons) button.setAttribute("aria-pressed", String(id === mode));
    if (!inputOnly) setPref("ui.translation.mode", mode);
    if (mode === "paragraph" && !bilingual) bilingual = mountBilingualControl({ doc, body: bilingualHost, itemID });
    if (mode === "selection") {
      selection ??= mountTranslatePane({ doc, body: panels.get("selection")!, itemID });
      selection.refresh();
    }
    if (mode === "input") input.focus();
  }
  const stored = String(getPref("ui.translation.mode") || "selection") as Mode;
  showMode(options.initialMode ?? (inputOnly || !resolveCurrentReader(doc, itemID) ? "input" : modes.includes(stored) ? stored : "selection"));
  const fingerprint = () => CONFIG_KEYS.map(key => String(getPref(key) ?? "")).join("\u0000");
  let knownConfig = fingerprint();
  const refreshConfiguration = () => {
    if (destroyed) return;
    const next = String(getPref("translate.engineType") || "youdao");
    if (!(Array.from(engine.options) as HTMLOptionElement[]).some(option => option.value === next)) {
      const option = node("option") as HTMLOptionElement; option.value = next; option.textContent = next; engine.appendChild(option);
    }
    engine.value = next; serviceNotice();
    const current = fingerprint();
    if (current !== knownConfig) {
      knownConfig = current; input.invalidate(); selection?.refresh();
    }
  };
  workspaces.add(refreshConfiguration);
  const prefs = (globalThis as any).Zotero?.Prefs;
  const observers: unknown[] = [];
  if (prefs?.registerObserver) {
    for (const key of CONFIG_KEYS) {
      try { observers.push(prefs.registerObserver(`${config.prefsPrefix}.${key}`, refreshConfiguration, true)); } catch { /* focus fallback */ }
    }
  }
  doc.defaultView?.addEventListener("focus", refreshConfiguration);
  return {
    showMode,
    getMode: () => activeMode,
    refresh() { refreshConfiguration(); selection?.refresh(); },
    destroy() {
      destroyed = true; workspaces.delete(refreshConfiguration);
      for (const observer of observers) { try { prefs?.unregisterObserver?.(observer); } catch { /* host shutdown */ } }
      doc.defaultView?.removeEventListener("focus", refreshConfiguration);
      engine.removeEventListener("change", onEngine); selection?.destroy(); bilingual?.destroy(); input.destroy(); root.remove();
    }
  };
}

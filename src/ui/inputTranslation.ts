import { getString } from "../utils/locale";
import { createAbortController } from "../utils/abort";
import { copyText } from "../utils/clipboard";
import { isIMEComposing } from "../utils/ime";
import { getPref } from "../utils/prefs";
import { toErrorMessage } from "../utils/error";
import { ensureEngineAvailable } from "../core/translation/engineSelection";

const XHTML = "http://www.w3.org/1999/xhtml";
const drafts = new Map<string, { source: string; result: string }>();
let translationService: Promise<typeof import("../core/translation/translationService")> | null = null;
function loadTranslationService() {
  translationService ??= import("../core/translation/translationService").catch(error => {
    translationService = null;
    throw error;
  });
  return translationService;
}

/** Paragraph separators stay outside the provider request and are restored exactly. */
export function splitInputParagraphs(text: string): { parts: string[]; segments: Array<{ id: string; text: string }> } {
  const parts = text.split(/(\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*)/);
  return { parts, segments: parts.flatMap((part, index) => index % 2 === 0 && part.trim() ? [{ id: String(index), text: part }] : []) };
}

export function mountInputTranslation(options: { doc: Document; body: HTMLElement; draftKey?: string }) {
  const { doc, body } = options;
  const key = options.draftKey || "standalone";
  const saved = drafts.get(key);
  let destroyed = false;
  let generation = 0;
  let controller: AbortController | null = null;
  const root = doc.createElementNS(XHTML, "div") as HTMLElement;
  root.className = "wenxianyidu-input";
  const style = doc.createElementNS(XHTML, "style");
  style.textContent = `.wenxianyidu-input{display:flex;flex-direction:column;gap:10px;min-width:0}.wenxianyidu-input textarea{box-sizing:border-box;width:100%;min-height:140px;resize:vertical;padding:10px;line-height:1.65;border:1px solid var(--material-border-quinary,#aaa);border-radius:6px;color:inherit;background:var(--material-background,transparent);font:inherit}.wenxianyidu-input-result{white-space:pre-wrap;overflow-wrap:anywhere;min-height:100px;line-height:1.8;padding:12px;border-radius:6px;background:var(--fill-quinary,rgba(127,127,127,.08));user-select:text}.wenxianyidu-input-actions{display:flex;gap:8px;flex-wrap:wrap}.wenxianyidu-input button{font:inherit;padding:5px 14px;cursor:pointer}.wenxianyidu-input [hidden]{display:none!important}.wenxianyidu-input-status{font-size:.9em;color:var(--fill-secondary,inherit)}`;
  root.appendChild(style);
  const label = doc.createElementNS(XHTML, "label");
  label.textContent = getString("input-source-label");
  const input = doc.createElementNS(XHTML, "textarea") as HTMLTextAreaElement;
  input.className = "wenxianyidu-input-source";
  input.value = saved?.source || "";
  input.placeholder = getString("input-placeholder");
  input.setAttribute("aria-label", getString("input-source-label"));
  input.spellcheck = false;
  label.appendChild(input);
  root.appendChild(label);
  const actions = doc.createElementNS(XHTML, "div");
  actions.className = "wenxianyidu-input-actions";
  const button = (id: string): HTMLButtonElement => {
    const node = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
    node.type = "button"; node.textContent = getString(id); actions.appendChild(node); return node;
  };
  const translate = button("input-translate");
  translate.setAttribute("data-action", "translate");
  const cancel = button("input-cancel");
  cancel.setAttribute("data-action", "cancel");
  const copy = button("pane-translate-copy");
  copy.setAttribute("data-action", "copy");
  cancel.hidden = true;
  root.appendChild(actions);
  const status = doc.createElementNS(XHTML, "div") as HTMLElement;
  status.className = "wenxianyidu-input-status";
  status.setAttribute("aria-live", "polite");
  status.textContent = getString("input-shortcut");
  root.appendChild(status);
  const result = doc.createElementNS(XHTML, "div") as HTMLElement;
  result.className = "wenxianyidu-input-result";
  result.setAttribute("aria-label", getString("input-result-label"));
  result.setAttribute("aria-live", "polite");
  result.textContent = saved?.result || "";
  copy.disabled = !result.textContent;
  root.appendChild(result);
  body.appendChild(root);
  const save = () => { drafts.set(key, { source: input.value, result: result.textContent || "" }); };
  const busy = (value: boolean) => { translate.disabled = value; cancel.hidden = !value; };
  async function run() {
    if (!getPref("translate.enabled")) { status.textContent = getString("input-disabled"); return; }
    if (!input.value.trim()) { status.textContent = getString("input-empty"); input.focus(); return; }
    controller?.abort();
    const requestID = ++generation;
    const source = input.value;
    controller = createAbortController();
    const signal = controller!.signal;
    if (!await ensureEngineAvailable() || destroyed || signal.aborted || requestID !== generation) return;
    busy(true); status.textContent = getString("pane-translate-translating");
    try {
      const { translateSegments } = await loadTranslationService();
      if (signal.aborted || requestID !== generation || destroyed) return;
      const { parts, segments } = splitInputParagraphs(source);
      const translated = await translateSegments({ segments, targetLanguage: String(getPref("translate.targetLanguage") || "zh-CN"), signal,
        onProgress: (done, total) => { if (!destroyed && requestID === generation && !signal.aborted) status.textContent = getString("input-progress", { done, total }); },
      });
      if (signal.aborted || requestID !== generation || destroyed) return;
      const byID = new Map(translated.map(item => [item.id, item]));
      let failed = 0;
      result.textContent = parts.map((part, index) => {
        if (index % 2 || !part.trim()) return part;
        const item = byID.get(String(index));
        if (!item || item.status !== "success") { failed++; return getString("input-paragraph-error", { error: item?.error || getString("translation-error-unknown") }); }
        return item.text;
      }).join("");
      copy.disabled = !result.textContent;
      status.textContent = failed ? getString("input-partial", { failed }) : getString("input-complete");
      save();
    } catch (error) {
      if (signal.aborted || requestID !== generation || destroyed) return;
      status.textContent = getString("pane-translate-error", { error: toErrorMessage(error) });
    } finally { if (!destroyed && requestID === generation) { controller = null; busy(false); } }
  }
  const onInput = () => {
    if (controller) { controller.abort(); controller = null; generation++; busy(false); status.textContent = getString("input-edited"); }
    save();
  };
  const onKey = (event: KeyboardEvent) => {
    if (!isIMEComposing(event) && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); }
  };
  const onRun = () => { void run(); };
  const onCancel = () => { generation++; controller?.abort(); controller = null; busy(false); status.textContent = getString("input-cancelled"); };
  const onCopy = () => { void copyText(doc, result.textContent || "").then(error => { if (!destroyed) status.textContent = getString(error ? "input-copy-error" : "pane-translate-copied"); }).catch(() => { if (!destroyed) status.textContent = getString("input-copy-error"); }); };
  input.addEventListener("input", onInput); input.addEventListener("keydown", onKey);
  translate.addEventListener("click", onRun); cancel.addEventListener("click", onCancel); copy.addEventListener("click", onCopy);
  return {
    focus: () => input.focus(),
    suspend() {
      if (!controller) return;
      generation++; controller.abort(); controller = null; busy(false);
      status.textContent = getString("input-cancelled"); save();
    },
    invalidate() {
      generation++; controller?.abort(); controller = null; busy(false);
      result.textContent = ""; copy.disabled = true;
      status.textContent = getString("input-engine-changed"); save();
    },
    destroy() { save(); destroyed = true; generation++; controller?.abort(); input.removeEventListener("input", onInput); input.removeEventListener("keydown", onKey); translate.removeEventListener("click", onRun); cancel.removeEventListener("click", onCancel); copy.removeEventListener("click", onCopy); root.remove(); }
  };
}

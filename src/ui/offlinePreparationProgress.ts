import { getString } from "../utils/locale";
import { getOfflinePreparationStatus, subscribeOfflinePreparationStatus } from "../core/translation/offlinePreparationStatus";

export const OFFLINE_READY_NOTICE_MS = 8000;
interface Actions { prepare(): Promise<void>; cancel(): void; settings(): void }
const defaultActions: Actions = {
  prepare: async () => (await import("../core/translation/offlineManager")).prepareOffline(),
  cancel: () => { void import("../core/translation/offlineManager").then(module => module.cancelOfflinePreparation()); },
  settings: () => (globalThis as any).Zotero?.Utilities?.Internal?.openPreferences?.("zotero-prefpane-wenxianyidu"),
};
const stages = new Map([
  ["missing", "offline-stage-missing"], ["downloading", "offline-stage-downloading"],
  ["verifying", "offline-stage-verifying"], ["extracting", "offline-stage-extracting"],
  ["dependencies", "offline-stage-dependencies"], ["models", "offline-stage-models"],
  ["verifying-model", "offline-stage-verifying-model"], ["model-extracting", "offline-stage-model-extracting"],
  ["initializing", "offline-stage-initializing"], ["trial", "offline-stage-trial"],
  ["ready", "offline-stage-ready"], ["cancelling", "offline-stage-cancelling"],
  ["cancelled", "offline-stage-cancelled"], ["failed", "offline-stage-failed"],
]);

/** Window-independent preparation state, rendered immediately left of Translate. */
export function mountOfflinePreparationProgress(options: { doc: Document; parent: HTMLElement; before: HTMLElement; onOpen?(): void; actions?: Actions }) {
  const { doc, parent, before } = options, actions = options.actions ?? defaultActions;
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, dismissedRevision = -1;
  const host = doc.createElement("div"); host.className = "wenxianyidu-offline-progress";
  const style = doc.createElement("style");
  style.textContent = `
.wenxianyidu-offline-progress{position:relative;display:inline-flex;align-items:center;margin-inline-end:6px;flex:none;font:inherit}
.wenxianyidu-offline-progress [hidden]{display:none!important}
.wenxianyidu-offline-progress[hidden]{display:none!important}
.wenxianyidu-offline-trigger{display:inline-flex;align-items:center;gap:6px;max-width:210px;height:26px;padding:3px 6px;border:1px solid var(--fill-tertiary,#999);border-radius:5px;background:var(--material-background,#fff);color:var(--fill-primary,#333);font:inherit;font-size:11px;cursor:pointer}
.wenxianyidu-offline-trigger:focus-visible,.wenxianyidu-offline-details button:focus-visible{outline:2px solid #b5343a;outline-offset:2px}
.wenxianyidu-offline-label{max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wenxianyidu-offline-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;color:#b5343a;font-weight:bold}
.wenxianyidu-offline-progress[data-active=true] .wenxianyidu-offline-icon{border-radius:50%;background:conic-gradient(#b5343a var(--wy-offline-progress,0%),var(--fill-quinary,#ddd) 0)}
.wenxianyidu-offline-progress[data-active=true] .wenxianyidu-offline-icon:after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--material-background,#fff)}
.wenxianyidu-offline-progress[data-indeterminate=true] .wenxianyidu-offline-icon{background:none;border:2px solid var(--fill-quinary,#ccc);border-top-color:#b5343a;box-sizing:border-box;animation:wy-offline-spin 1s linear infinite}
.wenxianyidu-offline-progress[data-phase=ready] .wenxianyidu-offline-icon{color:var(--accent-green,#23733d)}
.wenxianyidu-offline-track{display:inline-block;width:52px;height:4px;border-radius:3px;overflow:hidden;background:var(--fill-quinary,#ddd)}
.wenxianyidu-offline-fill{display:block;height:100%;width:var(--wy-offline-progress,0%);background:#b5343a}
.wenxianyidu-offline-progress[data-indeterminate=true] .wenxianyidu-offline-fill{width:35%;animation:wy-offline-slide 1.3s ease-in-out infinite alternate}
.wenxianyidu-offline-details{position:absolute;top:calc(100% + 6px);inset-inline-end:0;z-index:10000;box-sizing:border-box;width:min(320px,calc(100vw - 24px));padding:12px;border:1px solid var(--fill-tertiary,#999);border-radius:7px;background:var(--material-background,#fff);color:var(--fill-primary,#333);box-shadow:0 5px 18px rgba(0,0,0,.2);font-size:12px;line-height:1.6;white-space:normal}
.wenxianyidu-offline-details progress{display:block;width:100%;height:8px;margin-block:8px}
.wenxianyidu-offline-error{overflow-wrap:anywhere;white-space:pre-wrap}
.wenxianyidu-offline-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.wenxianyidu-offline-details button{font:inherit;cursor:pointer;padding:4px 8px;border:1px solid var(--fill-tertiary,#999);border-radius:4px;background:transparent;color:inherit}
@keyframes wy-offline-spin{to{transform:rotate(360deg)}}
@keyframes wy-offline-slide{to{transform:translateX(180%)}}
@media(max-width:1100px){.wenxianyidu-offline-trigger{width:26px;justify-content:center;padding:3px}.wenxianyidu-offline-label,.wenxianyidu-offline-track{display:none}}
@media(prefers-reduced-motion:reduce){.wenxianyidu-offline-progress *{animation:none!important}}
`;
  const trigger = doc.createElement("button"); trigger.type = "button"; trigger.className = "wenxianyidu-offline-trigger"; trigger.setAttribute("data-tabstop", ""); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-haspopup", "dialog");
  const icon = doc.createElement("span"); icon.className = "wenxianyidu-offline-icon"; icon.setAttribute("aria-hidden", "true");
  const label = doc.createElement("span"); label.className = "wenxianyidu-offline-label";
  const track = doc.createElement("span"); track.className = "wenxianyidu-offline-track"; track.setAttribute("aria-hidden", "true");
  const fill = doc.createElement("span"); fill.className = "wenxianyidu-offline-fill"; track.appendChild(fill); trigger.append(icon, label, track);
  const panel = doc.createElement("div"); panel.className = "wenxianyidu-offline-details"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", getString("offline-progress-title"));
  panel.id = "wenxianyidu-offline-details"; trigger.setAttribute("aria-controls", panel.id);
  const status = doc.createElement("div"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const meter = doc.createElement("progress"); meter.max = 100; meter.setAttribute("aria-label", getString("offline-progress-title"));
  const error = doc.createElement("div"); error.className = "wenxianyidu-offline-error";
  const hint = doc.createElement("div"); hint.textContent = getString("offline-progress-hint");
  const buttons = doc.createElement("div"); buttons.className = "wenxianyidu-offline-actions";
  function action(key: string, callback: () => void) { const b = doc.createElement("button"); b.type = "button"; b.textContent = getString(key); b.setAttribute("data-action", key); b.setAttribute("data-tabstop", ""); b.addEventListener("click", callback); buttons.appendChild(b); return b; }
  const cancel = action("offline-progress-cancel", () => actions.cancel());
  const retry = action("offline-progress-retry", () => { retry.disabled = true; void actions.prepare().catch(reason => { if (!disposed) error.textContent = String(reason?.message || reason); }).finally(() => { if (!disposed) retry.disabled = getOfflinePreparationStatus().active; }); });
  action("offline-progress-settings", () => actions.settings());
  action("offline-progress-dismiss", () => { const s = getOfflinePreparationStatus(); if (!s.active) dismissedRevision = s.revision; close(); });
  panel.append(status, meter, error, hint, buttons); host.append(style, trigger, panel); parent.insertBefore(host, before);
  const live = doc.createElement("span"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)"; host.appendChild(live);
  let lastPhase = "";
  function render() {
    if (disposed) return;
    if (!host.isConnected) { destroy(); return; }
    if (timer !== undefined) clearTimeout(timer);
    const s = getOfflinePreparationStatus(), remaining = OFFLINE_READY_NOTICE_MS - (Date.now() - s.updatedAt);
    host.hidden = s.phase === "missing" || s.revision === dismissedRevision || (s.phase === "ready" && remaining <= 0 && panel.hidden);
    host.dataset.phase = s.phase; host.dataset.active = String(s.active); host.dataset.indeterminate = String(s.active && s.percent === undefined);
    host.style.setProperty("--wy-offline-progress", `${s.percent ?? 0}%`);
    const phase = getString(stages.get(s.phase) ?? "offline-stage-working");
    const text = `${phase}${s.percent === undefined ? "" : ` ${s.percent}%`}`;
    label.textContent = text; trigger.title = `${getString("offline-progress-title")} · ${text} · ${getString("offline-progress-details")}`; trigger.setAttribute("aria-label", trigger.title);
    status.textContent = text; error.textContent = s.error || ""; icon.textContent = s.active ? "" : s.phase === "ready" ? "✓" : s.phase === "failed" ? "!" : "−";
    track.hidden = !s.active; meter.hidden = !s.active;
    if (s.percent === undefined) meter.removeAttribute("value"); else meter.value = s.percent;
    cancel.hidden = !s.active; cancel.disabled = s.phase === "cancelling"; retry.hidden = !["failed", "cancelled"].includes(s.phase); retry.disabled = s.active;
    if (lastPhase !== s.phase) { live.textContent = phase; lastPhase = s.phase; }
    if (s.phase === "ready" && remaining > 0) timer = setTimeout(render, remaining);
  }
  function close() { panel.hidden = true; trigger.setAttribute("aria-expanded", "false"); render(); }
  trigger.addEventListener("click", () => { if (panel.hidden) { options.onOpen?.(); panel.hidden = false; trigger.setAttribute("aria-expanded", "true"); render(); } else close(); });
  const outside = (event: Event) => { if (!host.contains(event.target as Node)) close(); };
  const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !panel.hidden) { event.stopPropagation(); event.preventDefault(); close(); (host.hidden ? before : trigger).focus(); } };
  doc.addEventListener("pointerdown", outside); host.addEventListener("keydown", key); host.addEventListener("pointerdown", event => event.stopPropagation());
  let unsubscribe = () => {};
  unsubscribe = subscribeOfflinePreparationStatus(render);
  if (disposed) unsubscribe();
  function destroy() { if (disposed) return; disposed = true; unsubscribe(); if (timer !== undefined) clearTimeout(timer); doc.removeEventListener("pointerdown", outside); host.removeEventListener("keydown", key); doc.defaultView?.removeEventListener("unload", destroy); host.remove(); }
  doc.defaultView?.addEventListener("unload", destroy, { once: true });
  return { close, destroy };
}

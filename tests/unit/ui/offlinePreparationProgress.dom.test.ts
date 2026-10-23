// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountOfflinePreparationProgress, OFFLINE_READY_NOTICE_MS } from "../../../src/ui/offlinePreparationProgress";
import { updateOfflinePreparationStatus } from "../../../src/core/translation/offlinePreparationStatus";
vi.mock("../../../src/utils/locale", () => ({ getString: (key: string) => key }));
const handles: Array<{ destroy(): void }> = [];
function mount() {
  const parent = document.createElement("div"), translate = document.createElement("button");
  parent.appendChild(translate); document.body.appendChild(parent);
  const actions = { prepare: vi.fn(async () => {}), cancel: vi.fn(), settings: vi.fn() };
  const handle = mountOfflinePreparationProgress({ doc: document, parent, before: translate, actions }); handles.push(handle);
  const host = parent.querySelector<HTMLElement>(".wenxianyidu-offline-progress")!;
  const trigger = host.querySelector<HTMLButtonElement>(".wenxianyidu-offline-trigger")!;
  const panel = host.querySelector<HTMLElement>(".wenxianyidu-offline-details")!;
  const click = (action: string) => host.querySelector<HTMLButtonElement>(`[data-action="offline-progress-${action}"]`)!.click();
  return { host, trigger, panel, parent, translate, actions, handle, click };
}
beforeEach(() => { updateOfflinePreparationStatus("missing"); document.body.replaceChildren(); });
afterEach(() => { for (const h of handles.splice(0)) h.destroy(); vi.useRealTimers(); });
describe("offline preparation next to Translate", () => {
  it("stays hidden while idle and appears before Translate with stage-only percentages", () => {
    const v = mount(); expect(v.host.hidden).toBe(true); expect(v.host.nextSibling).toBe(v.translate);
    updateOfflinePreparationStatus("models", 62);
    expect(v.host.hidden).toBe(false); expect(v.trigger.textContent).toContain("models 62%");
    v.trigger.click(); expect(v.panel.hidden).toBe(false); expect(v.host.querySelector("progress")!.value).toBe(62);
    updateOfflinePreparationStatus("trial");
    expect(v.trigger.textContent).toContain("trial"); expect(v.trigger.textContent).not.toContain("%");
    expect(v.host.querySelector("progress")!.hasAttribute("value")).toBe(false); expect(v.host.dataset.phase).not.toBe("ready");
  });
  it("replays current progress in another reader and keeps both views synchronized", () => {
    updateOfflinePreparationStatus("downloading", 45); const one = mount(), two = mount();
    expect(one.trigger.textContent).toBe(two.trigger.textContent);
    updateOfflinePreparationStatus("models", 80); expect(two.trigger.textContent).toContain("models 80%");
    one.handle.destroy(); updateOfflinePreparationStatus("ready"); expect(two.trigger.textContent).toContain("ready");
  });
  it("shows readiness for eight seconds without extending it for a newly opened tab", () => {
    vi.useFakeTimers(); const v = mount(); updateOfflinePreparationStatus("ready");
    expect(v.host.hidden).toBe(false); vi.advanceTimersByTime(5000);
    const second = mount(); vi.advanceTimersByTime(OFFLINE_READY_NOTICE_MS - 5000);
    expect(v.host.hidden).toBe(true); expect(second.host.hidden).toBe(true);
  });
  it("keeps an open detail panel available after the success notice expires", () => {
    vi.useFakeTimers(); const v = mount(); updateOfflinePreparationStatus("ready"); v.trigger.click();
    vi.advanceTimersByTime(OFFLINE_READY_NOTICE_MS); expect(v.host.hidden).toBe(false);
    v.click("dismiss"); expect(v.host.hidden).toBe(true);
  });
  it("shows failure details as text and offers retry without changing the selected engine", async () => {
    const v = mount(); updateOfflinePreparationStatus("failed", undefined, "<img src=x> checksum failed");
    v.trigger.click(); expect(v.panel.textContent).toContain("checksum failed"); expect(v.panel.querySelector("img")).toBeNull();
    v.click("retry"); await Promise.resolve(); expect(v.actions.prepare).toHaveBeenCalledOnce();
    v.click("settings"); expect(v.actions.settings).toHaveBeenCalledOnce();
    v.click("dismiss"); expect(v.host.hidden).toBe(true); updateOfflinePreparationStatus("downloading", 0); expect(v.host.hidden).toBe(false);
  });
  it("cancels preparation and keeps progress visible when only details are dismissed", () => {
    const v = mount(); updateOfflinePreparationStatus("dependencies"); v.trigger.click(); v.click("cancel");
    expect(v.actions.cancel).toHaveBeenCalledOnce(); updateOfflinePreparationStatus("cancelling");
    expect(v.host.querySelector<HTMLButtonElement>('[data-action="offline-progress-cancel"]')!.disabled).toBe(true);
    v.click("dismiss"); expect(v.host.hidden).toBe(false);
    updateOfflinePreparationStatus("cancelled"); expect(v.trigger.textContent).toContain("cancelled");
  });
  it("closes with Escape and releases a detached reader's timer and subscription", () => {
    vi.useFakeTimers(); const v = mount(); updateOfflinePreparationStatus("models", 1); v.trigger.click();
    v.trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(v.panel.hidden).toBe(true); expect(document.activeElement).toBe(v.trigger);
    const baseline = vi.getTimerCount(); updateOfflinePreparationStatus("ready"); expect(vi.getTimerCount()).toBe(baseline + 1);
    v.parent.remove(); updateOfflinePreparationStatus("models", 5);
    expect(v.host.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(baseline);
  });
});

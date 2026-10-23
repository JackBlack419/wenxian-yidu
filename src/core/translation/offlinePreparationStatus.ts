export interface OfflinePreparationStatus {
  phase: string;
  percent?: number;
  error?: string;
  active: boolean;
  updatedAt: number;
  revision: number;
}
const terminal = new Set(["missing", "ready", "cancelled", "failed"]);
let current: OfflinePreparationStatus = { phase: "missing", active: false, updatedAt: 0, revision: 0 };
const listeners = new Set<(status: OfflinePreparationStatus) => void>();
export function getOfflinePreparationStatus(): OfflinePreparationStatus { return { ...current }; }
export function updateOfflinePreparationStatus(phase: string, percent?: number, error?: string): void {
  const value = typeof percent === "number" && Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : undefined;
  if (current.phase === phase && current.percent === value && current.error === error) return;
  current = { phase, percent: value, error, active: !terminal.has(phase), updatedAt: Date.now(), revision: current.revision + 1 };
  for (const listener of [...listeners]) { try { listener({ ...current }); } catch { /* detached view */ } }
}
/** A reader opened during preparation immediately receives the current stage. */
export function subscribeOfflinePreparationStatus(listener: (status: OfflinePreparationStatus) => void): () => void {
  listeners.add(listener); listener({ ...current });
  return () => { listeners.delete(listener); };
}

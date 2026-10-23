import { getPref, setPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import { alertDialog } from "../../utils/dialog";
import { config } from "../../../package.json";

/** A default provider is a recommendation; first use requires a user's choice. */
export function ensureEngineSelected(): boolean {
  if (getPref("translate.engineConfirmed") !== false) return true;
  const g = globalThis as any;
  // Preserve an explicitly configured provider when upgrading an older install.
  if (g.Services?.prefs?.prefHasUserValue?.(`${config.prefsPrefix}.translate.engineType`)) {
    setPref("translate.engineConfirmed", true);
    return true;
  }
  alertDialog(getString("app-title"), getString("engine-selection-required"));
  g.Zotero?.Utilities?.Internal?.openPreferences?.("zotero-prefpane-wenxianyidu");
  return false;
}

/** Downloads remain an explicit setting action, before PDF parsing or requests. */
export async function ensureEngineAvailable(): Promise<boolean> {
  if (!ensureEngineSelected()) return false;
  if (getPref("translate.engineType") !== "mtranserver") return true;
  const { getOfflineStatus } = await import("./offlineManager");
  if ((await getOfflineStatus()).ready) return true;
  alertDialog(getString("app-title"), getString("offline-not-ready"));
  (globalThis as any).Zotero?.Utilities?.Internal?.openPreferences?.("zotero-prefpane-wenxianyidu");
  return false;
}

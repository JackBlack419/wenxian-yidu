import { getPref } from '../utils/prefs';
import { closeAllTranslationPanels } from '../ui/translationPanel';
export const TRANSLATE_PANE_ID = 'wenxianyidu-translate';
export async function registerTranslateUI(): Promise<boolean> {
  // The window panel owns translation UI; never mount in Zotero's note pane.
  try { (globalThis as any).Zotero?.ItemPaneManager?.unregisterSection?.(TRANSLATE_PANE_ID); } catch { /* old host */ }
  return !!getPref('translate.enabled');
}
export function unregisterTranslateUI(): boolean { closeAllTranslationPanels(); return true; }
export default registerTranslateUI;

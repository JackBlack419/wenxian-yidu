import { openTranslationPanel, closeTranslationPanel } from '../ui/translationPanel';
import { getString } from '../utils/locale';
const windows = new Map<any, Element>();
export function openInputTranslation(win: any): void { openTranslationPanel('input', undefined, win); }
export function registerInputTranslationForWindow(win: any): void {
  if (!win?.document || windows.has(win)) return;
  const doc = win.document;
  const popup = doc.getElementById('menu_ToolsPopup') ?? doc.getElementById('menu-tools-popup') ?? doc.getElementById('toolsMenu')?.querySelector('menupopup');
  if (!popup) return;
  const item = doc.createXULElement('menuitem'); item.id = 'wenxianyidu-tools-input-translation'; item.setAttribute('label', getString('tools-input-translation'));
  item.addEventListener('command', () => openInputTranslation(win)); popup.appendChild(item); windows.set(win, item);
}
export function registerInputTranslation(): void { for (const win of (globalThis as any).Zotero?.getMainWindows?.() ?? []) registerInputTranslationForWindow(win); }
export function unregisterInputTranslationForWindow(win: any): void { closeTranslationPanel(win); windows.get(win)?.remove(); windows.delete(win); }
export function unregisterInputTranslation(): void { for (const win of [...windows.keys()]) unregisterInputTranslationForWindow(win); }

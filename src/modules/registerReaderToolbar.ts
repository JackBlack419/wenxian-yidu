import { prepareDocumentJob, reusableAttachment } from "../core/pdf/translation/documentJobs";
/**
 * registerReaderToolbar — 阅读器工具栏里的「翻译」入口。
 *
 * 实机反馈（2026-10-22）：四个功能藏在右侧栏面板里，用户得先找到面板；
 * 而分屏/上下/仅译文只在右键子菜单里，还没有取消入口、没有复用提示、没有设置入口。
 *
 * 这里用 Zotero 官方支持的事件 `renderToolbar`（reader.js 的 ReaderEventType，
 * 与 zotero-pdf-translate 同一机制，不魔改宿主 DOM 结构）在工具栏注入一个
 * 「翻译 ▾」按钮，展开后是：
 *   分屏翻译 · 上下翻译 · 仅译文 · 划词翻译 · 输入翻译 · 取消当前翻译 · 翻译设置…
 *
 * 已有译文时先问「复用 / 重新翻译 / 取消」；运行中才显示取消项。
 * 所有入口与右键菜单、任务页共用同一套 pipeline 与缓存，不另造翻译链路。
 */
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { safeDebug } from "../utils/logger";
import { getPrefDynamic } from "../utils/prefs";
import { getEngineCapabilities } from "../core/translation/translationEngines";
import { getLanguageName } from "../core/tool/language";
import {
  cancelActiveTranslation,
  isTranslationRunning,
  startBilingualFromReader,
  translateCurrentReader,
} from "../core/pdf/splitview/splitViewFactory";
import {
  findLatestTranslation,
  findTranslationByRelation,
} from "../core/pdf/splitview/splitViewCleanup";
import {
  getTranslationStatus,
  isResumableStatus,
  subscribeTranslationStatus,
  toolbarButtonText,
  toolbarFailureSuffix,
} from "../core/pdf/splitview/translationStatus";
import { openTranslationPanel } from "../ui/translationPanel";
import { ensureEngineSelected } from "../core/translation/engineSelection";
import { getActiveBilingualModeForItem } from "../core/pdf/sdt/bilingualLauncher";
import { mountOfflinePreparationProgress } from "../ui/offlinePreparationProgress";

const TOOLBAR_ID = "wenxianyidu-toolbar";
const PANEL_ID = "wenxianyidu-toolbar-panel";
const STYLE_ID = "wenxianyidu-toolbar-style";
const toolbarCleanups = new Set<() => void>();
/** 每次真正注入一份工具栏就 +1（QA 用来确认「只注入一份」）。 */
let toolbarBuildSeq = 0;
/** 当前工具栏的 navlog 写入器（QA 观测：文档级按键/焦点轨迹）。 */
let navSink: ((entry: Record<string, any>) => void) | null = null;

const CSS = `
#${TOOLBAR_ID},#${TOOLBAR_ID} *{-moz-window-dragging:no-drag}
#${TOOLBAR_ID}{position:relative;display:inline-flex;align-items:center;height:100%;margin-inline-end:4px}
#${TOOLBAR_ID} .wenxianyidu-tb-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;
  border:1px solid var(--fill-quinary,rgba(127,127,127,.35));border-radius:5px;background:transparent;
  color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
#${TOOLBAR_ID} .wenxianyidu-tb-btn:hover{background:var(--fill-quinary,rgba(127,127,127,.14))}
#${TOOLBAR_ID} .wenxianyidu-tb-btn[aria-expanded="true"]{background:rgba(181,52,58,.12);border-color:#b5343a}
#${PANEL_ID}{position:absolute;top:calc(100% + 6px);inset-inline-end:0;z-index:9999;min-width:190px;
  display:flex;flex-direction:column;padding:4px;border-radius:8px;
  color:var(--fill-primary,#404040);
  background:var(--material-background,#fff);border:1px solid var(--fill-quinary,rgba(127,127,127,.35));
  box-shadow:0 6px 20px rgba(0,0,0,.22);font:inherit;font-size:12px}
#${PANEL_ID}[hidden]{display:none}
#${PANEL_ID} button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;
  padding:6px 9px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;
  text-align:start;cursor:pointer}
#${PANEL_ID} button:hover:not(:disabled){background:rgba(181,52,58,.12)}
#${PANEL_ID} button:focus-visible{outline:2px solid #b5343a;outline-offset:-2px}
#${TOOLBAR_ID} .wenxianyidu-tb-btn:focus-visible{outline:2px solid #fff;outline-offset:2px}
#${PANEL_ID} button:disabled{opacity:.45;cursor:default}
#${PANEL_ID} .wenxianyidu-tb-sep{height:1px;margin:4px 2px;background:var(--fill-quinary,rgba(127,127,127,.3))}
#${PANEL_ID} .wenxianyidu-tb-hint{padding:4px 9px;opacity:.7;font-size:11px;line-height:1.5}
/* dark-mode fallback: keep the panel readable when the host token is missing
   (measured 1.61:1 contrast, dark-on-dark, before this rule). */
@media (prefers-color-scheme: dark){
  #${PANEL_ID}{background:var(--material-background,#1e1e1e);
    color:var(--fill-primary,#e8e8e8);border-color:var(--fill-quinary,rgba(255,255,255,.18))}
  #${PANEL_ID} .wenxianyidu-tb-sep{background:var(--fill-quinary,rgba(255,255,255,.18))}
  #${PANEL_ID} button:hover:not(:disabled){background:rgba(181,52,58,.28)}
}
@media (max-width: 880px){#${TOOLBAR_ID} .wenxianyidu-tb-btn{font-size:11px;padding:0 6px}}
@media (max-width: 680px){#${TOOLBAR_ID} .wenxianyidu-tb-btn{padding:0 5px;gap:3px}#${TOOLBAR_ID} .wenxianyidu-tb-fail{display:none}}
@media (max-width: 480px){#${TOOLBAR_ID} .wenxianyidu-tb-btn{padding:0 4px;font-size:10px}#${TOOLBAR_ID} .wenxianyidu-tb-caret{display:none}}
`;

/** 这篇源 PDF 已有的**真正**译文（标题 + 「译文」标签/关联双重确认）。 */
function findExistingTranslation(sourceItem: any): any | null {
  try {
    const Z = (globalThis as any).Zotero;
    const titleRe = /^(?:译文|Translated)\s*\(/i;
    const tag = getString("translated-tag");
    const parentID = sourceItem?.parentItemID;
    const candidates: any[] = [];
    if (parentID) {
      const parent = Z?.Items?.get?.(parentID);
      for (const id of parent?.getAttachments?.() ?? []) {
        const att = Z?.Items?.get?.(id);
        if (att && !att.deleted) candidates.push(att);
      }
    }
    // 顶层附件没有父条目：靠 dc:relation 回退。
    const relation =
      sourceItem?.getRelations?.()?.["dc:relation"] ??
      sourceItem?.getRelations?.()?.["dc:relation"];
    if (relation) {
      const list: string[] = Array.isArray(relation) ? relation : [String(relation)];
      for (const uri of list) {
        const id = Number(String(uri).split("/").pop());
        const att = Number.isInteger(id) ? Z?.Items?.get?.(id) : null;
        if (att && !att.deleted) candidates.push(att);
      }
    }
    for (const att of candidates) {
      if (att?.id === sourceItem?.id) continue;
      if (att?.attachmentContentType !== "application/pdf") continue;
      const title = att.getField?.("title") || "";
      if (!titleRe.test(title)) continue;
      const tagged = (att.getTags?.() ?? []).some((t: any) => t?.tag === tag);
      const linked = Boolean(relation);
      // 只认我们自己的产物：没有「译文」标签也没有关联的，可能是用户自己
      // 命名的 PDF，不能拿它冒充"已有译文"。
      if (!tagged && !linked) continue;
      return att;
    }
    return null;
  } catch (e) {
    safeDebug("[文献译读] toolbar: existing translation lookup failed: " + e);
    return null;
  }
}

/** 原生三按钮对话框的返回值映射（0=复用 / 1=重译 / 其他=取消）。 */
export function reuseChoiceForIndex(index: number): "reuse" | "retranslate" | "cancel" {
  return index === 0 ? "reuse" : index === 1 ? "retranslate" : "cancel";
}

/** 复用 / 重新翻译 / 取消 —— 三个按钮的原生对话框。 */
function askReuseOrRetranslate(kind: "complete" | "partial" | "different", failed = 0): "reuse" | "retranslate" | "cancel" {
  const win = (globalThis as any).Zotero?.getMainWindow?.() || null;
  const P = (globalThis as any).Services?.prompt;
  if (typeof P?.confirmEx !== "function") return "reuse";
  const flags =
    P.BUTTON_POS_0 * P.BUTTON_TITLE_IS_STRING |
    P.BUTTON_POS_1 * P.BUTTON_TITLE_IS_STRING |
    P.BUTTON_POS_2 * P.BUTTON_TITLE_IS_STRING;
  const choice = P.confirmEx(
    win,
    getString("toolbar-reuse-title"),
    getString(kind === "partial" ? "toolbar-reuse-partial" : kind === "different" ? "toolbar-reuse-different" : "toolbar-reuse-body", { failed }),
    flags,
    getString(kind === "partial" ? "toolbar-retry-failed" : "toolbar-reuse-accept", { failed }),
    getString("toolbar-reuse-retranslate"),
    getString("toolbar-reuse-cancel"),
    null,
    {},
  );
  return reuseChoiceForIndex(choice);
}

function openPreferences(): void {
  try {
    const win = (globalThis as any).Zotero?.getMainWindow?.();
    (globalThis as any).Zotero?.Utilities?.Internal?.openPreferences?.(
      "zotero-prefpane-wenxianyidu",
    );
    void win;
  } catch (e) {
    safeDebug("[文献译读] toolbar: open preferences failed: " + e);
  }
}

function alertNoReader(): void {
  try {
    (globalThis as any).Services?.prompt?.alert?.(
      (globalThis as any).Zotero?.getMainWindow?.(),
      getString("app-title"),
      getString("toolbar-no-reader"),
    );
  } catch (e) {
    safeDebug("[文献译读] toolbar: " + e);
  }
}

async function runSplit(reader: any): Promise<void> {
  const Zotero = (globalThis as any).Zotero;
  const itemID = reader?.itemID;
  const sourceItem = itemID ? Zotero?.Items?.get?.(itemID) : null;
  if (!sourceItem) {
    alertNoReader();
    return;
  }
  // 首版只支持文字型 PDF：别让 EPUB/快照一路转圈到最后才报解析错误。
  if (sourceItem.attachmentContentType && sourceItem.attachmentContentType !== "application/pdf") {
    try {
      (globalThis as any).Services?.prompt?.alert?.(
        Zotero?.getMainWindow?.(),
        getString("app-title"),
        getString("toolbar-pdf-only"),
      );
    } catch (e) {
      safeDebug("[文献译读] toolbar: " + e);
    }
    return;
  }
  const existing = findExistingTranslation(sourceItem);
  if (existing) {
    const job = await prepareDocumentJob(sourceItem);
    const matching = await reusableAttachment(job);
    const kind = job.attachmentID === existing.id && job.status === "partial" ? "partial" : matching?.id === existing.id ? "complete" : "different";
    const choice = askReuseOrRetranslate(kind, job.failed);
    if (choice === "reuse" && kind === "partial") { await translateCurrentReader(reader); return; }
    if (choice === "cancel") return;
    if (choice === "reuse") {
      // 真复用：直接拿已有译文附件开分屏，而不是再跑一遍流水线。
      try {
        const { openSplitView } = await import(
          "../core/pdf/splitview/splitViewFactory"
        );
        await openSplitView(Zotero?.getMainWindow?.(), sourceItem, existing);
        return;
      } catch (e) {
        safeDebug(
          "[文献译读] toolbar: reuse failed, falling back to translation: " + e,
        );
      }
    }
    if (choice === "retranslate") {
      await translateCurrentReader(reader, true);
      return;
    }
  }
  await translateCurrentReader(reader);
}

/**
 * 菜单键盘导航的纯逻辑（单独导出便于单测）：
 * ↑/↓ 循环、Home/End 到首尾、Esc/Tab 关闭，其余键不拦。
 */
export function resolveMenuKey(
  key: string,
  index: number,
  count: number,
):
  | { focus: number }
  | { close: true }
  | null {
  if (key === "Escape") return { close: true };
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return { focus: index < 0 ? 0 : (index + 1) % count };
    case "ArrowUp":
      return { focus: index < 0 ? count - 1 : (index - 1 + count) % count };
    case "Home":
      return { focus: 0 };
    case "End":
      return { focus: count - 1 };
    default:
      return null;
  }
}

/**
 * 已挂过文档级监听器的 iframe document 标记。
 *
 * 阅读器每次重渲染工具栏都会调用 renderToolbar，早先的实现每次都往 doc 上
 * 再挂一对 click/keydown 监听器——重渲染 N 次就挂着 N 份（用户走查：
 * 「doc 监听器不重复挂载」）。
 *
 * 标记记在 `<html data-wenxianyidu-toolbar-listeners>` 上，而**不是**
 * 模块里的 WeakSet：跨 compartment（addon 与 QA 探针各自持有自己的 Xray
 * 包装）同一个 document 的对象身份不同，WeakSet 会误判成「没挂过」。
 * 文档被真的重建时属性自然消失，监听器也该跟着重挂，语义仍然正确。
 */
function ensureDocListeners(doc: any): void {
  if (!doc) return;
  const html = doc.documentElement;
  if (!html) return;
  const marker = "data-wenxianyidu-toolbar-listeners";
  if (html.getAttribute(marker)) return;
  html.setAttribute(marker, "1");
  // 监听器里**动态**找 DOM（而不是闭包住某一次渲染的节点）：工具栏可能被
  // 宿主重建，闭包到旧节点会让「点外面关闭」在重渲染后失效。
  doc.addEventListener(
    "click",
    (ev: any) => {
      const root = doc.getElementById(TOOLBAR_ID);
      if (!root || root.contains(ev.target)) return;
      const panel = doc.getElementById(PANEL_ID);
      if (panel && !panel.hidden) {
        panel.hidden = true;
        root.querySelector(".wenxianyidu-tb-btn")?.setAttribute("aria-expanded", "false");
      }
    },
    true,
  );
  doc.addEventListener(
    "keydown",
    (ev: any) => {
      // 只做观测：记录文档级按键轨迹（谁收到了哪一次按键、目标是谁）。
      try {
        navSink?.({
          where: "doc-capture",
          key: ev.key,
          code: ev.code,
          target:
            (ev.target?.getAttribute?.("data-action") ||
              ev.target?.className ||
              ev.target?.tagName ||
              "") + "",
        });
      } catch {
        /* best-effort */
      }
    },
    true,
  );
  doc.addEventListener("keydown", (ev: any) => {
    if (ev.key !== "Escape") return;
    const panel = doc.getElementById(PANEL_ID);
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    const btn: any = doc.querySelector(`#${TOOLBAR_ID} .wenxianyidu-tb-btn`);
    btn?.setAttribute("aria-expanded", "false");
    // 同 closeMenu：等浏览器把焦点从被隐藏的面板里收回后再还回去。
    try {
      (doc.defaultView ?? globalThis).setTimeout(() => {
        try {
          btn?.focus();
        } catch {
          /* focus is best-effort */
        }
      }, 0);
    } catch {
      try {
        btn?.focus();
      } catch {
        /* focus is best-effort */
      }
    }
  });
}

function renderToolbar(event: any): void {
  const { reader, doc, append } = event;
  if (!doc || typeof append !== "function") return;
  if (doc.getElementById(TOOLBAR_ID)) return;
  // 不在「译文附件」自己的阅读器里再注入入口：那会诱导用户对译文再翻译一次，
  // 也会让分屏右窗格多出一个不该有的按钮。分屏两个窗格各自是 reader，但只有
  // 原文窗格保留入口。
  try {
    const itemID = reader?.itemID;
    const item = itemID ? (globalThis as any).Zotero?.Items?.get?.(itemID) : null;
    if (item) {
      const title = item.getField?.("title") || "";
      const tag = getString("translated-tag");
      const isTranslation =
        /^(?:译文|Translated)\s*\(/i.test(title) ||
        (item.getTags?.() ?? []).some((t: any) => t?.tag === tag);
      if (isTranslation) return;
    }
  } catch (e) {
    safeDebug("[文献译读] toolbar: guard failed: " + e);
  }

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }
  ensureDocListeners(doc);

  const root = doc.createElement("div");
  root.id = TOOLBAR_ID;

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "wenxianyidu-tb-btn";
  // 显式配色而不是依赖 reader 工具栏的 CSS 变量：实机出现过按钮有布局但看不见
  // （浅色工具栏 + 继承色/透明背景）。品牌红底白字在任何主题下都能看见。
  button.style.cssText =
    "display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;" +
    "border:0;border-radius:5px;background:#b5343a;color:#fff;cursor:pointer;" +
    "font-size:12px;font-weight:600;line-height:22px;white-space:nowrap;" +
    "max-width:100%;flex:0 1 auto;min-width:0;";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", PANEL_ID);
  // 同 addItem：让宿主的 tabToItem 把按钮当成独立的焦点组（item === group）后
  // 直接返回，不会在我们打开菜单前先把焦点挪走。
  button.setAttribute("data-tabstop", "");

  // 按钮文案拆成三段：进度主文案 / 失败段数 / 尾部箭头。窄窗下用纯 CSS
  // 依次隐藏失败段数、再隐藏箭头（<680px / <480px），不让按钮撑破工具栏。
  const mainSpan = doc.createElement("span");
  mainSpan.className = "wenxianyidu-tb-main";
  mainSpan.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  const failSpan = doc.createElement("span");
  failSpan.className = "wenxianyidu-tb-fail";
  const caretSpan = doc.createElement("span");
  caretSpan.className = "wenxianyidu-tb-caret";
  caretSpan.setAttribute("aria-hidden", "true");
  caretSpan.textContent = "▾";
  button.append(mainSpan, failSpan, caretSpan);

  const panel = doc.createElement("div");
  panel.id = PANEL_ID;
  panel.hidden = true;
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", getString("toolbar-title"));
  panel.style.maxWidth = "calc(100vw - 24px)";

  let focusedIndex = -1;
  const menuItems = (): any[] =>
    [...panel.querySelectorAll('[role="menuitem"]')].filter(
      (b: any) => !b.disabled,
    );
  /**
   * 当前焦点落在第几个菜单项。
   * 不能用 `list.indexOf(doc.activeElement)`：元素和 doc.activeElement 可能来自
   * 不同的 Xray 包装，`===` 判等会失败并返回 -1（实机表现为按 ↓ 跳错项）。
   * `isSameNode` 跨 compartment 依然可靠。
   */
  const activeIndex = (): number => {
    const list = menuItems();
    // 我们自己跟踪的下标优先：面板项的 focusin 会持续更新它，比读
    // doc.activeElement 稳（跨 compartment 的包装对象判等/取焦点时会读错，
    // 实机表现就是「按一下 ↓ 跳过一项」）。
    if (focusedIndex >= 0 && focusedIndex < list.length) return focusedIndex;
    const active = doc.activeElement;
    if (active) {
      const byNode = list.findIndex((b: any) =>
        typeof b.isSameNode === "function" ? b.isSameNode(active) : b === active,
      );
      if (byNode >= 0) return byNode;
    }
    return -1;
  };

  const closeMenu = (opts?: { returnFocus?: boolean }) => {
    panel.hidden = true;
    focusedIndex = -1;
    button.setAttribute("aria-expanded", "false");
    if (opts?.returnFocus) {
      // 隐藏含焦点的面板会让浏览器把焦点甩给 body/内层 iframe，同步 focus()
      // 会被这次回收覆盖（实机踩过：Esc 后 activeElement 是 iframe）。放到
      // 下一轮任务里做，等浏览器先完成焦点回收。
      const focusBack = () => {
        try {
          button.focus();
        } catch {
          /* focus is best-effort */
        }
      };
      try {
        (doc.defaultView ?? globalThis).setTimeout(focusBack, 0);
      } catch {
        focusBack();
      }
    }
  };
  const focusItem = (index: number) => {
    const list = menuItems();
    if (!list.length) {
      focusedIndex = -1;
      return;
    }
    const clamped = Math.max(0, Math.min(index, list.length - 1));
    focusedIndex = clamped;
    logNav({ where: "focusItem", index: clamped });
    try {
      list[clamped].focus();
    } catch {
      /* focus is best-effort */
    }
  };

  const addItem = (
    label: string,
    onClick: () => void,
    enabled = true,
    actionId = "",
  ) => {
    const b = doc.createElement("button");
    b.type = "button";
    // role=menuitem + roving tabindex：屏幕阅读器把这一串当菜单念，
    // 键盘只在菜单内部移动焦点（Tab 直接离开菜单）。
    b.setAttribute("role", "menuitem");
    b.tabIndex = -1;
    // data-tabstop 是我们和宿主键盘处理之间的「边界标记」：宿主 ReaderView 在
    // window 捕获阶段监听 ↑↓ 并调用 tabToItem()，它用
    // `item.closest('[data-tabstop]')` 找焦点组；当这个组就是当前项本身时直接
    // 返回。没有这个属性时，宿主会把我们的菜单项当成工具栏里的一串 tabstop
    // 再挪一格——实机表现为「打开菜单后按一下 ↓ 跳到第三项」（真 bug，已修）。
    b.setAttribute("data-tabstop", "");
    // data-action 给 QA 探针一个与语言无关的点击锚点。
    if (actionId) b.setAttribute("data-action", actionId);
    b.textContent = label;
    b.disabled = !enabled;
    if (!enabled) b.setAttribute("aria-disabled", "true");
    b.addEventListener("click", (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu();
      onClick();
    });
    panel.appendChild(b);
    return b;
  };
  const addSep = () => {
    const sep = doc.createElement("div");
    sep.className = "wenxianyidu-tb-sep";
    sep.setAttribute("role", "separator");
    panel.appendChild(sep);
  };
  const addHint = (text: string) => {
    const hint = doc.createElement("div");
    hint.className = "wenxianyidu-tb-hint";
    // 提示行不是菜单项：用 presentation 避免被朗读成可选项。
    hint.setAttribute("role", "presentation");
    hint.textContent = text;
    panel.appendChild(hint);
  };

  // 菜单每次打开时重建：「取消当前翻译」是否可点、是否有译文可复用都随时间变化，
  // 一次性构建会让这些状态永远停留在首次渲染那一刻（实机验证时取消项一直是灰的）。
  const buildMenu = () => {
    panel.replaceChildren();
    // 状态行：当前引擎 + 目标语言 + 是否在跑。工具栏是用户唯一一眼能看到的地方，
    // 不写清楚引擎和语言，用户只能去设置页猜（用户走查 P1-5）。
    try {
      const caps = getEngineCapabilities();
      const target = String(getPrefDynamic("translate.targetLanguage") || "zh-CN");
      // 语言名同样走 FTL（i18n 约束：界面文案不得硬编码中文）。
      const langKey: Record<string, string> = {
        "zh-CN": "toolbar-lang-zh-cn",
        "zh-TW": "toolbar-lang-zh-tw",
        "zh-HK": "toolbar-lang-zh-tw",
        en: "toolbar-lang-en",
        ja: "toolbar-lang-ja",
        ko: "toolbar-lang-ko",
      };
      addHint(
        getString("toolbar-status", {
          engine: caps.label,
          lang: langKey[target]
            ? getString(langKey[target])
            : getLanguageName(target),
        }),
      );
      // 进度行：菜单打开时也能看到「翻译中 7/18 · 失败 5 段」，不必盯工具栏按钮。
      const status = getTranslationStatus(reader?.itemID);
      if (status.phase !== "idle") {
        addHint(
          toolbarButtonText(status, getString) +
            toolbarFailureSuffix(status, getString),
        );
        if (status.title) {
          addHint(getString("toolbar-progress-hint", { title: status.title }));
        }
      }
    } catch (e) {
      safeDebug("[文献译读] toolbar: status row failed: " + e);
    }
    addItem(
      getString("splitview-menu-translate"),
      () => void runSplit(reader),
      true,
      "translate",
    );
    addItem(
      getString("splitview-menu-interleave"),
      () => void startBilingualFromReader(reader, "interleave"),
      true,
      "interleave",
    );
    addItem(
      getString("splitview-menu-trans-only"),
      () => void startBilingualFromReader(reader, "transOnly"),
      true,
      "trans-only",
    );
    addSep();
    addItem(getString("toolbar-selection"), () => openTranslationPanel("selection", reader), true, "selection");
    addItem(
      getString("toolbar-input"),
      () => openTranslationPanel("input", reader),
      true,
      "input",
    );
    addSep();
    // 取消后一键「继续翻译」：任务记录里 done/total 还在，continue 走的是
    // 同一套流水线（缓存命中已译段落），不是重新开一份任务。
    if (isResumableStatus(getTranslationStatus(reader?.itemID)) && !isTranslationRunning(reader?.itemID)) {
      addItem(
        getTranslationStatus(reader?.itemID).phase === "partial" ? getString("toolbar-retry-failed", { failed: getTranslationStatus(reader?.itemID).failed }) : getString("toolbar-resume"),
        // Bypass the attachment reuse dialog when resuming missing work.
        // The pipeline still reuses successfully translated segments.
        () => {
          const mode = getActiveBilingualModeForItem(reader?.itemID);
          if (mode) void startBilingualFromReader(reader, mode);
          else void translateCurrentReader(reader);
        },
        true,
        "resume",
      );
    } else {
      addItem(
        getString("splitview-menu-cancel"),
        () => cancelActiveTranslation(reader?.itemID),
        isTranslationRunning(reader?.itemID),
        "cancel",
      );
    }
    addItem(
      getString("toolbar-tasks"),
      () => {
        void import("./registerDocumentTasks").then((mod) =>
          mod.openDocumentTasks((globalThis as any).Zotero?.getMainWindow?.()),
        );
      },
      true,
      "tasks",
    );
    addItem(getString("toolbar-settings"), openPreferences, true, "settings");
  };
  buildMenu();

  // 先挂进 DOM 再刷状态：applyStatus 用 isConnected 判断工具栏是否已被宿主
  // 丢弃，未挂载时会被误判成「已丢弃」而直接跳过（实机踩过：按钮空白）。
  root.appendChild(button);
  root.appendChild(panel);
  append(root);
  const offlineProgress = mountOfflinePreparationProgress({ doc, parent: root, before: button, onOpen: () => closeMenu() });

  /** 把可见状态刷到按钮 + root 的 data-* 上（QA 探针读这些属性，不用猜文案）。 */
  const applyStatus = () => {
    if (!button.isConnected) {
      teardown();
      return;
    }
    const status = getTranslationStatus(reader?.itemID);
    const text = toolbarButtonText(status, getString);
    const suffix = toolbarFailureSuffix(status, getString);
    mainSpan.textContent = text;
    failSpan.textContent = suffix;
    const title = suffix
      ? `${getString("app-title")} · ${text}${suffix}`
      : getString("app-title");
    button.title = status.title ? `${status.title} — ${text}${suffix}` : title;
    button.setAttribute("aria-label", `${text}${suffix}`);
    root.setAttribute("data-phase", status.phase);
    root.setAttribute("data-done", String(status.done));
    root.setAttribute("data-total", String(status.total));
    root.setAttribute("data-failed", String(status.failed));
  };
  let unsubscribe: (() => void) | null = null;
  applyStatus();
  unsubscribe = subscribeTranslationStatus(applyStatus);
  function teardown() {
    unsubscribe?.(); offlineProgress.destroy(); root.remove(); toolbarCleanups.delete(teardown);
    doc.defaultView?.removeEventListener("unload", teardown);
  }
  toolbarCleanups.add(teardown);
  doc.defaultView?.addEventListener("unload", teardown, { once: true });

  const openMenu = (opts?: { focusFirst?: boolean }) => {
    if (!ensureEngineSelected()) return;
    offlineProgress.close();
    navlog.length = 0;
    try {
      root.setAttribute("data-navlog", "[]");
    } catch {
      /* best-effort */
    }
    buildMenu();
    focusedIndex = -1;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    if (opts?.focusFirst) focusItem(0);
  };

  // Keep the host's pointer handler from taking focus. Activation itself uses
  // click: unlike mousedown, it survives a cancelled pointerdown and also works
  // with accessibility activation. No constructor detection or timing latch.
  button.addEventListener("pointerdown", (ev: Event) => ev.stopPropagation());
  button.addEventListener("dblclick", (ev: Event) => {
    // The first click already opened the menu.
    ev.preventDefault();
    ev.stopPropagation();
  });
  button.addEventListener("click", (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    const click = ev as MouseEvent;
    if (click.button !== 0 || click.detail > 1) return;
    if (panel.hidden) openMenu({ focusFirst: click.detail === 0 });
    else closeMenu();
  });
  button.addEventListener("keydown", (ev: any) => {
    logNav({
      where: "button",
      key: ev.key,
      trusted: ev.isTrusted === true,
      open: !panel.hidden,
      build: toolbarBuildSeq,
    });
    const opensFromHere = ev.key === "ArrowDown" || ev.key === "Enter" || ev.key === " ";
    if (opensFromHere || ev.key === "ArrowUp") {
      ev.preventDefault();
      // 必须 stopPropagation：宿主阅读器的 ReaderView._handleKeyDown（冒泡阶段）
      // 也监听 ↑↓，并调用 tabToItem() 把焦点再往下挪一项——实机表现为「打开菜单
      // 后按一下 ↓ 直接跳到第三项」。这是真 bug，不是探针跨 compartment 误差。
      ev.stopPropagation();
      if (panel.hidden) {
        openMenu({ focusFirst: ev.key !== "ArrowUp" });
        if (ev.key === "ArrowUp") focusItem(menuItems().length - 1);
      }
    } else if (ev.key === "Escape" && !panel.hidden) {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu({ returnFocus: true });
    }
  });
  panel.addEventListener("focusin", (ev: any) => {
    // 焦点进入某个菜单项时同步下标（Tab/程序化 focus 都能覆盖到）。
    const list = menuItems();
    const target = ev.target;
    const i = list.findIndex((b: any) =>
      typeof b.isSameNode === "function" ? b.isSameNode(target) : b === target,
    );
    if (i >= 0) focusedIndex = i;
    logNav({
      where: "focusin",
      index: i,
      focus: focusedIndex,
    });
  });

  // QA 观测钩子：把菜单键盘事件逐条记到 root[data-navlog]（JSON），
  // 用于判断「按一次 ↓ 跳两项」到底是本插件处理了两遍，还是外部重复派发。
  const navlog: any[] = [];
  const logNav = (entry: Record<string, any>) => {
    try {
      navlog.push({ ...entry, t: Date.now() });
      if (navlog.length > 40) navlog.splice(0, navlog.length - 40);
      root.setAttribute("data-navlog", JSON.stringify(navlog));
    } catch {
      /* best-effort */
    }
  };
  toolbarBuildSeq += 1;
  root.setAttribute("data-toolbar-build", String(toolbarBuildSeq));
  navSink = (entry) => logNav(entry);

  panel.addEventListener("keydown", (ev: any) => {
    // 同一个事件只处理一次：宿主重渲染后可能残留第二个面板监听器，
    // 处理两遍会造成「按一次 ↓ 跳两项」。
    logNav({
      where: "panel",
      key: ev.key,
      code: ev.code,
      keyCode: ev.keyCode,
      repeat: ev.repeat === true,
      type: ev.type,
      trusted: ev.isTrusted === true,
      done: ev.__wenxianyiduNavDone === true,
      focus: focusedIndex,
      active: activeIndex(),
      build: toolbarBuildSeq,
    });
    if (ev.__wenxianyiduNavDone === true) return;
    ev.__wenxianyiduNavDone = true;
    // Tab 是**离开**菜单：关闭面板但别 preventDefault，否则焦点被锁在菜单里。
    if (ev.key === "Tab") {
      // 但仍然要 stopPropagation：宿主的 Tab 处理会走 tabToGroup()，和「离开
      // 菜单」的默认行为叠加会把焦点送错地方。
      ev.stopPropagation();
      closeMenu();
      return;
    }
    const list = menuItems();
    const index = activeIndex();
    const action = resolveMenuKey(ev.key, index, list.length);
    if (!action) return;
    ev.preventDefault();
    // 同上：宿主的 ReaderView._handleKeyDown 也处理 ↑↓（tabToItem），不拦住会
    // 一次按键移动两项。
    ev.stopPropagation();
    if ("close" in action) {
      closeMenu({ returnFocus: true });
    } else {
      focusItem(action.focus);
    }
    logNav({
      where: "panel-after",
      key: ev.key,
      focus: focusedIndex,
      active: activeIndex(),
      hidden: panel.hidden,
    });
  });
}

/** 模块级保存监听器引用——Zotero 的反注册按引用匹配。 */
let toolbarHandler: ((event: any) => void) | null = null;

/** 注册（Zotero 7+ 的 Reader.registerEventListener；缺失时静默跳过）。 */
export function registerReaderToolbar(): void {
  try {
    const reader = (globalThis as any).Zotero?.Reader;
    if (typeof reader?.registerEventListener !== "function") {
      safeDebug("[文献译读] toolbar: Reader.registerEventListener unavailable");
      return;
    }
    toolbarHandler = (event: any) => {
      try {
        renderToolbar(event);
      } catch (e) {
        safeDebug("[文献译读] toolbar render failed: " + e);
      }
    };
    // 必须是以 Reader 为接收者的方法调用：解构后单独调用会丢 this，
    // 宿主内部读 this._registeredListeners 直接抛 TypeError（实机已踩）。
    reader.registerEventListener("renderToolbar", toolbarHandler, config.addonID);
  } catch (e) {
    safeDebug("[文献译读] toolbar registration failed: " + e);
  }
}

/** 取消注册（插件停用/卸载时调用，避免留下失联的监听器）。 */
export function unregisterReaderToolbar(): void {
  for (const cleanup of [...toolbarCleanups]) cleanup();
  try {
    const reader = (globalThis as any).Zotero?.Reader;
    if (toolbarHandler && typeof reader?.unregisterEventListener === "function") {
      reader.unregisterEventListener("renderToolbar", toolbarHandler, config.addonID);
    }
  } catch (e) {
    safeDebug("[文献译读] toolbar unregister failed: " + e);
  }
  toolbarHandler = null;
}

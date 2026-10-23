import { listDocumentJobs, cancelDocumentJob, cancelAllDocumentJobs, type DocumentJob } from "../core/pdf/translation/documentJobs";
import { translateAndSplitWithOpenDataLoader } from "../core/pdf/translation/opendataloaderSplitAdapter";
import { getJavaStatus, importJavaArchive } from "../core/pdf/JavaRuntimeManager";
import { getOdlJarStatus, installOdlJar, importOdlJar } from "../core/pdf/OpenDataLoaderPdfClient";
import { installManagedJavaWithProgress } from "../core/pdf/splitview/splitViewFactory";
import { toErrorMessage } from "../utils/error";
import { safeDebug } from "../utils/logger";

const TAB_ID = "wenxianyidu-document-tasks";
const MENU_ID = "wenxianyidu-tools-document-tasks";
const NS = "http://www.w3.org/1999/xhtml";
const windows = new Map<any, { item: Element; dispose?: () => void }>();
const statusNames: Record<string, string> = { running: "处理中", interrupted: "等待继续", cancelled: "已取消", failed: "可重试", partial: "部分完成", complete: "已完成" };

function el(doc: Document, tag: string, text?: string): HTMLElement {
  const node = doc.createElementNS(NS, tag) as HTMLElement;
  if (text) node.textContent = text;
  return node;
}
function button(doc: Document, label: string, action: () => void | Promise<void>): HTMLButtonElement {
  const node = el(doc, "button", label) as HTMLButtonElement;
  node.type = "button";
  node.addEventListener("click", () => { void action(); });
  return node;
}
async function chooseFile(win: any, title: string, filter: string): Promise<string | null> {
  const { FilePicker } = (globalThis as any).ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
  const picker = new FilePicker();
  picker.init(win, title, picker.modeOpen);
  picker.appendFilter(title, filter);
  return await picker.show() === picker.returnOK ? picker.file : null;
}

/** Opens a small native tab, available even when the library has no selection. */
export function openDocumentTasks(win: any): void {
  try {
    openDocumentTasksInner(win);
  } catch (error) {
    // A tab that silently stays blank is worse than a logged failure: record
    // the cause (the command dispatcher swallows listener exceptions).
    safeDebug("[文献译读] openDocumentTasks failed: " + error);
    try {
      win?.Zotero?.getMainWindow?.()?.alert?.("无法打开翻译任务页，请重启 Zotero 后重试。");
    } catch { /* best effort */ }
  }
}

function openDocumentTasksInner(win: any): void {
  const tabs = win?.Zotero_Tabs;
  if (!tabs?.add) return;
  if (win.document.getElementById(TAB_ID)) { tabs.select(TAB_ID); return; }
  const entry = windows.get(win);
  let disposed = false;
  let timer: number | undefined;
  const dispose = () => { disposed = true; if (timer !== undefined) win.clearInterval(timer); };
  // Zotero 10's tab renderer reads `tab.data.icon` while drawing the tab strip;
  // without a `data` object `tabs.add` throws AFTER appending the tab-content,
  // leaving an empty tab (observed on the real machine as a blank task page).
  const result = tabs.add({
    id: TAB_ID,
    type: TAB_ID,
    title: "翻译任务与组件",
    select: true,
    data: { icon: "chrome://wenxianyidu/content/icons/translate-20.svg" },
    onClose: dispose,
  });
  const container = result?.container ?? win.document.getElementById(TAB_ID);
  if (!container) return;
  if (entry) entry.dispose = dispose;
  const doc = win.document as Document;
  const root = el(doc, "div");
  root.id = "wenxianyidu-tasks-root";
  root.style.cssText = "box-sizing:border-box;overflow:auto;width:100%;height:100%;padding:28px;color:var(--fill-primary,currentColor);";
  const style = el(doc, "style");
  style.textContent = "#wenxianyidu-tasks-root section{max-width:960px;margin:0 auto 24px}#wenxianyidu-tasks-root h1{font-size:24px;margin:0 0 12px}#wenxianyidu-tasks-root h2{font-size:18px}#wenxianyidu-tasks-root article{padding:14px 0;border-bottom:1px solid var(--color-panedivider,#ccc)}#wenxianyidu-tasks-root button{margin:5px 8px 5px 0;padding:5px 10px;cursor:pointer}#wenxianyidu-tasks-root p{line-height:1.6;margin:8px 0}#wenxianyidu-tasks-root .task-error{color:var(--accent-red,#b33737)}#wenxianyidu-tasks-root input{padding:6px;width:min(580px,90%)}";
  root.appendChild(style);
  const jobsSection = el(doc, "section");
  jobsSection.append(el(doc, "h1", "翻译任务"), el(doc, "p", "已完成的段落会保存在本机。继续或重试时使用当前翻译设置；更换引擎或提示词后会创建对应的新任务。"));
  const list = el(doc, "div");
  list.id = "wenxianyidu-task-list";
  const message = el(doc, "p");
  message.setAttribute("role", "status");
  let refreshBusy = false;
  const refresh = async () => {
    if (disposed || refreshBusy) return;
    refreshBusy = true;
    try {
      const jobs = await listDocumentJobs();
      if (disposed) return;
      list.replaceChildren();
      if (!jobs.length) list.appendChild(el(doc, "p", "还没有全文翻译任务。打开一篇 PDF 后点击“双栏对照”即可开始。"));
      for (const job of jobs) renderJob(job);
    } catch { message.textContent = "暂时无法读取任务，请点击刷新重试。"; }
    finally { refreshBusy = false; }
  };
  const renderJob = (job: DocumentJob) => {
    const card = el(doc, "article");
    card.dataset.jobId = job.id;
    card.append(el(doc, "strong", job.title), el(doc, "p", `${statusNames[job.status] ?? job.status} · ${job.stage}${job.total ? ` · ${job.done}/${job.total} 段` : ""}${job.failed ? ` · ${job.failed} 段失败` : ""}`));
    if (job.status === "running") {
      card.appendChild(button(doc, "取消", async () => { cancelDocumentJob(job.id); message.textContent = "正在取消；已完成内容保留。"; await refresh(); }));
    } else if (job.status !== "complete") {
      card.appendChild(button(doc, "继续 / 重试", async () => {
        const item = (globalThis as any).Zotero.Items.get(job.sourceItemID);
        if (!item || item.deleted || String(item.key ?? item.id) !== job.sourceKey || item.libraryID !== job.libraryID) {
          message.textContent = "源附件不存在，请从资料库重新打开 PDF。"; return;
        }
        message.textContent = "正在继续翻译。";
        try {
          await translateAndSplitWithOpenDataLoader({ sourceItem: item, outcome: "attachment",
            onProgress: text => { if (!disposed) message.textContent = text; },
            openAttachment: id => { void (globalThis as any).Zotero.Reader.open(id); } });
        } catch (error) { if (!disposed) message.textContent = toErrorMessage(error); }
        await refresh();
      }));
    }
    if (job.attachmentID) card.appendChild(button(doc, job.status === "partial" ? "查看部分译文" : "打开译文", async () => {
      try { await (globalThis as any).Zotero.Reader.open(job.attachmentID); }
      catch { message.textContent = "译文附件不存在，请重新翻译。"; }
    }));
    list.appendChild(card);
  };
  jobsSection.append(button(doc, "刷新", refresh), list, message);
  root.appendChild(jobsSection);

  const components = el(doc, "section");
  components.id = "wenxianyidu-component-manager";
  components.append(el(doc, "h2", "全文处理组件"), el(doc, "p", "全文翻译会按需自动准备组件，通常不需要你手动做任何事。直接开始一次全文翻译，或点下面的“自动安装 / 修复”按钮即可；只有自动下载失败时，才需要用最下方的离线导入。划词翻译和输入翻译不需要这些组件。"));
  const componentStatus = el(doc, "p", "正在检查组件…");
  componentStatus.setAttribute("role", "status");
  const check = async () => {
    const [java, odl] = await Promise.allSettled([getJavaStatus(), getOdlJarStatus()]);
    if (disposed) return;
    componentStatus.textContent = `运行库：${java.status === "fulfilled" && java.value.ready ? "可用" : "需要安装"}；PDF 解析组件：${odl.status === "fulfilled" && odl.value.present ? "可用" : "需要安装"}。`;
  };
  const doComponent = async (work: () => Promise<unknown>) => {
    componentStatus.textContent = "正在处理，请稍候…";
    try { await work(); await check(); }
    catch (error) { componentStatus.textContent = toErrorMessage(error); }
  };
  const sha = el(doc, "input") as HTMLInputElement;
  sha.id = "wenxianyidu-offline-jre-sha256";
  sha.type = "text"; sha.placeholder = "离线运行库的官方 SHA-256（64 位）";
  sha.setAttribute("aria-label", "运行库官方 SHA-256");
  const official = el(doc, "a", "打开 Temurin 官方下载页");
  official.setAttribute("href", "https://adoptium.net/temurin/releases/?version=17&os=windows&arch=x64&package=jre");
  official.addEventListener("click", event => { event.preventDefault(); (globalThis as any).Zotero.launchURL(official.getAttribute("href")); });
  components.append(componentStatus,
    button(doc, "自动安装 / 修复运行库", () => doComponent(async () => { if (!await installManagedJavaWithProgress()) throw new Error("运行库安装失败，请重试或离线导入。"); })),
    button(doc, "自动安装 / 修复解析组件", () => doComponent(() => installOdlJar())),
    el(doc, "h3", "仅当自动下载失败时：离线导入"),
    el(doc, "p", "平时不用填这里。若自动安装反复失败（例如公司网络拦截 GitHub、Adoptium 下载地址），再从官网手动下载文件并导入。"),
    el(doc, "p", "离线运行库：下载 Windows x64 的 Temurin JRE 17 ZIP，并从同一官方页面复制 SHA-256 填到下面，才能导入（校验值用于确认文件没有被替换）。"), official, el(doc, "br"), sha,
    button(doc, "选择运行库 ZIP 并导入", () => doComponent(async () => {
      if (!/^[a-f0-9]{64}$/i.test(sha.value.trim())) throw new Error("请先填写官方 SHA-256 校验值。");
      const path = await chooseFile(win, "选择 Temurin JRE 17 ZIP", "*.zip");
      if (path) await importJavaArchive(path, sha.value);
    })),
    el(doc, "p", "离线解析组件只接受本插件固定版本的 opendataloader-pdf-cli.jar，版本与校验值见随包组件说明。"),
    button(doc, "选择解析组件 JAR 并导入", () => doComponent(async () => { const path = await chooseFile(win, "选择 PDF 解析组件", "*.jar"); if (path) await importOdlJar(path); })));
  root.appendChild(components);
  container.appendChild(root);
  void refresh(); void check();
  timer = win.setInterval(() => { if (root.isConnected) void refresh(); else dispose(); }, 2000);
}

export function registerDocumentTasksForWindow(win: any): void {
  if (!win?.document || windows.has(win)) return;
  const popup = win.document.getElementById("menu_ToolsPopup") ?? win.document.getElementById("menu-tools-popup") ?? win.document.getElementById("toolsMenu")?.querySelector("menupopup");
  if (!popup) return;
  const item = win.document.createXULElement("menuitem");
  item.id = MENU_ID; item.setAttribute("label", "文献译读：翻译任务与组件");
  item.addEventListener("command", () => openDocumentTasks(win));
  popup.appendChild(item); windows.set(win, { item });
}
export function registerDocumentTasks(): void {
  for (const win of (globalThis as any).Zotero?.getMainWindows?.() ?? []) registerDocumentTasksForWindow(win);
}
export function unregisterDocumentTasksForWindow(win: any): void {
  const entry = windows.get(win); if (!entry) return;
  entry.dispose?.(); entry.item.remove(); windows.delete(win);
  try { if (win.document.getElementById(TAB_ID)) win.Zotero_Tabs.close(TAB_ID); } catch { /* host closing */ }
}
export function unregisterDocumentTasks(): void {
  cancelAllDocumentJobs();
  for (const win of [...windows.keys()]) unregisterDocumentTasksForWindow(win);
}

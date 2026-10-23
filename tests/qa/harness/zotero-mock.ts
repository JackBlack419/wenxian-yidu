/**
 * zotero-mock — Programmable Zotero global mock for z-transplit unit tests.
 *
 * Covers every Zotero surface the ported translation code touches:
 *   - Prefs (get/set with an in-memory map, `extensions.zotero.wenxianyidu.*`)
 *   - locale / debug / platform flags (isWin/isMac/platform) — forceable, so
 *     platform.ts OS detection can be tested on any host
 *   - PDFTranslate bridge (present/absent toggle)
 *   - ItemPaneManager.registerSection (spy: records pane config)
 *   - Reader integration (tabID + _selectionRanges) for the translate pane,
 *     plus registerEventListener + fireSelectionPopup so tests can drive the
 *     「renderTextSelectionPopup」 live-selection-sync path
 *   - ProgressWindow / Items / MainWindow / DataDirectory stubs
 *
 * Usage:
 *   const z = createZoteroMock({ prefs: { "translate.engineType": "bing" } });
 *   z.install();          // sets globalThis.Zotero
 *   z.prefs.set("translate.enabled", true);
 *   z.uninstall();        // restores previous globalThis.Zotero
 */

export interface ZoteroMockOptions {
  prefs?: Record<string, unknown>;
  locale?: string;
  platform?: "win" | "mac" | "linux";
  pdfTranslate?: {
    translate: (text: string, opts: Record<string, unknown>) => Promise<any>;
  } | null;
}

export interface RegisteredPane {
  paneID: string;
  header?: Record<string, unknown>;
  sidenav?: Record<string, unknown>;
  onItemChange?: (ctx: any) => void;
  onRender?: (ctx: any) => void;
  onDestroy?: (ctx: any) => void;
}

export interface ReaderSelectionStub {
  tabID: number;
  selectionRanges: Array<{ text: string }>;
  /** Attachment itemID the reader runs on (translatePane parent/attachment matching). */
  itemID?: number;
}

export class PrefMap {
  private map: Map<string, unknown>;
  readonly writes: Array<{ key: string; value: unknown }> = [];

  constructor(initial: Record<string, unknown> = {}) {
    this.map = new Map(Object.entries(initial));
  }

  get(key: string): unknown {
    return this.map.has(key) ? this.map.get(key) : undefined;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: unknown): void {
    this.writes.push({ key, value });
    this.map.set(key, value);
  }

  /** Bulk-set from an unprefixed map: {"translate.enabled": true} → full key. */
  load(prefixed: Record<string, unknown>, prefix: string): void {
    for (const [k, v] of Object.entries(prefixed)) {
      this.map.set(`${prefix}.${k}`, v);
    }
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  delete(key: string): void { this.map.delete(key); }

  clear(): void {
    this.map.clear();
    this.writes.length = 0;
  }
}

/**
 * Module-level reader-event registry. Zotero.Reader is a process-wide
 * singleton in production, and the plugin registers its shared selection-sync
 * listener once per process — while a fresh ZoteroMock is built per test even
 * though the plugin module (and its "already registered" flag) persists across
 * tests in a file. Mirroring the singleton with a module-level array keeps
 * fireSelectionPopup reaching listeners registered by earlier tests' mounts.
 */
const sharedReaderEventListeners: Array<{
  type: string;
  handler: (event: any) => void;
}> = [];

/** Drop every registered reader-event listener (test isolation helper). */
export function resetReaderEventListeners(): void {
  sharedReaderEventListeners.length = 0;
}

export class ZoteroMock {
  readonly prefs: PrefMap;
  readonly prefix: string;
  readonly registeredPanes: RegisteredPane[] = [];
  readonly registeredMenus: Array<{ id: string; [k: string]: unknown }> = [];
  readonly debugLines: string[] = [];
  readonly progressWindows: Array<{ headline: string; descriptions: string[] }> = [];
  /** Fake password manager, separate from the plaintext preference branch. */
  readonly credentials = new Map<string, string>();
  locale: string;
  platform: "win" | "mac" | "linux";
  pdfTranslate: any;
  private readerStub: ReaderSelectionStub | null = null;
  private readerInstance: any = null;
  items: Map<number, any> = new Map();

  /**
   * Selection stub. Assigning a NEW object invalidates the cached reader
   * instance: Zotero's getByTabID returns a stable ReaderInstance, and the
   * translate pane compares readers by identity (matchesReader), so the mock
   * must hand out the same object between assignments.
   */
  get reader(): ReaderSelectionStub | null {
    return this.readerStub;
  }

  set reader(v: ReaderSelectionStub | null) {
    this.readerStub = v;
    this.readerInstance = null;
  }

  private getReaderInstance(): any {
    if (!this.readerStub) return null;
    if (!this.readerInstance) {
      this.readerInstance = {
        itemID: this.readerStub.itemID,
        _internalReader: {
          _primaryView: { _selectionRanges: this.readerStub.selectionRanges },
        },
      };
    }
    return this.readerInstance;
  }
  private savedZotero: unknown;
  private savedTabs: unknown;
  private savedServices: unknown;
  private savedComponents: unknown;

  constructor(opts: ZoteroMockOptions = {}) {
    this.prefix = "extensions.zotero.wenxianyidu";
    this.prefs = new PrefMap();
    this.locale = opts.locale ?? "zh-CN";
    this.platform = opts.platform ?? "linux";
    this.pdfTranslate = opts.pdfTranslate ?? null;
    if (opts.prefs) {
      const ordinary: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(opts.prefs)) {
        if (/^translate\.[^.]+\.(?:apiKey|appKey|appSecret)$/.test(key)) this.credentials.set(key, String(value ?? ""));
        else ordinary[key] = value;
      }
      this.prefs.load(ordinary, this.prefix);
    }
  }

  get Zotero(): any {
    const self = this;
    return {
      locale: self.locale,
      isWin: self.platform === "win",
      isMac: self.platform === "mac",
      get platform() {
        return self.platform === "win"
          ? "win32"
          : self.platform === "mac"
            ? "macosx"
            : "linux";
      },
      debug: (msg: string) => {
        self.debugLines.push(String(msg));
      },
      Prefs: {
        get: (key: string) => self.prefs.get(key),
        set: (key: string, value: unknown) => {
          self.prefs.set(key, value);
        },
        clear: (key: string) => self.prefs.delete(key),
      },
      PDFTranslate: self.pdfTranslate,
      getMainWindow: () => null,
      DataDirectory: { dir: "/tmp/zotero-data" },
      Items: {
        get: (id: number) => self.items.get(id) ?? null,
      },
      ItemPaneManager: {
        registerSection: (cfg: RegisteredPane) => {
          self.registeredPanes.push(cfg);
          return cfg.paneID;
        },
        unregisterSection: () => true,
      },
      MenuManager: {
        register: (cfg: Record<string, unknown>) => {
          self.registeredMenus.push({ id: String(cfg.id ?? ""), ...cfg });
          return cfg.id;
        },
      },
      ProgressWindow: class {
        headline = "";
        descriptions: string[] = [];
        changeHeadline(h: string) {
          this.headline = h;
          self.progressWindows.push({
            headline: h,
            descriptions: this.descriptions,
          });
        }
        addDescription(d: string) {
          this.descriptions.push(d);
        }
        show() {}
        startCloseTimer() {}
        close() {}
      },
      Reader: {
        registerEventListener: (type: string, handler: (event: any) => void) => {
          sharedReaderEventListeners.push({ type, handler });
        },
        unregisterEventListener: (type: string, handler: (event: any) => void) => {
          const i = sharedReaderEventListeners.findIndex(
            (l) => l.type === type && l.handler === handler,
          );
          if (i >= 0) sharedReaderEventListeners.splice(i, 1);
        },
        getByTabID: (tabID: number) => {
          if (!self.reader || self.reader.tabID !== tabID) return null;
          return self.getReaderInstance();
        },
      },
    };
  }

  install(): void {
    this.savedZotero = (globalThis as any).Zotero;
    this.savedTabs = (globalThis as any).Zotero_Tabs;
    this.savedServices = (globalThis as any).Services;
    this.savedComponents = (globalThis as any).Components;
    (globalThis as any).Zotero = this.Zotero;
    (globalThis as any).Zotero_Tabs = { selectedID: this.reader?.tabID ?? 1 };
    const credentials = this.credentials;
    const entries = () => [...credentials].map(([username, password]) => ({ username, password }));
    (globalThis as any).Services = {
      ...((globalThis as any).Services ?? {}),
      logins: {
        findLogins: () => entries(),
        addLoginAsync: async (entry: any) => { credentials.set(entry.username, entry.password); },
        modifyLogin: (_old: any, entry: any) => { credentials.set(entry.username, entry.password); },
        removeLogin: (entry: any) => { credentials.delete(entry.username); },
      },
    };
    const previous = (globalThis as any).Components ?? {};
    (globalThis as any).Components = {
      ...previous,
      interfaces: { ...(previous.interfaces ?? {}), nsILoginInfo: {} },
      classes: { ...(previous.classes ?? {}), "@mozilla.org/login-manager/loginInfo;1": { createInstance: () => ({
        init(origin: string, _form: null, realm: string, username: string, password: string) { Object.assign(this, {origin, realm, username, password}); },
      }) } },
    };
  }

  uninstall(): void {
    if (this.savedZotero === undefined) delete (globalThis as any).Zotero;
    else (globalThis as any).Zotero = this.savedZotero;
    if (this.savedTabs === undefined) delete (globalThis as any).Zotero_Tabs;
    else (globalThis as any).Zotero_Tabs = this.savedTabs;
    if (this.savedServices === undefined) delete (globalThis as any).Services;
    else (globalThis as any).Services = this.savedServices;
    if (this.savedComponents === undefined) delete (globalThis as any).Components;
    else (globalThis as any).Components = this.savedComponents;
  }

  /**
   * Fire 「renderTextSelectionPopup」 the way Zotero's reader iframe does:
   * `{ reader, doc, params: { annotation }, append }` where `annotation.text`
   * is the popup's own selection text. Pass `undefined` (or omit) to simulate
   * a popup render that carries no annotation.
   */
  fireSelectionPopup(annotationText?: string): void {
    const tabs = (globalThis as any).Zotero_Tabs ?? { selectedID: this.reader?.tabID ?? 1 };
    const reader = this.getReaderInstance();
    const event = {
      reader,
      doc: null,
      params: {
        annotation:
          annotationText === undefined ? undefined : { text: annotationText },
      },
      append: () => {},
    };
    for (const { type, handler } of [...sharedReaderEventListeners]) {
      if (type === "renderTextSelectionPopup") handler(event);
    }
  }

  /**
   * Fire an arbitrary registered reader event (e.g. 「createViewContextMenu」)
   * against every listener registered for that type. The caller builds the
   * event — reader/append/params — since each event type carries its own
   * shape; menu handlers receive `append` collectors from the test.
   */
  fireReaderEvent(type: string, event: any): void {
    for (const { type: registered, handler } of [...sharedReaderEventListeners]) {
      if (registered === type) handler(event);
    }
  }
}

export function createZoteroMock(opts: ZoteroMockOptions = {}): ZoteroMock {
  return new ZoteroMock(opts);
}

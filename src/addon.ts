import { config } from "../package.json";
import { prepareOffline, cancelOfflinePreparation, getOfflineStatus, subscribeOfflineStatus, stopOfflineService } from "./core/translation/offlineManager";
import { openTranslationPanel } from "./ui/translationPanel";
import hooks from "./hooks";
import { translateSegments, testConnection, getDefaultPrompt, listModels } from "./core/translation/translationService";
import { getEngineCapabilities } from "./core/translation/translationEngines";
import { getCredential, setCredential, clearCredential } from "./utils/credentials";
import { getJavaStatus, importJavaArchive } from "./core/pdf/JavaRuntimeManager";
import { installManagedJavaWithProgress } from "./core/pdf/splitview/splitViewFactory";
import {
  getOdlJarStatus,
  installOdlJar,
  importOdlJar,
} from "./core/pdf/OpenDataLoaderPdfClient";

/**
 * Addon singleton, published as `Zotero.WenxianYidu` by src/index.ts (the name
 * comes from package.json config.addonInstance) and reachable from every module
 * through `_globalThis.addon`.
 */
class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    locale?: {
      /** Fluent Localization instance created by initLocale(). */
      current: any;
    };
  };
  public hooks: typeof hooks;
  public api: object;
  public translation = { translateSegments, testConnection, listModels, getCapabilities: getEngineCapabilities, getDefaultPrompt };
  public openTranslationPanel = openTranslationPanel;
  public offline = { prepare: prepareOffline, cancel: cancelOfflinePreparation, getStatus: getOfflineStatus, subscribe: subscribeOfflineStatus, shutdown: () => { cancelOfflinePreparation(); stopOfflineService(); } };
  public credentials = { get: getCredential, set: setCredential, clear: clearCredential };
  /**
   * Java 运行库的编程入口，供设置面板脚本（addon/content/preferences.js）
   * 使用：面板运行在 Cu.Sandbox 里，无法 import 主包模块，只能走这个挂在
   * Zotero 全局上的表面。getStatus 探测当前状态（可能 spawn java -version，
   * 有秒级延迟，由调用方决定时机）；install 带进度窗口安装/修复（内部有
   * in-flight 去重，重复调用共享同一次安装）。
   */
  public java: {
    getStatus: typeof getJavaStatus;
    install: typeof installManagedJavaWithProgress;
    importArchive: typeof importJavaArchive;
  };
  /**
   * OpenDataLoader 解析组件（jar）的编程入口，供设置面板脚本
   * （addon/content/preferences.js）使用，与 java 同一约定：getStatus 只读
   * 检查组件是否可用（哈希核对，秒级以内）；install 触发解压/下载修复
   * （进度窗口显示在主窗口，内部有 in-flight 去重）。
   */
  public odlJar: {
    getStatus: typeof getOdlJarStatus;
    install: typeof installOdlJar;
    importFile: typeof importOdlJar;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
    };
    this.hooks = hooks;
    this.api = {};
    this.java = {
      getStatus: getJavaStatus,
      install: installManagedJavaWithProgress,
      importArchive: importJavaArchive,
    };
    this.odlJar = {
      getStatus: getOdlJarStatus,
      install: installOdlJar,
      importFile: importOdlJar,
    };
  }
}

export default Addon;

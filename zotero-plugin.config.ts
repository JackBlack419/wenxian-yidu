import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

/**
 * 精简版（默认）：不内置 24MB 的 OpenDataLoader 解析组件，XPI 从约 27MB 缩到
 * 约 5.2MB。首次解析时插件按随包分发的 PROVENANCE*.json 指纹从镜像自动下载该
 * 组件（见 src/core/pdf/OdlJarDownloader.ts；镜像实测与取件策略见该文件头）。
 * 完整版：设置环境变量 ZTRANSPLIT_FULL_XPI=1 构建，两个 jar 全部内置，供
 * 离线环境分发；内置时下载兜底不会被触发。
 * 两个变体都必须携带 lib 下的 PROVENANCE*.json——它们是下载与校验的信任锚。
 */
const fullXpi = process.env.ZTRANSPLIT_FULL_XPI === "1";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  // This fork only uses its own release assets.
  updateURL: "https://github.com/JackBlack419/wenxian-yidu/releases/latest/download/updates.json",
  xpiDownloadLink: `https://github.com/JackBlack419/wenxian-yidu/releases/download/v${pkg.version}/wenxianyidu-${pkg.version}.xpi`,

  release: {
    // Publish maintained release notes instead of raw commit messages.
    changelog: "node scripts/release-notes.mjs",
  },

  build: {
    makeManifest: { enable: false },
    assets: [
      "addon/**/*.*",
      "src/core/pdf/lib/*.json",
      fullXpi
        ? "src/core/pdf/lib/*.jar"
        : "src/core/pdf/lib/ztransplit-region-text-remover.jar",
    ],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    fluent: {
      // The FTL sources already carry the `wenxianyidu-` prefix in their file
      // names (addon/locale/en-US/wenxianyidu-preferences.ftl, …), and the
      // scaffold's default prefixLocaleFiles would turn them into
      // `wenxianyidu-wenxianyidu-preferences.ftl`. Keep the names as authored —
      // they are what src/utils/locale.ts registers. Message ids are still
      // prefixed (prefixFluentMessages stays at its default of true), which is
      // why the .ftl sources write ids WITHOUT the leading `wenxianyidu-`.
      prefixLocaleFiles: false,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
          __buildVersion__: JSON.stringify(pkg.version),
        },
        banner: {
          js: `
// Expose globalThis as _globalThis — used throughout the codebase.
// Zotero loads the bundle via Services.scriptloader.loadSubScript(url, ctx),
// where ctx is a plain scope object; without this alias every reference to
// _globalThis (and therefore to _globalThis.addon) throws.
var _globalThis = globalThis;
// Polyfill console for Zotero SpiderMonkey environment
if (typeof console === 'undefined') {
  const logToZotero = (prefix, args) => {
    const msg = Array.from(args).map(a => {
      if (typeof a === 'string') return a;
      if (typeof a === 'number' || typeof a === 'boolean') return String(a);
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a, function(key, value) {
            if (typeof value === 'object' && value !== null) {
              if (value.nodeType) return '[DOM Node]';
              if (typeof value[Symbol.iterator] === 'function') return '[Iterable]';
            }
            return value;
          });
        } catch (e) {
          return '[Object]';
        }
      }
      return String(a);
    }).join(' ');
    if (typeof Zotero !== 'undefined' && Zotero.debug) {
      Zotero.debug(prefix + ' ' + msg);
    }
  };
  this.console = {
    log: function(...args) { logToZotero('[console.log]', args); },
    error: function(...args) { logToZotero('[console.error]', args); },
    warn: function(...args) { logToZotero('[console.warn]', args); },
    info: function(...args) { logToZotero('[console.info]', args); },
    debug: function(...args) { logToZotero('[console.debug]', args); },
    group: function() {},
    groupCollapsed: function() {},
    groupEnd: function() {},
    trace: function() {},
    table: function() {},
    time: function() {},
    timeLog: function() {},
    timeEnd: function() {},
    clear: function() {},
    count: function() {},
    assert: function() {},
    dir: function() {},
    dirxml: function() {}
  };
}
// Global console reference
var console = this.console;
// Polyfill Buffer for jszip (and other libs that expect it) in the Zotero
// SpiderMonkey environment
if (typeof Buffer === "undefined") {
  this.Buffer = {
    from: function(d, e) {
      if (typeof d === "string") return new TextEncoder().encode(e || "utf-8");
      if (d instanceof Uint8Array || d instanceof ArrayBuffer) return new Uint8Array(d);
      return d;
    },
    isBuffer: function() { return false; },
    alloc: function(s) { return new Uint8Array(s); },
    concat: function(a, b) {
      var r = new Uint8Array(a.length + b.length);
      r.set(a);
      r.set(b, a.length);
      return r;
    },
  };
}
`,
        },
        // Drop console in production to reduce bundle noise
        drop: process.env.NODE_ENV === "development" ? [] : ["console"],
        // Post-build: replace problematic console calls
        write: true,
        bundle: true,
        target: "firefox140",
        plugins: [],
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },
});

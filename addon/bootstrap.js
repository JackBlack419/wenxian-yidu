/* eslint-disable */
var chromeHandle;

/**
 * Preference pane registration (编辑 → 设置 → 文献译读).
 *
 * This lives in bootstrap.js, not in addon/prefs.js: Zotero executes prefs.js
 * in a scope whose only global is `pref()` (Zotero.Plugins#setDefaultPrefs),
 * so it cannot reach Zotero.PreferencePanes. bootstrap.js runs in the plugin
 * scope, which has Zotero/Services.
 *
 * The pane markup, script, stylesheet and copy live in:
 *   addon/content/preferences.xhtml
 *   addon/content/preferences.js
 *   addon/content/preferences.css
 *   addon/locale/<locale>/wenxianyidu-preferences.ftl
 *
 * If src/modules/registerPreferences.ts ever registers the same pane, the
 * fixed pane id makes that a no-op here instead of a duplicate pane.
 */
const PREFS_PANE_ID = "zotero-prefpane-wenxianyidu";

function registerPreferences(id, rootURI) {
  try {
    const panes = Zotero.PreferencePanes;
    if (!panes || typeof panes.register !== "function") {
      // Zotero < 7 (or a host without the pane API): nothing to register.
      return;
    }
    if ((panes.pluginPanes || []).some((pane) => pane.id === PREFS_PANE_ID)) {
      return;
    }
    // Relative URIs are resolved against the plugin root by
    // Zotero.Plugins.resolveURI; the sidebar label falls back to the plugin
    // name from manifest.json ("文献译读").
    const registered = panes.register({
      pluginID: id,
      id: PREFS_PANE_ID,
      src: "content/preferences.xhtml",
      scripts: ["content/preferences.js"],
      stylesheets: ["content/preferences.css"],
    });
    if (registered && typeof registered.catch === "function") {
      registered.catch((e) => Zotero.logError(
        `文献译读: preference pane registration failed: ${e}`,
      ));
    }
  } catch (e) {
    // A broken settings pane must never keep the addon from starting.
    Zotero.logError(`文献译读: preference pane registration failed: ${e}`);
  }
}

function install(data, reason) {
}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  // Keep background updates opt-in; manual update checks use our release feed.
  try {
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const self = await AddonManager.getAddonByID(id);
    if (self) self.applyBackgroundUpdates = AddonManager.AUTOUPDATE_DISABLE;
  } catch { /* Never stop an offline installation on update-policy bookkeeping. */ }
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "wenxianyidu", rootURI + "content/"],
  ]);

  // Register the settings pane before the bundle loads, so the pane shows up
  // even if the bundle (or its hooks) fails to start.
  registerPreferences(id, rootURI);

  const ctx = { rootURI };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/wenxianyidu.js`,
    ctx,
  );
  await Zotero.WenxianYidu.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.WenxianYidu?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.WenxianYidu?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  try { Zotero.WenxianYidu?.offline?.shutdown?.(); } catch { /* host exiting */ }
  if (reason === APP_SHUTDOWN) {
    return;
  }

  await Zotero.WenxianYidu?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {
  // Remove the persistent cache directories (translation cache + word cards).
  // Everything else the addon stores lives in the extensions.zotero.wenxianyidu.*
  // preference branch, which Zotero clears together with the default prefs
  // declared in addon/prefs.js. Best-effort: Zotero may be tearing down already.
  try {
    const IOUtils = globalThis.IOUtils;
    const dir = Zotero.DataDirectory?.dir;
    if (IOUtils?.remove && dir) {
      await IOUtils.remove(
        dir + "/wenxianyidu/translation-cache",
        { recursive: true, ignoreExisting: true },
      );
      await IOUtils.remove(
        dir + "/wenxianyidu/word-cards",
        { recursive: true, ignoreExisting: true },
      );
    }
  } catch (e) {
    try {
      Zotero.logError("文献译读: cache cleanup failed: " + e);
    } catch { /* ignore */ }
  }
}

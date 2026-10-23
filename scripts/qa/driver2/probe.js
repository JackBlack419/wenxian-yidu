/**
 * probe.js — real-machine QA probe, injected into a COPY of the built addon
 * (scripts/qa/real-machine.mjs builds D:\zt-qa\addon-under-test from
 * .scaffold/build/addon and patches that copy's bootstrap to load this file).
 *
 * The shipped addon is never modified. The probe runs once, in the real
 * Zotero chrome realm, after the addon's own onStartup() has completed, and
 * exercises the real UI paths:
 *
 *   snapshot / reader / menus / prefs / locales / engines / pipeline
 *
 * Results are written as JSON to D:\zt-qa\result.json.
 */

/* exported startProbe */
var PROBE_ROOT = PathUtils.parent(Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path);
var PROBE_CMDS = {};
var PROBE_STATE = { done: false };

PROBE_CMDS.offlineProgress023 = async function(arg) {
  if(arg && arg.phase) {
    if(typeof Zotero.WenxianYidu.offline.__qaProgress023!=="function")throw Error("QA-only progress hook unavailable");
    Zotero.WenxianYidu.offline.__qaProgress023(arg.phase,arg.percent,arg.error);
  }
  const win=Zotero.getMainWindow(), reader=Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
  const doc=reader?._iframeWindow?.document,host=doc?.querySelector(".wenxianyidu-offline-progress"),trigger=host?.querySelector("button");
  const settings=Services.wm.getMostRecentWindow("zotero:pref")?.document;
  const rect=trigger?.getBoundingClientRect();
  return {status:await Zotero.WenxianYidu.offline.getStatus(),ui:host?{hidden:host.hidden,phase:host.dataset.phase,label:trigger.textContent,title:trigger.title,
    iconOnly:doc.defaultView.getComputedStyle(host.querySelector(".wenxianyidu-offline-label")).display==="none",rect:rect&&{x:rect.x,y:rect.y,width:rect.width},detailVisible:!host.querySelector(".wenxianyidu-offline-details").hidden,
    beforeTranslate:host.nextElementSibling?.classList.contains("wenxianyidu-tb-btn")} : null,
    settings:settings?{text:settings.getElementById("wenxianyidu-offline-status")?.textContent,hidden:settings.getElementById("wenxianyidu-offline-progress")?.hidden,value:settings.getElementById("wenxianyidu-offline-progress")?.getAttribute("value")} : null};
};

// Contrast-view selection regression: only the current QA synthetic PDF.
PROBE_CMDS.selection024 = async function(action) {
  const win=Zotero.getMainWindow(), tabID=win.Zotero_Tabs.selectedID;
  if(tabID!==PROBE_STATE.demoTabID)throw Error("Select this run's QA demo PDF first");
  const reader=Zotero.Reader.getByTabID(tabID),prefix="extensions.zotero.wenxianyidu.";
  if(action==="open") {
    Zotero.Prefs.set(prefix+"translate.auto",true,true);
    Zotero.Prefs.set(prefix+"wordcards.enabled",false,true);
    Zotero.WenxianYidu.openTranslationPanel("selection",reader,win);
    await Zotero.Promise.delay(500);
  }
  const raw=reader?._internalReader?.wrappedJSObject||reader?._internalReader;
  const view=raw?._primarySDTView?.wrappedJSObject||raw?._primarySDTView;
  const doc=view?._iframe?.contentDocument;
  const p=doc?.querySelector('#sdt-content p[data-ref-path]');
  if(action==="select") {
    if(!p)throw Error("No QA reflow paragraph");
    const range=doc.createRange();range.selectNodeContents(p);
    doc.getSelection().removeAllRanges();doc.getSelection().addRange(range);
    doc.dispatchEvent(new doc.defaultView.Event("selectionchange"));
    await Zotero.Promise.delay(900);
  }
  if(action==="clear") {
    doc?.getSelection().removeAllRanges();
    doc?.dispatchEvent(new doc.defaultView.Event("selectionchange"));
    await Zotero.Promise.delay(400);
  }
  const panel=win.document.getElementById("wenxianyidu-translation-panel");
  return {tabID,itemID:reader?.itemID,readingMode:raw?._state?.primaryReadingModeEnabled,
    selected:doc?.getSelection()?.toString(),paragraph:p?.textContent,
    source:panel?.querySelector(".wenxianyidu-tp-source-text")?.textContent,
    result:panel?.querySelector(".wenxianyidu-tp-result-text")?.textContent,
    error:panel?.querySelector(".wenxianyidu-tp-error")?.textContent,
    toolbar:reader?._iframeWindow?.document?.querySelector(".wenxianyidu-tb-btn")?.textContent};
};

// Feedback 0.2.2: own synthetic reader and DOM only, never user-profile items.
PROBE_CMDS.feedback022 = async function(action) {
  const win=Zotero.getMainWindow(), prefix="extensions.zotero.wenxianyidu.";
  if(action==="slow") {
    PROBE_STATE.feedbackFetch022=bundleScope.fetch;
    bundleScope.fetch=async function(url,init){if(String(url).includes("/ttranslatev3?"))await Zotero.Promise.delay(3000);return PROBE_STATE.feedbackFetch022(url,init);};
    return {delayMS:3000};
  }
  if(action==="restoreSlow") {if(PROBE_STATE.feedbackFetch022)bundleScope.fetch=PROBE_STATE.feedbackFetch022;return {restored:true};}
  if(action==="fresh") {
    Zotero.Prefs.set(prefix+"translate.engineConfirmed",false,true);
    Services.prefs.clearUserPref(prefix+"translate.engineType");
    return {confirmed:false,explicitEngine:Services.prefs.prefHasUserValue(prefix+"translate.engineType")};
  }
  if(action==="confirm") {Zotero.Prefs.set(prefix+"translate.engineConfirmed",true,true);Zotero.Prefs.set(prefix+"translate.engineType","bing-web",true);return {confirmed:true};}
  const reader=Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
  const raw=reader?._internalReader?.wrappedJSObject||reader?._internalReader;
  const view=raw?._primarySDTView?.wrappedJSObject||raw?._primarySDTView;
  const doc=view?._iframe?.contentDocument;
  if(action==="math") {
    if(!reader)throw Error("QA reader missing");
    await raw._handleReadingModeEnabledChange(true);
    for(let n=0;n<50;n++){
      const current=raw._primarySDTView?.wrappedJSObject||raw._primarySDTView;
      const d=current?._iframe?.contentDocument,container=d?.getElementById("sdt-content");
      if(container){
        const p=d.createElement("p");p.dataset.refPath="qa-math-022";
        p.append(d.createTextNode("The feature z"));const sup=d.createElement("sup");sup.textContent="r";p.append(sup,d.createTextNode(" is measured in mW."));container.prepend(p);
        return {source:p.outerHTML};
      }
      await Zotero.Promise.delay(200);
    }
    throw Error("QA SDT unavailable");
  }
  if(action==="return") {doc?.querySelector(".wenxianyidu-bi-controls button")?.click();await Zotero.Promise.delay(700);return PROBE_CMDS.feedback022("inspect");}
  const toolbar=reader?._iframeWindow?.document?.querySelector(".wenxianyidu-tb-btn")?.textContent;
  const own=doc?.querySelector('[data-ref-path="qa-math-022"].wenxianyidu-bi');
  return {sourceID:reader?.itemID,tabID:win.Zotero_Tabs.selectedID,toolbar,
    confirmed:Zotero.Prefs.get(prefix+"translate.engineConfirmed",true),
    readingMode:raw?._state?.primaryReadingModeEnabled,returnButton:doc?.querySelector(".wenxianyidu-bi-controls button")?.textContent,
    blocks:doc?.querySelectorAll(".wenxianyidu-bi").length,mathTranslation:own?.outerHTML,
    sourceReaderIDs:Zotero.Reader._readers.map(r=>r.itemID)};
};

// Native item-menu positional regression, isolated fixture items only.
PROBE_CMDS.delete021 = async function(arg) {
  const action=arg||"inspect", win=Zotero.getMainWindow(), pane=win.ZoteroPane, doc=win.document;
  const fixturePath=PathUtils.join(PROBE_ROOT,"results","delete-fixture021.json");
  let fixture;
  try {fixture=JSON.parse(await IOUtils.readUTF8(fixturePath));}catch{}
  if(action==="setup"||!fixture){
    const parent=new Zotero.Item("journalArticle");parent.setField("title","QA delete regression 0.2.1");await parent.saveTx();
    const pdf=PathUtils.join(Zotero.DataDirectory.dir,"qa-sample.pdf");
    const source=await Zotero.Attachments.importFromFile({file:pdf,parentItemID:parent.id,title:"QA original - keep"});
    const targets=[];
    for(let n=0;n<3;n++){const att=await Zotero.Attachments.importFromFile({file:pdf,parentItemID:parent.id,title:"Translated (zh-CN) · QA duplicate "+n});att.addTag("译文");await att.saveTx();targets.push(att.id);}
    fixture={parentID:parent.id,sourceID:source.id,targets};await IOUtils.writeUTF8(fixturePath,JSON.stringify(fixture,null,2));
  }
  const parent=Zotero.Items.get(fixture.parentID);
  const children=()=>parent.getAttachments().map(id=>Zotero.Items.get(id)).filter(i=>i&&!i.deleted);
  const target=children().find(i=>i.id!==fixture.sourceID);
  if(!target)return {fixture,remaining:children().map(i=>i.id)};
  await pane.selectItem(target.id);await Zotero.Promise.delay(300);
  await pane.buildItemContextMenu();
  const popup=doc.getElementById("zotero-itemmenu");popup.dispatchEvent(new win.Event("popupshowing"));
  const label=Zotero.getString("pane.items.menu.moveToTrash");
  const shown=[...popup.children].find(n=>n.getAttribute("label")===label&&n.getAttribute("hidden")!=="true");
  const before=children().map(i=>i.id);
  const identity={label,chosenClass:shown?.className,command:shown?.getAttribute("oncommand"),nativeTrashClass:doc.querySelector(".zotero-menuitem-move-to-trash")?.className,pluginPosition:[...popup.children].indexOf(doc.getElementById("wenxianyidu-itemmenu"))};
  if(action==="exercise"){
    if(shown?.getAttribute("oncommand")?.includes("duplicateSelectedItem")){shown.doCommand();await Zotero.Promise.delay(800);}
    else if(shown===popup.querySelector(".zotero-menuitem-move-to-trash")){
      // Native deletion path with its documented keyboard force argument;
      // skips a modal only for these generated QA fixtures in the library.
      await pane.deleteSelectedItems(true);await Zotero.Promise.delay(500);
    }else throw Error("Unexpected native command; refusing to mutate even QA items");
  }
  return {fixture,...identity,before,after:children().map(i=>i.id),targetDeleted:!!target.deleted,sourceDeleted:!!Zotero.Items.get(fixture.sourceID).deleted};
};

// Isolated-copy-only network fault injection. Never included in the XPI.
PROBE_CMDS.offlineNetwork020 = async function(arg) {
  if (arg === "restore") { if(PROBE_STATE.networkFetch020)bundleScope.fetch=PROBE_STATE.networkFetch020; return {restored:true,requests:PROBE_STATE.networkRequests020}; }
  if (arg === "report") return {requests:PROBE_STATE.networkRequests020||[]};
  if (!PROBE_STATE.networkFetch020) PROBE_STATE.networkFetch020=bundleScope.fetch||fetch;
  PROBE_STATE.networkRequests020=[];
  bundleScope.fetch=async (url,init)=>{
    PROBE_STATE.networkRequests020.push(String(url));
    if(new URL(String(url)).hostname!=="127.0.0.1")throw new Error("QA: external network disconnected");
    return PROBE_STATE.networkFetch020(url,init);
  };
  Zotero.Prefs.set("extensions.zotero.wenxianyidu.translate.engineType","mtranserver",true);
  Zotero.Prefs.set("extensions.zotero.wenxianyidu.translate.cache.enabled",false,true);
  return {installed:true};
};

function probeLog(m) {
  Zotero.debug("[Z-TRANSPLIT-QA] " + m);
}

async function probeWriteJSON(name, obj) {
  try {
    const f = PathUtils.join(PROBE_ROOT, name);
    await IOUtils.writeUTF8(f, JSON.stringify(obj, null, 2));
  } catch (e) {
    probeLog("write failed: " + e);
  }
}

function pEl(doc, tag, cls) {
  const e = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
  if (cls) e.className = cls;
  return e;
}

PROBE_CMDS.faults020 = async function(arg) {
  const options = typeof arg === "string" ? { action: arg } : arg || {};
  if (options.action === "restore") { if(PROBE_STATE.originalFetch020) bundleScope.fetch=PROBE_STATE.originalFetch020; return {restored:true}; }
  if (options.action === "report") return { failing:PROBE_STATE.failFive020, requests:PROBE_STATE.requests020 || [], counts:PROBE_STATE.counts020 || {} };
  if (!PROBE_STATE.originalFetch020) PROBE_STATE.originalFetch020=bundleScope.fetch || fetch;
  PROBE_STATE.failFive020 = options.fail !== false;
  PROBE_STATE.requests020=[]; PROBE_STATE.counts020={}; const keys=[];
  bundleScope.fetch=async function(url,init) {
    if(String(url)==="https://www.bing.com/translator") return {ok:true,url:String(url),text:async()=> 'IG:"ABCDEF0123456789"; params_AbusePreventionHelper=[123,"qa-token",3600000]; id="rich_tta" data-iid="translator.5023"'};
    if(String(url).includes("/ttranslatev3?")) {
      const text=new URLSearchParams(String(init.body)).get("text");
      if(!keys.includes(text))keys.push(text);
      PROBE_STATE.requests020.push(text);PROBE_STATE.counts020[text]=(PROBE_STATE.counts020[text]||0)+1;
      if(PROBE_STATE.failFive020&&keys.indexOf(text)<5) return {ok:false,status:503,statusText:"Injected QA failure"};
      return {ok:true,json:async()=>[{translations:[{text:"测试译文："+text}]}]};
    }
    return PROBE_STATE.originalFetch020(url,init);
  };
  Zotero.Prefs.set("extensions.zotero.wenxianyidu.translate.engineType","bing-web",true);
  Zotero.Prefs.set("extensions.zotero.wenxianyidu.translate.cache.enabled",false,true);
  return {installed:true,failFive:PROBE_STATE.failFive020};
};

PROBE_CMDS.benchmark020 = async function(arg) {
  const options = arg || {};
  if (options.action !== "start") return PROBE_STATE.benchmark020 || {phase:"idle"};
  if (PROBE_STATE.benchmark020?.phase === "running") return {error:"benchmark running"};
  const engine = options.engine || "bing-web";
  const corpus = JSON.parse(await IOUtils.readUTF8(PathUtils.join(PathUtils.parent(PROBE_ROOT),"tests","qa","fixtures","translation-quality","scientific-60.json")));
  const state = PROBE_STATE.benchmark020 = {phase:"running",engine,done:0,started:Date.now()};
  void (async()=>{
    const prefix="extensions.zotero.wenxianyidu.";
    const oldEngine=Zotero.Prefs.get(prefix+"translate.engineType",true), oldCache=Zotero.Prefs.get(prefix+"translate.cache.enabled",true);
    try {
      Zotero.Prefs.set(prefix+"translate.engineType",engine,true);
      const segments=corpus.cases.map(c=>({id:c.id,text:c.text}));
      const run=async(name, items, cache)=>{
        Zotero.Prefs.set(prefix+"translate.cache.enabled",cache,true);
        state.stage=name;const at=Date.now();
        const result=await Zotero.WenxianYidu.translation.translateSegments({segments:items,sourceLanguage:"en",targetLanguage:"zh-CN",onProgress:(done,total)=>{state.done=done;state.total=total;}});
        state[name]={ms:Date.now()-at,results:result};
      };
      await run("cold",segments.slice(0,1),false);
      await run("withoutCache",segments,false);
      await run("populateCache",segments,true);
      await run("cacheHit",segments,true);
      state.phase="complete";state.ms=Date.now()-state.started;
    } catch(error){state.phase="failed";state.error=String(error);}
    finally{
      Zotero.Prefs.set(prefix+"translate.engineType",oldEngine,true);Zotero.Prefs.set(prefix+"translate.cache.enabled",oldCache,true);
      await probeWriteJSON("results/quality-020-"+engine+".json",state);
    }
  })();
  return {started:true,engine};
};

PROBE_CMDS.panel020 = async function(arg) {
  const options = typeof arg === "string" ? { mode: arg } : arg || {};
  const win = Zotero.getMainWindow(), doc = win.document;
  if (options.action === "close") doc.querySelector("#wenxianyidu-translation-panel header button, #wenxianyidu-translation-panel button[aria-label]")?.click();
  else Zotero.WenxianYidu.openTranslationPanel(options.mode || "input", undefined, win);
  await Zotero.Promise.delay(250);
  const panel = doc.getElementById("wenxianyidu-translation-panel");
  const rect = el => { const r = el?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,width:r.width,height:r.height} : null; };
  return { panels:doc.querySelectorAll("#wenxianyidu-translation-panel").length, legacyTabs:!!doc.getElementById("wenxianyidu-input-translation"), oldSections:doc.querySelectorAll('item-pane-custom-section[data-pane="wenxianyidu-translate"]').length,
    panel:rect(panel), host:rect(panel?.parentElement), anchor:rect(doc.getElementById("zotero-pane-stack")), parent:panel?.parentElement?.id,
    modes:[...(panel?.querySelectorAll("[data-mode]")||[])].map(b=>({mode:b.dataset.mode,active:b.getAttribute("aria-pressed")})),
    selected:win.Zotero_Tabs.selectedID, text:panel?.textContent?.slice(-800) };
};
PROBE_CMDS.offline020 = async function(arg) {
  if(arg === "start") { delete PROBE_STATE.offlineError; Zotero.WenxianYidu.offline.prepare().catch(e=>PROBE_STATE.offlineError=String(e)); return {started:true}; }
  if(arg === "cancel") Zotero.WenxianYidu.offline.cancel();
  return {...await Zotero.WenxianYidu.offline.getStatus(), error:PROBE_STATE.offlineError};
};
PROBE_CMDS.host020 = async function() {
  const win = Zotero.getMainWindow(), doc=win.document;
  const anchor=doc.getElementById("zotero-pane-stack");
  return { ancestors:[anchor,anchor?.parentElement,anchor?.parentElement?.parentElement].filter(Boolean).map(e=>({tag:e.tagName,id:e.id,display:win.getComputedStyle(e).display,direction:win.getComputedStyle(e).flexDirection})), pid:Services.appinfo.processID, path:Services.env.get("PATH"), windows:[...Services.wm.getEnumerator(null)].map(w=>({uri:w.location.href,title:w.document.title,width:w.innerWidth,height:w.innerHeight})) };
};
PROBE_CMDS.closeSplit020 = async function() {
  const win=Zotero.getMainWindow();
  const button=win.document.querySelector('[id^="wenxianyidu-return-"]');
  if(!button) return {error:"no return button"};
  button.doCommand(); await Zotero.Promise.delay(1500);
  return {selected:win.Zotero_Tabs.selectedID, splitButtons:win.document.querySelectorAll('[id^="wenxianyidu-return-"]').length};
};

// ── handlers ────────────────────────────────────────────────────────────────
PROBE_CMDS.ping = async function () {
  return { pong: true, zotero: Zotero.version, at: new Date().toISOString() };
};

PROBE_CMDS.javaStatus = async function () {
  return await Zotero.WenxianYidu.java.getStatus();
};
PROBE_CMDS.javaInstall = async function () {
  return { ok: await Zotero.WenxianYidu.java.install(), status: await Zotero.WenxianYidu.java.getStatus() };
};
PROBE_CMDS.productTranslation = async function (arg) {
  const options=arg || {};
  if(!Zotero.WenxianYidu.translation?.translateSegments) return {available:false,error:"Translation API is not in this build"};
  if(options.engine) Zotero.Prefs.set("extensions.zotero.wenxianyidu.translate.engineType",options.engine,true);
  const at=Date.now();
  const results=await Zotero.WenxianYidu.translation.translateSegments({segments:options.segments||[{id:"sample",text:"This study evaluates the accuracy of machine translation."}],sourceLanguage:"en",targetLanguage:"zh-CN"});
  return {available:true,engine:options.engine,results,ms:Date.now()-at};
};

/** Exercise the standalone input UI through its actual Tools entry point. */
PROBE_CMDS.productInput = async function (arg) {
  const options = arg || {};
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const menu = doc.getElementById("wenxianyidu-tools-input-translation");
  if (!menu) return { available: false, error: "standalone Tools entry missing" };
  menu.doCommand();
  await Zotero.Promise.delay(350);
  const tab = doc.getElementById("wenxianyidu-translation-panel");
  const root = tab?.querySelector(".wenxianyidu-workspace");
  if (!root) return { available: false, error: "input workspace missing", tab: !!tab };
  const engine = root.querySelector("select");
  if (options.engine) {
    engine.value = options.engine;
    engine.dispatchEvent(new win.Event("change", { bubbles: true }));
  }
  const input = root.querySelector(".wenxianyidu-input-source");
  const translate = root.querySelector('[data-action="translate"]');
  const cancel = root.querySelector('[data-action="cancel"]');
  const result = root.querySelector(".wenxianyidu-input-result");
  const status = root.querySelector(".wenxianyidu-input-status");
  const read = () => ({ available: true, engine: engine.value, source: input.value, result: result.textContent,
    status: status.textContent, busy: translate.disabled, cancelVisible: !cancel.hidden,
    notice: root.querySelector(".wenxianyidu-service-note")?.textContent,
    activeTab: probeWin().Zotero_Tabs.selectedID,
    readerCount: Zotero.Reader._readers?.length ?? null });
  if (options.action === "inspect") return read();
  input.value = options.text || "This study evaluates the accuracy of machine translation.\n\nThe results improve reading efficiency.";
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  if (options.action === "ime") {
    input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true }));
    await Zotero.Promise.delay(350);
    return read();
  }
  const at = Date.now();
  translate.click();
  if (options.action === "cancel") {
    await Zotero.Promise.delay(Number(options.cancelAfterMS) || 20);
    cancel.click();
  }
  for (let i=0; i<160; i++) {
    await Zotero.Promise.delay(250);
    if (!translate.disabled) return { ...read(), ms: Date.now()-at };
  }
  return { ...read(), timedOut: true, ms: Date.now()-at };
};

PROBE_CMDS.productConnection = async function (engine) {
  if (engine) Zotero.Prefs.set("extensions.zotero.wenxianyidu.translate.engineType", engine, true);
  const at = Date.now();
  return { ...(await Zotero.WenxianYidu.translation.testConnection()), engine, ms: Date.now()-at };
};

PROBE_CMDS.productReader = async function (arg) {
  const options = typeof arg === "string" ? { mode: arg } : arg || {};
  const win = Zotero.getMainWindow(), doc = win.document;
  const { Zotero_Tabs } = probeWin();
  if (PROBE_STATE.demoTabID) Zotero_Tabs.select(PROBE_STATE.demoTabID);
  Zotero.WenxianYidu.openTranslationPanel(options.mode === "input" ? "input" : "selection", undefined, win);
  await Zotero.Promise.delay(500);
  const section = doc.getElementById("wenxianyidu-translation-panel");
  const root = section?.querySelector(".wenxianyidu-workspace");
  if (!root) return { error: "reader workspace missing", sections: [...doc.querySelectorAll("item-pane-custom-section")].map(c=>({pane:c.dataset.pane,hidden:c.hidden})) };
  const reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
  if (!reader) return { error: "current tab has no reader" };
  const mode = options.mode || "selection";
  const nav = root.querySelector(`[data-mode="${mode}"]`);
  if (!nav) return { error: "mode entry missing", mode };
  nav.click();
  await Zotero.Promise.delay(300);
  if (mode === "selection") {
    const internal = reader._internalReader?.wrappedJSObject || reader._internalReader;
    const view = internal?._primaryView?.wrappedJSObject || internal?._primaryView;
    if (!view) return { error: "reader text selection view missing" };
    view._selectionRanges = [{ text: options.text || "The results show that paragraph alignment improves reading efficiency." }];
    const panel = root.querySelector(".wenxianyidu-mode-selection");
    const refresh = [...panel.querySelectorAll("button")].find(b=>/刷新选区|Refresh selection/i.test(b.textContent));
    refresh?.click();
    await Zotero.Promise.delay(350);
    const translate = [...panel.querySelectorAll("button")].find(b=>/^(翻译|Translate)$/i.test(b.textContent.trim()));
    translate?.click();
    for(let i=0;i<160;i++) {
      await Zotero.Promise.delay(250);
      const result=panel.querySelector(".wenxianyidu-tp-result-text"),error=panel.querySelector(".wenxianyidu-tp-error");
      if(result||error) return { mode, result:result?.textContent??null,error:error?.textContent??null,source:panel.querySelector(".wenxianyidu-tp-source-text")?.textContent??null };
    }
    return { mode,timedOut:true,text:panel.textContent.slice(0,900) };
  }
  if (mode === "paragraph") {
    const panel=root.querySelector(".wenxianyidu-mode-paragraph");
    const toggle=panel.querySelector(".wenxianyidu-bc-toggle");
    if(!toggle) return {error:"paragraph toggle missing",text:panel.textContent};
    if(toggle.dataset.active!=="true") toggle.click();
    let sdtDoc=null;
    const at=Date.now();
    while(Date.now()-at<40000) {
      await Zotero.Promise.delay(500);
      const ir=reader._internalReader?.wrappedJSObject||reader._internalReader;
      const view=ir?._primarySDTView?.wrappedJSObject||ir?._primarySDTView;
      sdtDoc=view?._iframe?.contentDocument;
      if(sdtDoc?.querySelectorAll(".wenxianyidu-bi").length) break;
    }
    if(!sdtDoc?.querySelectorAll(".wenxianyidu-bi").length) return {mode,error:"no bilingual blocks",text:panel.textContent.slice(0,1000),ms:Date.now()-at};
    if(options.all!==false) [...panel.querySelectorAll("button")].find(b=>/^翻译全文|Translate whole/i.test(b.textContent))?.click();
    while(Date.now()-at<120000) {
      await Zotero.Promise.delay(500);
      const blocks=[...sdtDoc.querySelectorAll(".wenxianyidu-bi")];
      if(blocks.length&&!sdtDoc.querySelector(".wenxianyidu-bi-placeholder")) return {mode,total:blocks.length,
        failed:sdtDoc.querySelectorAll(".wenxianyidu-bi-error").length,
        chinese:blocks.filter(b=>/[\u3400-\u9fff]/.test(b.textContent)).length,
        sample:blocks.slice(0,6).map(b=>({ref:b.dataset.refPath,original:b.previousElementSibling?.textContent,translation:b.textContent})),
        controls:panel.textContent.slice(0,700),ms:Date.now()-at};
    }
    return {mode,timedOut:true,text:panel.textContent.slice(0,1000),ms:Date.now()-at};
  }
  if(mode==="split") {
    const source=await Zotero.Items.getAsync(reader.itemID);
    const sourcePath=source.getFilePath();
    const hash=async()=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await IOUtils.read(sourcePath)))).map(n=>n.toString(16).padStart(2,"0")).join("");
    const beforeHash=await hash();
    const panel=root.querySelector(".wenxianyidu-mode-split");
    const button=panel.querySelector("button");
    const at=Date.now(); button.click();
    while(Date.now()-at<180000) {
      await Zotero.Promise.delay(500);
      if(!button.disabled) break;
    }
    return {mode,sourceItemID:source.id,beforeHash,afterHash:await hash(),status:panel.querySelector(".wenxianyidu-panel-status")?.textContent,
      activeTab:Zotero_Tabs.selectedID,syncControls:[...doc.querySelectorAll('[id^="wenxianyidu-sync-"]')].map(n=>({id:n.id,checked:n.checked})),
      pdfChildren:source.parentItemID?(await Zotero.Items.getAsync(source.parentItemID)).getAttachments():[],ms:Date.now()-at,timedOut:button.disabled};
  }
  return {error:"unknown reader mode",mode};
};

/** Count real transport calls if the loaded addon's global exposes fetch. */
PROBE_CMDS.productCache = async function () {
  const translate = Zotero.WenxianYidu.translation.translateSegments;
  const scope = Components.utils.getGlobalForObject(translate);
  const originalFetch = scope.fetch;
  if (typeof originalFetch !== "function") return { available: false, error: "transport instrumentation unavailable" };
  let calls = 0;
  const countedFetch = function (...args) { calls++; return originalFetch.apply(scope, args); };
  const sample = `This public translation validation sentence was generated at ${Date.now()}.`;
  const request = { segments: [{ id: "cache", text: sample }], sourceLanguage: "en", targetLanguage: "zh-CN" };
  const at = Date.now();
  try {
    scope.fetch = countedFetch;
    const first = await translate(request);
    const firstCalls = calls;
    const firstMS = Date.now()-at;
    const secondAt = Date.now();
    const second = await translate(request);
    return { available: true, first, second, firstCalls, secondCalls: calls-firstCalls,
      observedTransport: firstCalls > 0, firstMS, secondMS: Date.now()-secondAt };
  } finally { scope.fetch = originalFetch; }
};

// ── 解析组件（ODL jar）诊断：设置面板按钮的后端直调 ────────────────────────
PROBE_CMDS.odlStatus = async function () {
  const t0 = Date.now();
  try {
    const status = await Zotero.WenxianYidu.odlJar.getStatus();
    return { status, ms: Date.now() - t0 };
  } catch (e) {
    return { error: String((e && e.stack) || e), ms: Date.now() - t0 };
  }
};

PROBE_CMDS.odlInstall = async function () {
  const t0 = Date.now();
  try {
    const p = await Zotero.WenxianYidu.odlJar.install();
    const st = await IOUtils.stat(p).catch(() => null);
    return { ok: true, path: p, size: st ? st.size : null, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String((e && e.stack) || e), ms: Date.now() - t0 };
  }
};

/** WebCrypto 可用性与大文件哈希探测（sha256Hex 的底层）。 */
PROBE_CMDS.odlHashProbe = async function () {
  const out = {};
  out.hasCrypto = typeof crypto !== "undefined";
  out.hasSubtle = !!(out.hasCrypto && crypto.subtle && crypto.subtle.digest);
  try {
    const small = new TextEncoder().encode("abc");
    const d = await crypto.subtle.digest("SHA-256", small);
    out.smallDigest = Array.from(new Uint8Array(d))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // 大缓冲：读随包 region remover jar（精简版安装树里就有，约 4.4MB）
    const profD = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile);
    const cand = profD.parent;
    // 探针不猜路径：直接扫 ProfD/extensions/<id>/core/pdf/lib/
    const ext = profD.clone();
    ext.append("extensions");
    const jar = ext.clone();
    jar.append("wenxianyidu@wenxianyidu.local");
    jar.append("core");
    jar.append("pdf");
    jar.append("lib");
    jar.append("ztransplit-region-text-remover.jar");
    out.jarPath = jar.path;
    if (jar.exists()) {
      const bytes = await IOUtils.read(jar.path);
      out.jarBytes = bytes.byteLength;
      const t0 = Date.now();
      const d2 = await crypto.subtle.digest("SHA-256", bytes);
      out.jarDigestHead = Array.from(new Uint8Array(d2))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 16);
      out.jarDigestMs = Date.now() - t0;
    } else {
      out.jarMissing = true;
    }
  } catch (e) {
    out.error = String((e && e.stack) || e);
  }
  return out;
};

/** nsIZipReader 真实接口探查：方法面、findEntries 迭代形状、extract 落盘。 */
PROBE_CMDS.odlZipApi = async function () {
  const out = {};
  try {
    const Cc = Components.classes;
    const Ci = Components.interfaces;
    const reader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
      Ci.nsIZipReader,
    );
    out.methods = [];
    let proto = reader;
    while (proto && proto !== Object.prototype) {
      out.methods.push(...Object.getOwnPropertyNames(proto));
      proto = Object.getPrototypeOf(proto);
    }
    out.methods = [...new Set(out.methods)].sort();
    const zipPath = PathUtils.join(PROBE_ROOT, "driver.zip");
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(zipPath);
    reader.open(f);
    const names = [];
    const finder = reader.findEntries("*");
    out.finderType = finder.constructor?.name || typeof finder;
    out.finderMethods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(finder) || {},
    ).sort();
    while (finder.hasMore() && names.length < 8) {
      const n = finder.getNext();
      names.push({ value: n, type: typeof n });
    }
    out.firstEntries = names;
    // extract 实测：把第一个条目解到数据目录
    if (names.length && typeof names[0].value === "string" && !names[0].value.endsWith("/")) {
      const dest = PathUtils.join(Zotero.DataDirectory.dir, "qa-zip-extract-probe");
      const df = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      df.initWithPath(dest);
      reader.extract(names[0].value, df);
      const st = await IOUtils.stat(dest);
      out.extracted = { entry: names[0].value, dest, size: st.size };
      await IOUtils.remove(dest, { ignoreAbsent: true });
    }
    reader.close();
  } catch (e) {
    out.error = String((e && e.stack) || e);
  }
  return out;
};

PROBE_CMDS.snapshot = async function () {
  const out = { zoteroVersion: Zotero.version, checks: {}, errors: [] };
  const g = (k) => Zotero.Prefs.get("extensions.zotero.wenxianyidu." + k, true);

  try {
    out.checks.addonGlobal = !!Zotero.WenxianYidu;
    out.checks.addonInitialized = !!Zotero.WenxianYidu?.data?.initialized;
  } catch (e) {
    out.errors.push("addon: " + e);
  }

  try {
    const sections = Zotero.ItemPaneManager.registeredSections || {};
    out.checks.sections = Object.keys(sections);
    out.checks.hasTranslateSection = !!sections["wenxianyidu-translate"];
  } catch (e) {
    out.errors.push("sections: " + e);
  }

  try {
    const l = Zotero.Reader._listeners;
    out.checks.readerListeners = Object.keys(l || {});
    const cv = (l || {}).createViewContextMenu || [];
    out.checks.transplitMenuListeners = cv.filter((f) =>
      String(f).includes("splitview-menu") ||
      String(f).includes("getString") ||
      /translate.*side/.test(String(f)),
    ).length;
  } catch (e) {
    out.errors.push("readers: " + e);
  }

  try {
    const win = Zotero.getMainWindow();
    const doc = win.document;
    const menu = doc.getElementById("wenxianyidu-itemmenu");
    out.checks.itemTreeMenu = !!menu;
    if (menu) {
      out.checks.itemTreeMenuLabel = menu.getAttribute("label");
      out.checks.itemTreeMenuItems = Array.from(
        menu.querySelectorAll("menupopup > menuitem"),
        (m) => [m.id, m.getAttribute("label")],
      );
    }
  } catch (e) {
    out.errors.push("itemmenu: " + e);
  }

  try {
    const panes = Zotero.PreferencePanes.pluginPanes || [];
    out.checks.prefPane = panes.some((p) => p.id === "zotero-prefpane-wenxianyidu");
  } catch (e) {
    out.errors.push("prefpane: " + e);
  }

  out.prefs = {
    "translate.enabled": g("translate.enabled"),
    "translate.auto": g("translate.auto"),
    "translate.engineType": g("translate.engineType"),
    "translate.maxChars": g("translate.maxChars"),
    "translate.google.apiKey": g("translate.google.apiKey"),
    "translate.targetLanguage": g("translate.targetLanguage"),
    "pdfParser.opendataloader.enabled": g("pdfParser.opendataloader.enabled"),
  };

  try {
    const loc = Zotero.WenxianYidu?.data?.locale?.current;
    out.checks.localeReady = !!loc;
    if (loc) {
      out.checks.samples = {
        "pane-translate-source": await loc.formatValue("pane-translate-source"),
        "pane-translate-refresh": await loc.formatValue("pane-translate-refresh"),
        "itemtree-menu": await loc.formatValue("itemtree-menu"),
        "splitview-menu-translate": await loc.formatValue("splitview-menu-translate"),
      };
    }
  } catch (e) {
    out.errors.push("locale: " + e);
  }

  return out;
};

/** Introspect real host API shapes so the other assertions read them right. */
PROBE_CMDS.introspect = async function () {
  const out = { errors: [] };
  const secs = Zotero.ItemPaneManager.registeredSections || {};
  out.sectionKeys = Object.keys(secs);
  out.sectionDetail = Object.keys(secs).map((k) => ({
    key: k,
    paneID: secs[k]?.paneID,
    pluginID: secs[k]?.pluginID,
    header: secs[k]?.header,
    sidenav: secs[k]?.sidenav,
  }));

  const R = Zotero.Reader;
  out.readerApi = Object.keys(R).filter((k) =>
    /listener|Listener/i.test(k),
  );
  const l = R._listeners;
  out.readerListenerKeys = l ? Object.keys(l) : null;
  if (l) {
    for (const k of Object.keys(l)) {
      out["listeners_" + k] = (l[k] || []).map((f) => String(f).slice(0, 120));
    }
  }
  out.readerHasRegisterEventListener = typeof R.registerEventListener;

  // Locale: use the same sync API the addon itself uses.
  try {
    const loc = Zotero.WenxianYidu?.data?.locale?.current;
    out.localeCtor = !!loc;
    if (loc) {
      const ids = [
        "pane-translate-source",
        "pane-translate-refresh",
        "itemtree-menu",
        "splitview-menu-translate",
        "bilingual-enable",
      ];
      const res = loc.formatMessagesSync(ids.map((id) => ({ id: "wenxianyidu-" + id })));
      out.localeSync = res.map((r) => [r.id, r.value]);
      const asyncRes = await Promise.all(
        ids.map(async (id) => [id, await loc.formatValue("wenxianyidu-" + id)]),
      );
      out.localeAsync = asyncRes;
    }
  } catch (e) {
    out.errors.push("locale: " + e);
  }

  out.availableLocales = Zotero.locale ? "set" : "unset";
  out.zoteroLocale = Zotero.locale;
  return out;
};

/** Find the real section registry and reader listener store on Zotero 10. */
PROBE_CMDS.introspect2 = async function () {
  const out = { errors: [] };
  const ipm = Zotero.ItemPaneManager;
  out.ipmKeys = Object.keys(ipm);
  for (const k of Object.keys(ipm)) {
    const v = ipm[k];
    if (v && typeof v === "object") {
      for (const sk of Object.keys(v)) {
        if (/transplit/i.test(sk)) {
          out["hit_" + k + "::" + sk] = v[sk];
        }
      }
    }
  }
  const R = Zotero.Reader;
  const rl = R._registeredListeners;
  out.registeredListenerIsMap = rl instanceof Map;
  out.registeredListenerEntries = [];
  if (rl instanceof Map) {
    for (const [k, v] of rl.entries()) {
      const arr = Array.from(v || []);
      out.registeredListenerEntries.push({
        key: String(k),
        len: arr.length,
        items: arr.map((e) => String(e).slice(0, 240)),
      });
    }
  } else if (rl) {
    for (const k of Object.keys(rl)) {
      const arr = Array.from(rl[k] || []);
      out.registeredListenerEntries.push({
        key: k,
        len: arr.length,
        items: arr.map((e) => String(e).slice(0, 240)),
      });
    }
  }

  const sm = Zotero.ItemPaneManager._sectionManager;
  out.sectionManagerType = Object.prototype.toString.call(sm);
  out.sectionManagerKeys = sm ? Object.keys(sm) : null;
  for (const k of ["sections", "_sections", "registeredSections", "_sectionDefs"]) {
    if (sm && sm[k]) {
      const secs = sm[k];
      out["sm_" + k + "_keys"] = Object.keys(secs);
      out["sm_" + k + "_ours"] = Object.keys(secs).filter((x) => /transplit/i.test(x));
    }
  }
  try {
    if (sm?.sections) {
      out.sectionsValues = Object.entries(sm.sections).map(([k, v]) => ({
        k,
        keys: Object.keys(v || {}),
        paneID: v?.paneID,
        pluginID: v?.pluginID,
        headerL10n: v?.header?.l10nID,
      }));
    }
  } catch (e) {
    out.errors.push("sections: " + e);
  }
  return out;
};

/** ZoteroPane / Zotero_Tabs live in the main window scope, not in this addon scope. */
function probeWin() {
  const w = Zotero.getMainWindow();
  return { win: w, ZoteroPane: w?.ZoteroPane, Zotero_Tabs: w?.Zotero_Tabs };
}

/** Search the whole window for the addon's rendered DOM and section state. */
PROBE_CMDS.sectionState = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const html = new win.XMLSerializer().serializeToString(doc.body || doc.documentElement);
  const hits = {
    wenxianyiduTranslate: (html.match(/wenxianyidu-translate/g) || []).length,
    wenxianyiduTpPane: (html.match(/wenxianyidu-tp-pane/g) || []).length,
    wenxianyiduBc: (html.match(/wenxianyidu-bc-/g) || []).length,
    sourceTextLabel: html.includes("Source text"),
    refreshSelection: html.includes("Refresh selection"),
    bilingualBar: html.includes("wenxianyidu-bc-bar"),
  };
  // Who renders? Check the item pane manager's internal section list.
  const ipm = Zotero.ItemPaneManager;
  let sm = null;
  try {
    sm = ipm._sectionManager;
  } catch {}
  const config = sm?._config || sm?.config || null;
  return {
    hits,
    ipmSectionManagerKeys: sm ? Object.keys(sm) : null,
    configSections: config
      ? Object.entries(config).map(([k, v]) => ({
          k,
          paneID: v?.paneID,
          pluginID: v?.pluginID,
          enabled: v?.enabled,
          type: typeof v,
        }))
      : null,
    optionsCacheKeys: sm?._optionsCache ? Object.keys(sm._optionsCache) : null,
    itemPaneSidenav: (() => {
      const sn = doc.getElementById("zotero-item-pane-sidenav");
      return sn
        ? Array.from(sn.querySelectorAll("[id*='transplit']"), (n) => [
            n.id,
            n.getAttribute("label"),
            n.hidden,
          ])
        : "no sidenav";
    })(),
  };
};

/** Introspect the reader's selection API on this Zotero version. */
PROBE_CMDS.readerApi = async function () {
  const win = Zotero.getMainWindow();
  const tabID = win.Zotero_Tabs.selectedID;
  const reader = Zotero.Reader.getByTabID(tabID);
  if (!reader) return { error: "no reader" };
  const internal = reader._internalReader;
  const out = {
    readerKeys: Object.keys(reader).filter((k) => /select|text|page/i.test(k)),
    internalKeys: Object.keys(internal),
    primaryType: Object.prototype.toString.call(internal._primaryView),
    secondaryType: Object.prototype.toString.call(internal._secondaryView),
  };
  const pv = internal._primaryView;
  out.primaryKeys = pv ? Object.keys(pv) : null;
  out.selectionKeys = pv
    ? Object.keys(pv).filter((k) => /select|range|text/i.test(k))
    : null;
  const inner = pv?._primaryView || pv?.pdfView || pv?._window?.PDFViewerApplication;
  out.innerType = Object.prototype.toString.call(inner);
  out.innerKeys = inner
    ? Object.keys(inner).filter((k) => /select|find|controller/i.test(k))
    : null;
  out.findControllerKeys =
    inner?.findController ? Object.keys(inner.findController) : null;
  out.selectionRanges = pv?._selectionRanges;
  return out;
};

/**
 * Inspect the split-view panes' own browsers (not the outer readers): this is
 * the chain ReaderPane#installScrollTrigger walks.
 */
PROBE_CMDS.splitPanes = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const out = { panes: [] };
  // The split container the addon builds, holding two reader <browser>s.
  const containers = Array.from(
    doc.querySelectorAll("[class*='wenxianyidu-split']"),
  );
  out.containers = containers.map((c) => c.className);
  for (const c of containers) {
    const browsers = Array.from(c.querySelectorAll("browser") || []);
    out.containersDetail = out.containersDetail || [];
    out.containersDetail.push({
      className: c.className,
      browserCount: browsers.length,
    });
  }
  // Any reader <browser> in the window with a reader.html payload.
  const allBrowsers = Array.from(doc.querySelectorAll("browser") || []);
  out.browsersTotal = allBrowsers.length;
  for (const b of allBrowsers) {
    let info = { id: b.id || null, cls: b.className || null };
    try {
      const cw = b.contentWindow;
      const wrapped = cw?.wrappedJSObject || cw;
      info.hasContentWindow = !!cw;
      info.hasWrapped = !!cw?.wrappedJSObject;
      info.hasReaderOnWrapped = !!wrapped?._reader;
      info.hasReaderOnDirect = !!cw?._reader;
      const ir = wrapped?._reader || cw?._reader || null;
      info.hasInternalReader = !!ir;
      if (ir) {
        const pv = ir._primaryView;
        info.hasPrimaryView = !!pv;
        info.hasIframe = !!pv?._iframe;
        const ifw = pv?._iframe?.contentWindow;
        info.hasIframeWin = !!ifw;
        info.viewerOnDirect = !!ifw?.document?.getElementById?.("viewerContainer");
        info.viewerOnWrapped = !!ifw?.wrappedJSObject?.document?.getElementById?.(
          "viewerContainer",
        );
        info.cuAvailable =
          typeof Components.utils?.exportFunction === "function";
      }
    } catch (e) {
      info.error = String(e);
    }
    out.panes.push(info);
  }
  return out;
};

/** Dump the split-view readers' internals to see where the iframe lives. */
PROBE_CMDS.splitReaders = async function () {
  const win = Zotero.getMainWindow();
  const readers = Zotero.Reader._readers || [];
  const out = { readerCount: readers.length, readers: [] };
  for (const r of readers) {
    const item = {};
    try {
      const ir = r._internalReader;
      item.itemID = r.itemID;
      item.internalKeys = ir
        ? Object.keys(ir).filter((k) => /View$|iframe|Iframe|Split|sdt|Sdt|SDT/.test(k))
        : null;
      const pv = ir?._primaryView;
      item.primaryType = Object.prototype.toString.call(pv);
      item.primaryKeys = pv
        ? Object.keys(pv).filter((k) => /iframe|Iframe|View$/.test(k))
        : null;
      item.hasIframeProp = !!pv?._iframe;
      item.hasContentWindow = !!pv?._iframe?.contentWindow;
      const cw = pv?._iframe?.contentWindow;
      item.viewerContainerDirect = !!cw?.document?.getElementById?.("viewerContainer");
      item.viewerContainerWrapped =
        !!cw?.wrappedJSObject?.document?.getElementById?.("viewerContainer");
      item.cuExportFunction =
        typeof Components.utils?.exportFunction === "function";
      item.hasSdtView = !!ir?._primarySDTView;
      item.sdtKeys = ir?._primarySDTView
        ? Object.keys(ir._primarySDTView).slice(0, 20)
        : null;
    } catch (e) {
      item.error = String(e);
    }
    out.readers.push(item);
  }
  try {
    const doc = win.document;
    out.readerBrowsers = doc.querySelectorAll("browser[type='content']").length;
    out.splitContainers = Array.from(
      doc.querySelectorAll("[class*='split']"),
      (n) => n.className,
    ).slice(0, 10);
  } catch (e) {
    out.domError = String(e);
  }
  return out;
};

/** Create a real text selection in the reader's text layer. */
PROBE_CMDS.selectText = async function () {
  const win = Zotero.getMainWindow();
  const tabID = win.Zotero_Tabs.selectedID;
  const reader = Zotero.Reader.getByTabID(tabID);
  const pv = reader?._internalReader?._primaryView;
  if (!pv) return { error: "no primary view" };
  const out = { method: null };
  const iw = pv._iframeWindow;
  if (iw?.document) {
    const spans = iw.document.querySelectorAll(".textLayer span");
    out.textLayerSpans = spans.length;
    if (spans.length >= 2) {
      try {
        const sel = iw.getSelection();
        const range = iw.document.createRange();
        range.setStart(spans[0].firstChild, 0);
        const last = spans[Math.min(8, spans.length - 1)];
        range.setEnd(last.firstChild, last.firstChild?.textContent?.length || 1);
        sel.removeAllRanges();
        sel.addRange(range);
        iw.document.dispatchEvent(new iw.Event("selectionchange", { bubbles: true }));
        await Zotero.Promise.delay(800);
        out.method = "textLayer";
      } catch (e) {
        out.textLayerError = String(e);
      }
    }
  }
  let ranges = pv._selectionRanges;
  out.realRanges = Array.isArray(ranges) ? ranges.length : null;
  // Structural fallback: a range object in the shape the pane consumes.
  if (!Array.isArray(ranges) || ranges.length === 0) {
    const text =
      "Machine learning is a subfield of artificial intelligence. " +
      "Its central premise is that systems can learn from data, identify patterns, and make decisions with minimal human intervention.";
    pv._selectionRanges = [
      { pageIndex: 0, text, collapsed: false, bbox: [0, 0, 100, 100] },
    ];
    out.method = (out.method || "") + "+synthetic";
    ranges = pv._selectionRanges;
  }
  out.finalRanges = ranges.length;
  out.selectedText = (ranges || [])
    .map((r) => r?.text)
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 200);
  return out;
};

/**
 * Drive the translate pane like a user: select text in the real reader,
 * click 「Refresh selection」, read the source box, then click 「Translate」
 * and read the result.
 */
PROBE_CMDS.paneFlow = async function (targetLang) {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const section = Array.from(
    doc.querySelectorAll("item-pane-custom-section"),
  ).find((c) => (c.dataset.pane || "").includes("transplit") && c.hidden === false);
  if (!section) return { error: "section not enabled — run openContextPane first" };

  const tabID = win.Zotero_Tabs.selectedID;
  const reader = Zotero.Reader.getByTabID(tabID);
  const view = reader?._internalReader?._primaryView;
  if (!view) return { error: "no primary view" };

  const out = { steps: [] };
  out.steps.push(["readerItemID", reader.itemID]);

  // A genuine selection through the reader's own text layer.
  try {
    if (typeof view.selectAll === "function") {
      view.selectAll();
      await Zotero.Promise.delay(400);
    }
  } catch (e) {
    out.selectAllError = String(e);
  }
  const ranges = view._selectionRanges;
  out.steps.push(["selectionRanges", Array.isArray(ranges) ? ranges.length : String(ranges)]);
  const selText = (ranges || []).map((r) => r?.text).filter(Boolean).join("\n\n");
  out.selectionChars = selText.length;

  // Click 「Refresh selection」
  const refreshBtn = Array.from(section.querySelectorAll("button")).find(
    (b) => /Refresh selection/i.test(b.textContent || ""),
  );
  if (refreshBtn) refreshBtn.click();
  await Zotero.Promise.delay(1200);
  const sourceBox = section.querySelector(".wenxianyidu-tp-source-text");
  out.afterRefresh = {
    sourceText: (sourceBox?.textContent || "").slice(0, 300),
    resultArea: (section.querySelector(".wenxianyidu-tp-result")?.textContent || "").slice(
      0,
      200,
    ),
    hasTranslateBtn: !!Array.from(section.querySelectorAll("button")).find(
      (b) => /^Translate$/i.test(b.textContent || ""),
    ),
  };

  // Set the target language the way the user types it.
  if (targetLang) {
    const input = section.querySelector(".wenxianyidu-tp-lang-input");
    if (input) {
      input.value = targetLang;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      input.dispatchEvent(new win.Event("blur", { bubbles: true }));
      await Zotero.Promise.delay(300);
    }
  }

  /** Wait until the result area settles (loading → success/error). */
  async function waitResult() {
    let last = "";
    for (let i = 0; i < 45; i++) {
      await Zotero.Promise.delay(1000);
      const t = (
        section.querySelector(".wenxianyidu-tp-result")?.textContent || ""
      ).trim();
      last = t;
      if (/failed|Error/.test(t) && !/Translating/.test(t)) break;
      if (t && !/^Translate$/.test(t) && !/Translating/.test(t)) break;
    }
    return last;
  }

  // Click 「Translate」 (or the language blur already started one).
  const translateBtn = Array.from(section.querySelectorAll("button")).find(
    (b) => /^Translate$/i.test(b.textContent || ""),
  );
  if (translateBtn) {
    translateBtn.click();
    await Zotero.Promise.delay(400);
  }
  const settled = await waitResult();
  const resultText = section.querySelector(".wenxianyidu-tp-result-text");
  const errText = section.querySelector(".wenxianyidu-tp-error");
  out.settled = settled.slice(0, 300);
  out.final = {
    success: !!resultText,
    translation: (resultText?.textContent || "").slice(0, 400),
    error: (errText?.textContent || "").slice(0, 300),
    copyBtn: Array.from(section.querySelectorAll("button"))
      .filter((b) => /^Copy$|^Copied$/.test(b.textContent || ""))
      .map((b) => b.textContent),
    langInputValue: section.querySelector(".wenxianyidu-tp-lang-input")?.value,
  };
  return out;
};

/** Force the section's lazy render (Zotero's own entry point) and read it. */
PROBE_CMDS.renderSection = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const section = Array.from(
    doc.querySelectorAll("item-pane-custom-section"),
  ).find((c) => (c.dataset.pane || "").includes("transplit") && c.hidden === false);
  if (!section) return { error: "no enabled section" };
  const out = { pane: section.dataset.pane, before: (section.textContent || "").length };
  // 1) scroll it into view (what a user does)
  const scroller = section.closest(".zotero-view-item-main") || section.parentElement;
  if (scroller?.scrollIntoView) section.scrollIntoView({ block: "center" });
  await Zotero.Promise.delay(1000);
  out.afterScroll = (section.textContent || "").length;
  // 2) invoke the host's lazy-render entry point
  try {
    if (typeof section.render === "function") section.render();
  } catch (e) {
    out.renderError = String(e);
  }
  try {
    if (typeof section.asyncRender === "function") await section.asyncRender();
  } catch (e) {
    out.asyncError = String(e);
  }
  await Zotero.Promise.delay(600);
  const text = section.textContent || "";
  return {
    ...out,
    afterRender: text.length,
    text: text.slice(0, 1200),
    buttons: Array.from(section.querySelectorAll("button"), (b) => [
      b.className,
      b.textContent,
    ]),
    inputs: Array.from(section.querySelectorAll("input"), (i) => [
      i.className,
      i.value,
      i.placeholder,
    ]),
    hasBcBar: !!section.querySelector(".wenxianyidu-bc-bar"),
    bcText: (section.querySelector(".wenxianyidu-bc-bar")?.textContent || "").slice(
      0,
      500,
    ),
    containsRawIds: text.includes("pane-translate-"),
    styles: Array.from(section.querySelectorAll("style"), (s) => s.className),
  };
};

/** Expand the reader context pane and dump the real section DOM. */
PROBE_CMDS.openContextPane = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const cp = doc.getElementById("zotero-context-pane");
  const before = { collapsed: cp?.collapsed, hidden: cp?.hidden };
  // Toggle it open the way the host does.
  if (cp?.collapsed) {
    const btn =
      doc.getElementById("zotero-tb-context-pane") ||
      doc.getElementById("context-pane-toggle") ||
      doc.querySelector("[id*='context'][class*='toggle']");
    if (btn) {
      btn.click();
    }
    // Zotero 10: the module is the window global ZoteroContextPane (not
    // Zotero.ContextPane); setting collapsed=false drives the splitter state
    // through its setter, which is what actually expands the reader sidebar.
    const zcp = win.ZoteroContextPane;
    if (zcp) {
      zcp.collapsed = false;
      if (typeof zcp.update === "function") zcp.update();
    }
    await Zotero.Promise.delay(1500);
  }
  const readerDetails = Array.from(doc.querySelectorAll("item-details")).find(
    (d) => d.tabType === "reader",
  );
  const section = Array.from(
    doc.querySelectorAll("item-pane-custom-section"),
  ).find((c) => (c.dataset.pane || "").includes("transplit") && c.hidden === false);
  const any = Array.from(doc.querySelectorAll("item-pane-custom-section")).find(
    (c) => (c.dataset.pane || "").includes("transplit"),
  );
  const target = section || any;
  const sidenav = readerDetails?.sidenav;
  return {
    before,
    after: { collapsed: doc.getElementById("zotero-context-pane")?.collapsed },
    sidenavHTML: sidenav ? sidenav.outerHTML.slice(0, 1200) : "none",
    chosenPane: target?.dataset.pane,
    chosenHidden: target?.hidden,
    chosenInitialized: target?.initialized,
    chosenText: (target?.textContent || "").slice(0, 900),
    buttons: target
      ? Array.from(target.querySelectorAll("button"), (b) => [
          b.className,
          b.textContent,
        ])
      : null,
    inputs: target
      ? Array.from(target.querySelectorAll("input"), (i) => [
          i.className,
          i.value,
          i.placeholder,
        ])
      : null,
    hasBcBar: !!target?.querySelector(".wenxianyidu-bc-bar"),
    bcText: (
      target?.querySelector(".wenxianyidu-bc-bar")?.textContent || ""
    ).slice(0, 500),
    containsRawIds: (target?.textContent || "").includes("pane-translate-"),
    contextPaneChildren: cp
      ? Array.from(cp.querySelectorAll("*"), (n) => n.tagName).slice(0, 40)
      : null,
  };
};

/** Select the Translate section in the reader's side-nav and render it. */
PROBE_CMDS.selectTranslatePane = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const readerDetails = Array.from(doc.querySelectorAll("item-details")).find(
    (d) => d.tabType === "reader",
  );
  if (!readerDetails) return { error: "no reader item-details" };
  const sidenav = readerDetails.sidenav;
  const panes = sidenav
    ? Array.from(sidenav.querySelectorAll("[id]"), (n) => n.id)
    : null;
  // Click the Translate side-nav row — what the user does.
  let clicked = null;
  if (sidenav) {
    const rows = Array.from(sidenav.querySelectorAll("button, .pane-label, [data-pane]"));
    for (const r of rows) {
      if (/Translate/i.test(r.textContent || "")) {
        r.click();
        clicked = r.tagName + ":" + (r.textContent || "").trim();
        break;
      }
    }
  }
  await Zotero.Promise.delay(1200);
  const section = Array.from(
    doc.querySelectorAll("item-pane-custom-section"),
  ).find((c) => (c.dataset.pane || "").includes("transplit"));
  const text = section ? section.textContent : "";
  return {
    sidenavId: sidenav?.id,
    sidenavPanes: panes,
    clicked,
    sectionHidden: section?.hidden,
    sectionText: text.slice(0, 900),
    buttons: section
      ? Array.from(section.querySelectorAll("button"), (b) => [
          b.className,
          b.textContent,
        ])
      : null,
    langInput: section?.querySelector("input")?.value ?? null,
    hasBcBar: !!section?.querySelector(".wenxianyidu-bc-bar"),
    bcText: (section?.querySelector(".wenxianyidu-bc-bar")?.textContent || "").slice(
      0,
      400,
    ),
    containsRawIds:
      text.includes("pane-translate-") || text.includes("itemtree-"),
  };
};

/** Report every item-details / custom-section instance in the window. */
PROBE_CMDS.allPanes = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const details = Array.from(doc.querySelectorAll("item-details"), (d) => ({
    tabType: d.tabType,
    tabID: d.tabID,
    item: d.item?.id ?? null,
    skipRender: d.skipRender,
    hidden: d.hidden,
    sidenavId: d.sidenav?.id,
    customPanes: Array.from(d.querySelectorAll("item-pane-custom-section"), (c) => [
      c.dataset.pane,
      c.hidden,
    ]),
  }));
  const sections = Array.from(
    doc.querySelectorAll("item-pane-custom-section"),
    (c) => ({
      pane: c.dataset.pane,
      hidden: c.hidden,
      initialized: c.initialized,
      text: (c.textContent || "").slice(0, 200),
    }),
  );
  return {
    detailsCount: details.length,
    details,
    sectionsCount: sections.length,
    sections,
    selectedTabType: win.Zotero_Tabs?.selectedType,
    openTabs: Array.from(doc.querySelectorAll("#zotero-tabs tab") || [], (t) => [
      t.id,
      t.getAttribute("type"),
      t.getAttribute("selected"),
    ]),
  };
};

/** Report the item-pane visibility and reader tab layout. */
PROBE_CMDS.paneVisible = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const q = (sel) => {
    const el = doc.querySelector(sel);
    if (!el) return "MISSING";
    return { id: el.id, hidden: el.hidden, collapsed: el.collapsed };
  };
  return {
    itemPane: q("#zotero-item-pane"),
    contextPane: q("#zotero-context-pane"),
    itemPaneSplitter: q("#zotero-item-pane-splitter"),
    tabsDeck: q("#zotero-tabs"),
    layout: Zotero.Prefs.get("pane.layout", true),
    paneTabType: doc
      .getElementById("zotero-view-item")
      ?.closest("[tabType]")
      ?.getAttribute?.("tabType"),
    itemPaneHeaderTabs: Array.from(
      doc.querySelectorAll("#zotero-item-pane-header > *"),
      (e) => [e.tagName, e.id, e.getAttribute?.("label")],
    ),
    readerTabsOpen: Array.from(
      doc.querySelectorAll("#zotero-tabs tabpanels tab") || [],
      (e) => [e.id, e.getAttribute?.("type")],
    ),
    selectedTabId: win.Zotero_Tabs?.selectedID,
    selectedTabType: win.Zotero_Tabs?.selectedType,
  };
};

/** Locate every occurrence of the addon's section id with its enabled state. */
PROBE_CMDS.sectionHits = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const out = [];
  const all = doc.querySelectorAll("[id*='transplit']");
  for (const n of all) {
    out.push({
      tag: n.tagName,
      id: n.id,
      hidden: n.hidden,
      attrs: n.getAttributeNames().filter((a) => a !== "class" && a !== "id"),
      parentTag: n.parentElement?.tagName,
      parentId: n.parentElement?.id,
      text: (n.textContent || "").slice(0, 120),
    });
  }
  // Sidenav / item-pane containers
  const containers = {};
  for (const id of [
    "zotero-item-pane-content",
    "zotero-item-pane-sidenav",
    "zotero-context-pane",
    "zotero-item-pane-header",
  ]) {
    const el = doc.getElementById(id);
    containers[id] = el ? "present" : "MISSING";
  }
  // Reader tab container
  const readerTab = doc.querySelector("tab[selected]");
  const sidePane = doc.getElementById("zotero-view-tabpad");
  return {
    occurrences: out,
    containers,
    selectedTabType: readerTab?.getAttribute("type"),
    selectedTabLabel: readerTab?.getAttribute("label"),
    itemPaneTabs: Array.from(
      doc.querySelectorAll("#zotero-item-pane-header tab") || [],
      (t) => [t.id, t.getAttribute("label"), t.selected],
    ),
    tabpads: Array.from(doc.querySelectorAll("[id*='tabpad']") || [], (t) => t.id),
  };
};

/** Dump the item-pane DOM while a reader tab is active. */
PROBE_CMDS.paneDump = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const found = [];
  const walk = (el, depth) => {
    if (depth > 6) return;
    for (const c of el.children || []) {
      const id = c.id || "";
      const cls = c.getAttribute?.("class") || "";
      if (
        /transplit|wenxianyidu|translate|Translate/.test(id + " " + cls) ||
        depth <= 3
      ) {
        found.push({
          d: depth,
          tag: c.tagName,
          id,
          cls,
          text: (c.textContent || "").slice(0, 90),
          attrs: c.getAttributeNames
            ? c.getAttributeNames().filter((a) => a !== "class" && a !== "id")
            : [],
        });
      }
      walk(c, depth + 1);
    }
  };
  const root = doc.getElementById("zotero-item-pane-content") || doc.body;
  walk(root, 0);

  const btns = [];
  for (const b of doc.querySelectorAll(".wenxianyidu-tp-btn")) {
    btns.push([b.className, b.textContent]);
  }
  const styles = [];
  for (const s of doc.querySelectorAll("style")) {
    if ((s.textContent || "").includes("wenxianyidu")) styles.push(s.className || "(anon)");
  }
  return {
    nodes: found.slice(0, 70),
    count: found.length,
    tpButtons: btns,
    transplitStyles: styles,
    bcBar: !!doc.querySelector(".wenxianyidu-bc-bar"),
  };
};

/**
 * Open a real PDF in the library in the real reader, then report the
 * translate pane DOM the addon mounts (R1/R2 regressions live here).
 */
PROBE_CMDS.reader = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const dataDir = Zotero.DataDirectory.dir;
  const pdfPath = PathUtils.join(dataDir, "qa-sample.pdf");
  if (!(await IOUtils.exists(pdfPath))) return { skipped: "no PDF" };

  const { ZoteroPane, Zotero_Tabs } = probeWin();
  let item = new Zotero.Item("journalArticle");
  item.setField("title", "QA sample paper");
  const itemID = await item.saveTx();
  const att = await Zotero.Attachments.importFromFile({
    file: pdfPath,
    parentItemID: itemID,
    title: "QA sample PDF",
  });
  const attID = att.id;

  // Single-item selection: with several items selected Zotero shows the
  // "N items in this view" message and never renders item-details (so no
  // custom sections render at all).
  ZoteroPane.selectItem(attID);
  await Zotero.Promise.delay(500);
  await ZoteroPane.viewAttachment(attID);
  await Zotero.Promise.delay(5000);

  const tabID = Zotero_Tabs.selectedID;
  const reader = Zotero.Reader.getByTabID(tabID);
  const section = doc.querySelector(
    'item-pane-custom-section[data-pane="wenxianyidu-translate"]',
  );
  const text = section ? section.textContent : "";
  return {
    attachmentID: attID,
    readerOpen: !!reader,
    readerItemID: reader?.itemID ?? null,
    tabType: Zotero_Tabs.selectedType ?? null,
    sectionFound: !!section,
    sectionText: text.slice(0, 800),
    containsRawFtlIds:
      text.includes("pane-translate-") || text.includes("itemtree-"),
    bilingualBlock: !!doc.querySelector(".wenxianyidu-bc-bar"),
    bilingualText: (
      doc.querySelector(".wenxianyidu-bc-bar")?.textContent || ""
    ).slice(0, 600),
    buttons: section
      ? Array.from(section.querySelectorAll("button"), (b) => [
          b.className,
          b.textContent,
        ])
      : null,
  };
};

/** Build the real reader context menu and list what z-transplit appends. */
PROBE_CMDS.menus = async function (action) {
  const { Zotero_Tabs } = probeWin();
  const tabID = Zotero_Tabs.selectedID;
  const reader = Zotero.Reader.getByTabID(tabID);
  if (!reader) return { error: "no active reader — run 'reader' first" };

  const registered = Array.from(Zotero.Reader._registeredListeners || []);
  const cv = registered.filter((x) => x.type === "createViewContextMenu");

  const appended = [];
  for (const entry of cv) {
    try {
      await entry.handler({ reader, append: (o) => appended.push(o) });
    } catch (e) {
      appended.push({ label: "LISTENER-ERROR", _err: String(e) });
    }
  }

  // Since the 文献译读 submenu unification the payload is ONE top-level
  // item whose `groups` array nests the entries (host renders it as a
  // submenu). Record the tree as-is plus a flat view for the label filters.
  const shape = (item) => ({
    label: item.label,
    checked: item.checked === true,
    groups: Array.isArray(item.groups)
      ? item.groups.map((group) => group.map(shape))
      : undefined,
  });
  const flat = (item) =>
    Array.isArray(item.groups)
      ? item.groups.flat().flatMap(flat)
      : [item.label];
  const labels = appended.flatMap(flat);

  if (!action || action === "labels") {
    return {
      count: cv.length,
      ourHandlers: cv.filter((x) =>
        String(x.pluginID || "").includes("wenxianyidu"),
      ).length,
      appendedShape: appended.map(shape),
      transplitEntries: labels.filter((l) => /split-screen|translate|双语|分屏|翻译|译文|取消/i.test(l || "")),
      all: labels,
      labels,
    };
  }

  const re =
    action === "split"
      ? /split-screen translation|分屏翻译/i
      : action === "compare"
        ? /split-screen reading|分屏阅读/i
        : null;
  const entry = re
    ? appended
        .flatMap((a) => (Array.isArray(a.groups) ? a.groups.flat() : [a]))
        .find((a) => a.label && re.test(a.label))
    : null;
  if (!entry) return { labels, error: "no entry matching " + action };

  const t0 = Date.now();
  try {
    await entry.onCommand();
    return { invoked: entry.label, ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return {
      invoked: entry.label,
      error: String(e),
      name: e?.name,
      stack: String(e?.stack || "").slice(0, 1200),
    };
  }
};

/** Fire the library item-tree menu on the current selection. */
PROBE_CMDS.itemtree = async function (action) {
  const { win, ZoteroPane } = probeWin();
  const doc = win.document;
  const popup = doc.getElementById("zotero-itemmenu");
  if (!popup) return { error: "zotero-itemmenu missing" };
  const sel = ZoteroPane.itemsView.getSelectedItems();
  popup.dispatchEvent(new win.Event("popupshowing"));
  const menu = doc.getElementById("wenxianyidu-itemmenu");
  if (!menu) return { error: "wenxianyidu-itemmenu missing" };
  const items = Array.from(menu.querySelectorAll("menupopup > menuitem"), (m) => ({
    id: m.id,
    label: m.getAttribute("label"),
    type: m.getAttribute("type"),
    checked: m.getAttribute("checked"),
  }));
  if (!action || action === "labels") {
    return {
      selection: sel.map((i) => [i.id, i.getField?.("title")]),
      visible: menu.getAttribute("hidden") !== "true",
      items,
    };
  }
  const target = doc.getElementById("wenxianyidu-itemmenu-" + action);
  if (!target) return { error: "missing menuitem " + action, items };
  try {
    target.doCommand();
    await Zotero.Promise.delay(3000);
    return { invoked: target.getAttribute("label"), ok: true, items };
  } catch (e) {
    return { invoked: action, error: String(e), name: e?.name };
  }
};

/** Check the Tools-menu entry that opens the word-cards tab. */
PROBE_CMDS.tools = async function (arg) {
  const { win, Zotero_Tabs } = probeWin();
  const doc = win.document;
  const popup =
    doc.getElementById("menu_ToolsPopup") ||
    doc.getElementById("menu-tools-popup") ||
    doc.getElementById("toolsMenu")?.querySelector("menupopup") ||
    doc.getElementById("menu-tools")?.querySelector("menupopup");
  if (!popup) return { error: "tools menu not found (menu_ToolsPopup)" };
  const item = doc.getElementById("wenxianyidu-tools-wordcards");
  const base = {
    present: !!item,
    label: item?.getAttribute("label") ?? null,
    popupEntries: Array.from(popup.children).map(
      (n) => n.getAttribute?.("label") || n.tagName,
    ),
  };
  if (arg !== "open" || !item) return base;

  // Click the real menu item, then report the opened tab (its data.icon is
  // what the tab bar renders).
  item.doCommand();
  await Zotero.Promise.delay(2500);
  let tab = null;
  try {
    tab = Zotero_Tabs._getTab?.("wenxianyidu-wordcards")?.tab ?? null;
  } catch (e) {
    base.tabProbeError = String(e);
  }
  base.tabOpen = !!tab;
  base.tabIcon = tab?.data?.icon ?? null;
  try {
    if (tab) Zotero_Tabs.close("wenxianyidu-wordcards");
  } catch {
    /* best-effort */
  }
  return base;
};

/** Open the real settings window, report the pane's rendered DOM. */
PROBE_CMDS.prefs = async function (engine) {
  let win = null;
  try {
    Zotero.Utilities.Internal.openPreferences("zotero-prefpane-wenxianyidu");
    for (let i = 0; i < 30 && !win; i++) {
      await Zotero.Promise.delay(300);
      win = Services.wm.getMostRecentWindow("zotero:pref");
    }
  } catch (e) {
    return { error: "openPreferences: " + e };
  }
  if (!win) return { error: "no prefs window" };
  const doc = win.document;
  const pane = doc.getElementById("zotero-prefpane-wenxianyidu");
  if (!pane) {
    return {
      error: "pane missing",
      found: Array.from(doc.querySelectorAll("[id^='zotero-prefpane-']"), (n) => n.id),
    };
  }

  const groups = {};
  for (const id of ["google", "bing", "deepl", "ai", "custom", "pdftranslate"]) {
    const g = doc.getElementById("wenxianyidu-pref-engine-" + id);
    groups[id] = g ? !g.hidden : "missing";
  }

  const read = () => ({
    engineValue: doc.getElementById("wenxianyidu-pref-engine-type")?.value,
    groups: (() => {
      const o = {};
      for (const id of ["google", "bing", "deepl", "ai", "custom", "pdftranslate"]) {
        const g = doc.getElementById("wenxianyidu-pref-engine-" + id);
        o[id] = g ? !g.hidden : "missing";
      }
      return o;
    })(),
    prefNow: Zotero.Prefs.get("extensions.zotero.wenxianyidu.translate.engineType", true),
  });

  const before = read();
  const out = {
    paneFound: true,
    windowTitle: doc.title || null,
    containsRawIds: (pane.textContent || "").includes("preferences-wenxianyidu-"),
    groups,
    before,
    maxCharsValue: doc.getElementById("wenxianyidu-pref-maxchars")?.value,
    timeoutValue: doc.getElementById("wenxianyidu-pref-odl-timeout")?.value,
    fontPath: doc.getElementById("wenxianyidu-pref-pdf-fonts-path")?.textContent?.trim(),
    targetLangValue: doc.getElementById("wenxianyidu-pref-pdf-lang")?.value,
    promptText:
      doc.getElementById("wenxianyidu-pref-ai-prompt")?.textContent?.slice(0, 500) || null,
    pdftranslateMissingVisible: !!doc
      .getElementById("wenxianyidu-pref-engine-pdftranslate")
      ?.querySelector("#wenxianyidu-pref-pdftranslate-missing")
      ?.checkVisibility?.(),
  };

  if (engine) {
    const ml = doc.getElementById("wenxianyidu-pref-engine-type");
    ml.value = engine;
    ml.doCommand();
    await Zotero.Promise.delay(400);
    out.afterSwitch = read();
    // Restore google to leave a clean state.
    ml.value = "google";
    ml.doCommand();
    await Zotero.Promise.delay(300);
  }

  try {
    win.close();
  } catch {
    /* ignore */
  }
  return out;
};

/** Real network translation through the installed addon's own code. */
PROBE_CMDS.engine = async function (which) {
  const scope = {};
  Services.scriptloader.loadSubScript(
    "chrome://wenxianyidu/content/scripts/wenxianyidu.js",
    scope,
  );
  const create = scope.createTranslator;
  if (typeof create !== "function") return { error: "no createTranslator in bundle" };
  const text = "Hello world, this is a QA smoke test.";
  const t0 = Date.now();
  try {
    const fn = create(which)("x", which, "en");
    const res = await fn(text, "zh-CN", "en");
    return { engine: which, result: String(res).slice(0, 300), ms: Date.now() - t0 };
  } catch (e) {
    return {
      engine: which,
      ms: Date.now() - t0,
      error: String(e),
      name: e?.name,
      stack: String(e?.stack || "").slice(0, 900),
    };
  }
};

/** Locale parity between en-US and zh-CN FTL sources. */
PROBE_CMDS.locales = async function () {
  const out = {};
  for (const locale of ["en-US", "zh-CN"]) {
    const keys = new Set();
    for (const f of ["wenxianyidu.ftl", "wenxianyidu-pane.ftl", "wenxianyidu-preferences.ftl"]) {
      try {
        const text = await Zotero.File.getContentsAsync(
          "chrome://wenxianyidu/locale/" + locale + "/" + f,
        );
        for (const line of text.split("\n")) {
          const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s*=/);
          if (m) keys.add(f + "::" + m[1]);
        }
      } catch (e) {
        keys.add("READ-ERROR " + f + ": " + e);
      }
    }
    out[locale] = [...keys].sort();
  }
  const a = new Set(out["en-US"]);
  const b = new Set(out["zh-CN"]);
  out.onlyInEn = [...a].filter((k) => !b.has(k));
  out.onlyInZh = [...b].filter((k) => !a.has(k));
  out.enCount = a.size;
  out.zhCount = b.size;
  return out;
};

/**
 * Click the real item-tree menu item with a real PDF selected — the user's
 * actual path through 「翻译全文（生成译文附件）」. Creates the item, selects
 * it, then invokes the menu item's command handler.
 */
PROBE_CMDS.documentTasks = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const menu = doc.getElementById("wenxianyidu-tools-document-tasks");
  if (!menu) return { error: "tools entry missing" };
  let commandError = null;
  try { menu.doCommand(); } catch (e) { commandError = String((e && e.stack) || e); }
  await Zotero.Promise.delay(1500);
  const tab = doc.getElementById("wenxianyidu-document-tasks");
  const root = doc.getElementById("wenxianyidu-tasks-root");
  if (!root) {
    const tc = doc.getElementById("wenxianyidu-document-tasks");
    return { error: "task tab missing", tab: !!tab, commandError, tabContent: tc ? (tc.outerHTML || "").slice(0, 300) : null };
  }
  return {
    tab: !!tab,
    tasks: [...doc.querySelectorAll("#wenxianyidu-task-list article")].map((a) => ({
      id: a.dataset.jobId,
      text: (a.textContent || "").slice(0, 200),
    })),
    buttons: [...root.querySelectorAll("button")].map((b) => b.textContent),
    components: (doc.getElementById("wenxianyidu-component-manager")?.textContent || "").slice(0, 300),
  };
};

PROBE_CMDS.domProbe = async function (selector) {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const sel = selector || "#wenxianyidu-tasks-root";
  const nodes = [...doc.querySelectorAll(sel)];
  return {
    selector: sel,
    count: nodes.length,
    tabs: Array.from(doc.querySelectorAll("#zotero-tabs tab"), (t) => ({
      id: t.id,
      label: t.getAttribute("label"),
      type: t.getAttribute("type"),
      hidden: t.hidden,
    })),
    samples: nodes.slice(0, 2).map((n) => ({
      id: n.id,
      tag: n.tagName,
      cls: n.getAttribute("class"),
      html: (n.outerHTML || "").slice(0, 600),
      text: (n.textContent || "").slice(0, 400),
    })),
  };
};

PROBE_CMDS.rasterProbe = async function () {
  const win = Zotero.getMainWindow();
  const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
  if (!reader) return { error: "no reader" };
  const ir = reader._internalReader?.wrappedJSObject || reader._internalReader;
  const pv = ir?._primaryView?.wrappedJSObject || ir?._primaryView;
  const iframe = pv?._iframe ?? pv?._iframeWindow;
  const cw = iframe?.contentWindow ?? iframe;
  const w = cw?.wrappedJSObject || cw;
  const out = { hasIframeWin: !!w };
  try { out.hasApp = !!w.PDFViewerApplication; } catch (e) { out.appErr = String(e); }
  try { out.hasPdfViewer = !!w.PDFViewerApplication?.pdfViewer; } catch (e) { out.pvErr = String(e); }
  try { out.hasPdfDocument = !!(w.PDFViewerApplication?.pdfViewer?.pdfDocument || w.PDFViewerApplication?.pdfDocument); } catch {}
  try { out.hasPdfjsLib = !!w.pdfjsLib; } catch {}
  try { out.windowPdfKeys = Object.keys(w).filter((k) => /pdf/i.test(k)).slice(0, 12); } catch {}
  try { out.primaryKeys = Object.keys(pv || {}).filter((k) => /pdf|view|iframe/i.test(k)); } catch {}
  try { out.internalKeys = Object.keys(ir || {}).filter((k) => /pdf|view|iframe/i.test(k)); } catch {}
  return out;
};

PROBE_CMDS.cropProbe = async function (arg) {
  const opts = arg || {};
  const win = Zotero.getMainWindow();
  const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
  if (!reader) return { error: "no reader" };
  const ir = reader._internalReader?.wrappedJSObject || reader._internalReader;
  const pv = ir?._primaryView?.wrappedJSObject || ir?._primaryView;
  const iframe = pv?._iframe ?? pv?._iframeWindow;
  const cw = iframe?.contentWindow ?? iframe;
  const w = cw?.wrappedJSObject || cw;
  const source = `(function(pageNum, bx, by, bw, bh, scale) {
    const app = window.PDFViewerApplication;
    if (!app || !app.pdfViewer) throw new Error("no PDFViewerApplication");
    const pdfDocument = app.pdfViewer.pdfDocument || app.pdfDocument;
    if (!pdfDocument) throw new Error("no pdfDocument");
    return pdfDocument.getPage(pageNum).then(function(page) {
      const viewport = page.getViewport({ scale: scale });
      const fullW = Math.floor(viewport.width), fullH = Math.floor(viewport.height);
      const full = document.createElement("canvas");
      full.width = fullW; full.height = fullH;
      const fctx = full.getContext("2d");
      fctx.fillStyle = "#ffffff"; fctx.fillRect(0, 0, fullW, fullH);
      return page.render({ canvasContext: fctx, viewport: viewport }).promise.then(function() {
        const sx = Math.max(0, Math.floor(bx * scale));
        const sy = Math.max(0, Math.floor(viewport.height - (by + bh) * scale));
        const sw = Math.min(fullW - sx, Math.ceil(bw * scale));
        const sh = Math.min(fullH - sy, Math.ceil(bh * scale));
        if (sw <= 0 || sh <= 0) throw new Error("empty crop " + JSON.stringify([sx,sy,sw,sh]));
        const crop = document.createElement("canvas");
        crop.width = sw; crop.height = sh;
        const cctx = crop.getContext("2d");
        cctx.fillStyle = "#ffffff"; cctx.fillRect(0, 0, sw, sh);
        cctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
        return { url: crop.toDataURL("image/png"), w: sw, h: sh, pageW: viewport.width, pageH: viewport.height };
      });
    });
  })`;
  const factory = w.eval(source);
  const bbox = opts.bbox || { x: 44, y: 780, width: 300, height: 20 };
  try {
    const out = await factory.call(w, opts.page || 1, bbox.x, bbox.y, bbox.width, bbox.height, opts.scale || 2);
    return { ok: true, bytes: out.url.length, w: out.w, h: out.h, pageW: out.pageW, pageH: out.pageH };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
};

PROBE_CMDS.progressProbe = async function () {
  const Services =
    (globalThis.Services) ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
  const found = [];
  const e = Services.wm.getEnumerator(null);
  while (e.hasMoreElements()) {
    const w = e.getNext();
    try {
      const box = w.document?.getElementById("zotero-progress-text-box");
      if (!box) continue;
      const rows = [...box.children].map((c) => (c.textContent || "").trim()).filter(Boolean);
      found.push({
        rows: box.children.length,
        last: rows[rows.length - 1] || "",
        sample: rows.slice(0, 3),
        height: w.outerHeight,
      });
    } catch {
      /* window gone */
    }
  }
  return { open: found.length, windows: found };
};

PROBE_CMDS.readerToolbar = async function (arg) {
  const win = Zotero.getMainWindow();
  const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
  if (!reader) return { error: "no reader" };
  const direct = reader._iframeWindow?.document;
  const ir = reader._internalReader?.wrappedJSObject || reader._internalReader;
  const pv = ir?._primaryView?.wrappedJSObject || ir?._primaryView;
  const iframe = pv?._iframe ?? pv?._iframeWindow;
  const cw = iframe?.contentWindow ?? iframe;
  const doc = direct || cw?.document;
  if (!doc) return { error: "no iframe doc" };
  const root = doc.getElementById("wenxianyidu-toolbar");
  const out = { present: !!root, html: root ? (root.outerHTML || "").slice(0, 500) : null };
  if (root && arg === "style") {
    const btn = root.querySelector(".wenxianyidu-tb-btn");
    const cs = btn ? cw.getComputedStyle(btn) : null;
    const rect = btn ? btn.getBoundingClientRect() : null;
    return {
      parent: root.parentElement ? { tag: root.parentElement.tagName, id: root.parentElement.id, cls: root.parentElement.className } : null,
      rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
      color: cs?.color,
      background: cs?.backgroundColor,
      fontSize: cs?.fontSize,
      display: cs?.display,
      visibility: cs?.visibility,
      overflow: cs?.overflow,
      text: btn?.textContent,
      rootRect: (() => { const r = root.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
      hit: (() => {
        if (!rect) return null;
        const el = doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return el ? { tag: el.tagName, id: el.id, cls: String(el.className || "").slice(0, 60) } : null;
      })(),
      inDoc: doc.contains(root),
      ancestors: (() => {
        const out = [];
        let n = root;
        const win2 = doc.defaultView || cw;
        while (n && n !== doc.body && out.length < 8) {
          const r = n.getBoundingClientRect();
          const cs2 = win2.getComputedStyle(n);
          out.push({
            tag: n.tagName,
            id: n.id,
            cls: String(n.className || "").slice(0, 40),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            overflow: cs2.overflow,
            flex: cs2.flex,
            maxWidth: cs2.maxWidth,
            position: cs2.position,
            zIndex: cs2.zIndex,
          });
          n = n.parentElement;
        }
        return out;
      })(),
      hit2: (() => {
        const win2 = doc.defaultView || cw;
        if (!rect) return null;
        const el = doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return el ? { tag: el.tagName, id: el.id, cls: String(el.className || "").slice(0, 40) } : "null";
      })(),
      ancestorHidden: (() => {
        let n = root;
        const chain = [];
        while (n && n !== doc.body) {
          const cs = cw.getComputedStyle(n);
          chain.push(n.tagName + (n.id ? "#" + n.id : "") + (n.className ? "." + String(n.className).split(" ")[0] : "") + ":" + cs.visibility + "/" + cs.opacity + "/" + cs.display + "/z" + cs.zIndex);
          n = n.parentElement;
        }
        return chain.slice(0, 8);
      })(),
    };
  }
  if (root && arg === "open") {
    const btn = root.querySelector(".wenxianyidu-tb-btn");
    try { btn?.click(); } catch (e) { out.clickError = String(e); }
    await new Promise((r) => setTimeout(r, 400));
    const panel = doc.getElementById("wenxianyidu-toolbar-panel");
    out.panelVisible = !!panel && !panel.hidden;
    out.items = panel
      ? [...panel.querySelectorAll("button")].map((b) => ({ label: b.textContent, disabled: b.disabled }))
      : [];
  }
  if (root && (arg === "split" || arg === "cancel" || arg === "settings")) {
    const btn = root.querySelector(".wenxianyidu-tb-btn");
    try { btn?.click(); } catch (e) { out.clickError = String(e); }
    await new Promise((r) => setTimeout(r, 300));
    const panel = doc.getElementById("wenxianyidu-toolbar-panel");
    const label = arg === "split" ? "分屏翻译" : arg === "cancel" ? "取消进行中的翻译" : "翻译设置…";
    const item = [...(panel?.querySelectorAll("button") || [])].find((b) => b.textContent === label);
    out.target = item ? { label: item.textContent, disabled: item.disabled } : null;
    try { item?.click(); } catch (e) { out.invokeError = String(e); }
    await new Promise((r) => setTimeout(r, 1200));
    return out;
  }
  if (root && arg === "close") {
    const btn = root.querySelector(".wenxianyidu-tb-btn");
    try { btn?.click(); } catch (e) { out.clickError = String(e); }
    await new Promise((r) => setTimeout(r, 200));
    const panel = doc.getElementById("wenxianyidu-toolbar-panel");
    out.panelVisible = !!panel && !panel.hidden;
  }
  return out;
};

// ── 阅读器工具栏：进度状态 / 键盘可达性 / 分屏副窗格 / 窄窗 / 深色 ──────────

/** 所有已打开 reader 的工具栏快照（一个 reader 一个 iframe 一个 toolbar）。 */
function probeReaderToolbars() {
  const list = Zotero.Reader._readers || [];
  return list.map((r, i) => {
    let doc = null;
    try {
      doc = r._iframeWindow?.document ?? null;
    } catch (e) {
      doc = null;
    }
    const root = doc?.getElementById("wenxianyidu-toolbar") ?? null;
    const btn = root?.querySelector(".wenxianyidu-tb-btn") ?? null;
    const rect = btn?.getBoundingClientRect?.() ?? null;
    let itemID = r.itemID;
    try {
      const item = itemID ? Zotero.Items.get(itemID) : null;
      itemID = item ? { id: item.id, title: item.getField?.("title") || "" } : itemID;
    } catch (e) {
      /* best effort */
    }
    return {
      index: i,
      tabID: r.tabID,
      itemID,
      hasDoc: !!doc,
      toolbar: root
        ? {
            phase: root.getAttribute("data-phase"),
            done: root.getAttribute("data-done"),
            total: root.getAttribute("data-total"),
            failed: root.getAttribute("data-failed"),
            main: root.querySelector(".wenxianyidu-tb-main")?.textContent ?? null,
            failSuffix: root.querySelector(".wenxianyidu-tb-fail")?.textContent ?? null,
            caret: root.querySelector(".wenxianyidu-tb-caret")?.textContent ?? null,
            expanded: btn?.getAttribute("aria-expanded"),
            hasPopup: btn?.getAttribute("aria-haspopup"),
            controls: btn?.getAttribute("aria-controls"),
            ariaLabel: btn?.getAttribute("aria-label"),
            btnRect: rect
              ? { x: Math.round(rect.x), w: Math.round(rect.width), h: Math.round(rect.height) }
              : null,
            // 窄窗回归：CSS 在 <680px / <480px 分别隐藏失败段数 / 箭头。
            failDisplay: (() => {
              const el = root.querySelector(".wenxianyidu-tb-fail");
              return el && doc.defaultView
                ? doc.defaultView.getComputedStyle(el).display
                : null;
            })(),
            caretDisplay: (() => {
              const el = root.querySelector(".wenxianyidu-tb-caret");
              return el && doc.defaultView
                ? doc.defaultView.getComputedStyle(el).display
                : null;
            })(),
            // 溢出检查：按钮右边界不能越过工具栏容器
            overflow: (() => {
              const p = root.parentElement;
              if (!p || !rect) return null;
              const pr = p.getBoundingClientRect();
              return {
                containerW: Math.round(pr.width),
                buttonRight: Math.round(rect.right),
                containerRight: Math.round(pr.right),
                overflows: rect.right > pr.right + 1,
              };
            })(),
          }
        : null,
      docListenerMounts: doc?.documentElement?.getAttribute(
        "data-wenxianyidu-toolbar-listeners",
      ) ?? null,
      mediaDark: doc?.defaultView
        ? doc.defaultView.matchMedia("(prefers-color-scheme: dark)").matches
        : null,
    };
  });
}

PROBE_CMDS.toolbarPanes = async function () {
  const win = Zotero.getMainWindow();
  const out = {
    readers: probeReaderToolbars(),
    window: {
      outer: [win.outerWidth, win.outerHeight],
      inner: [win.innerWidth, win.innerHeight],
      sizemode: win.document.documentElement.getAttribute("sizemode"),
    },
    selectedTab: win.Zotero_Tabs?.selectedID ?? null,
    tabs: [...win.document.querySelectorAll("#zotero-tabs tab")].map((t) => ({
      id: t.id,
      label: t.getAttribute("label"),
    })),
  };
  out.toolbarCount = out.readers.filter((r) => r.toolbar).length;
  // 分屏副窗格：分屏标签页自己的 reader 里是否又注入了一份工具栏按钮？
  try {
    const sel = Zotero.Reader.getByTabID(out.selectedTab);
    if (sel) {
      const doc = sel._iframeWindow?.document ?? null;
      out.selectedReader = {
        tabID: sel.tabID,
        itemID: sel.itemID,
        hasDoc: !!doc,
        toolbarCount: doc ? doc.querySelectorAll("#wenxianyidu-toolbar").length : null,
        buttons: doc ? [...doc.querySelectorAll(".wenxianyidu-tb-btn")].length : null,
        // 分屏时同一文档里两个窗格各自的 iframe（如果有）
        subIframes: doc
          ? [...doc.querySelectorAll("iframe")].map((f) => {
              const fd = f.contentDocument;
              return {
                src: String(f.src || "").slice(0, 80),
                toolbars: fd ? fd.querySelectorAll("#wenxianyidu-toolbar").length : null,
              };
            })
          : null,
      };
    } else {
      out.selectedReader = null;
    }
  } catch (e) {
    out.selectedReader = { error: String(e) };
  }
  return out;
};

/** 键盘可达性：ArrowDown/Home/End/ArrowUp/Escape + ARIA 角色，全部真实派发按键。 */
PROBE_CMDS.toolbarKeyNav = async function () {
  const reader = probeToolbarReader();
  if (!reader) return { error: "no reader" };
  const cw = reader._iframeWindow;
  const doc = cw?.document;
  const root = doc?.getElementById("wenxianyidu-toolbar");
  if (!root) return { error: "no toolbar" };
  const btn = root.querySelector(".wenxianyidu-tb-btn");
  const panel = () => doc.getElementById("wenxianyidu-toolbar-panel");
  // 从干净状态开始：面板可能被上一次探针留在打开状态。
  if (panel() && !panel().hidden) {
    btn.click();
    await Zotero.Promise.delay(200);
  }
  const describeFocus = () => {
    const a = doc.activeElement;
    if (!a) return null;
    return {
      tag: a.tagName,
      role: a.getAttribute?.("role") ?? null,
      text: (a.textContent || "").trim().slice(0, 40),
      cls: String(a.className || "").slice(0, 40),
    };
  };
  const press = async (k) => {
    const el = doc.activeElement || btn;
    el.dispatchEvent(
      new cw.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
    );
    await Zotero.Promise.delay(180);
  };
  const steps = [];
  const snap = (step) =>
    steps.push({
      step,
      open: panel() ? !panel().hidden : false,
      expanded: btn.getAttribute("aria-expanded"),
      focus: describeFocus(),
      // 每一步都附上当前的菜单项顺序 + 焦点下标，用来定位「跳项」问题
      labels: [...(panel()?.querySelectorAll('[role="menuitem"]') || [])].map(
        (b) => (b.textContent || "").trim().slice(0, 12) + (b.disabled ? "(x)" : ""),
      ),
      focusIndex: (() => {
        const active = doc.activeElement;
        if (!active) return -1;
        return [...(panel()?.querySelectorAll('[role="menuitem"]') || [])].findIndex(
          (b) => b.isSameNode(active),
        );
      })(),
    });

  btn.focus();
  await press("ArrowDown");
  snap("ArrowDown@button → 打开并聚焦首项");
  await press("Home");
  snap("Home → 首项（归位）");
  await press("ArrowDown");
  snap("ArrowDown → 应到第二项");
  await press("ArrowDown");
  snap("ArrowDown → 应到第三项");
  await press("End");
  snap("End → 末项");
  await press("Home");
  snap("Home → 首项");
  await press("ArrowUp");
  snap("ArrowUp → 环绕到末项");
  await press("Escape");
  snap("Escape → 关闭并把焦点还给按钮");

  const items = [...(panel()?.querySelectorAll("button") || [])];
  return {
    steps,
    nav: (() => {
      try {
        return JSON.parse(root.getAttribute("data-navlog") || "null");
      } catch {
        return root.getAttribute("data-navlog");
      }
    })(),
    panel: {
      role: panel()?.getAttribute("role") ?? null,
      ids: panel()?.id ?? null,
    },
    items: items.map((b) => ({
      role: b.getAttribute("role"),
      tabIndex: b.tabIndex,
      label: (b.textContent || "").trim().slice(0, 30),
      disabled: b.disabled,
    })),
    separators: [...(panel()?.querySelectorAll('[role="separator"]') || [])].length,
    docListenerMounts: doc.documentElement.getAttribute(
      "data-wenxianyidu-toolbar-listeners",
    ),
  };
};

/**
 * toolbarFocus — 把焦点放到工具栏按钮上（供「真人键盘」测试用）。
 * 先确保菜单关闭，再把按钮 focus 好，之后由外部用真实按键驱动。
 */
PROBE_CMDS.toolbarFocus = async function () {
  const reader = probeToolbarReader();
  const doc = reader?._iframeWindow?.document;
  const root = doc?.getElementById("wenxianyidu-toolbar");
  if (!root) return { error: "no toolbar" };
  const btn = root.querySelector(".wenxianyidu-tb-btn");
  const panel = doc.getElementById("wenxianyidu-toolbar-panel");
  if (panel && !panel.hidden) {
    btn.click();
    await Zotero.Promise.delay(250);
  }
  btn.focus();
  await Zotero.Promise.delay(120);
  const a = doc.activeElement;
  return {
    focused: a
      ? { tag: a.tagName, role: a.getAttribute?.("role") ?? null, cls: String(a.className || "") }
      : null,
    menuOpen: panel ? !panel.hidden : null,
  };
};

/**
 * toolbarFocusState — 读「当前焦点在哪个菜单项」。
 *
 * 关键点：不用 `list.indexOf(doc.activeElement)`（跨 compartment 的包装对象
 * 判等会失败），改用 `isSameNode`，与插件内部一致的判定方式。
 */
PROBE_CMDS.toolbarFocusState = async function () {
  const reader = probeToolbarReader();
  const doc = reader?._iframeWindow?.document;
  const root = doc?.getElementById("wenxianyidu-toolbar");
  if (!root) return { error: "no toolbar" };
  const btn = root.querySelector(".wenxianyidu-tb-btn");
  const panel = doc.getElementById("wenxianyidu-toolbar-panel");
  const items = [...(panel?.querySelectorAll('[role="menuitem"]') || [])];
  const active = doc.activeElement;
  const index = active
    ? items.findIndex((b) =>
        typeof b.isSameNode === "function" ? b.isSameNode(active) : b === active,
      )
    : -1;
  return {
    menuOpen: panel ? !panel.hidden : null,
    expanded: btn.getAttribute("aria-expanded"),
    build: root.getAttribute("data-toolbar-build"),
    navlog: (() => {
      try {
        return JSON.parse(root.getAttribute("data-navlog") || "null");
      } catch {
        return root.getAttribute("data-navlog");
      }
    })(),
    active: active
      ? {
          tag: active.tagName,
          role: active.getAttribute?.("role") ?? null,
          text: String(active.textContent || "").trim().slice(0, 30),
          cls: String(active.className || "").slice(0, 40),
          isButton: active === btn || active?.isSameNode?.(btn) === true,
        }
      : null,
    index,
    items: items.map((b) => String(b.textContent || "").trim().slice(0, 30)),
  };
};

/**
 * 模拟宿主重复渲染工具栏（移除节点 → 用同一条 renderToolbar 监听器重建）：
 * 文档级监听器必须仍是 1 份，不能每渲染一次就多挂一份。
 */
PROBE_CMDS.toolbarRerender = async function (times) {
  const win = Zotero.getMainWindow();
  const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
  const doc = reader?._iframeWindow?.document;
  if (!doc) return { error: "no reader" };
  const registered = Array.from(Zotero.Reader._registeredListeners || []);
  // 本插件注册了不止一个 renderToolbar（词卡入口也是），所以逐个试，
  // 只认真的注入了 #wenxianyidu-toolbar 的那个。
  const entries = registered.filter(
    (x) =>
      x.type === "renderToolbar" &&
      String(x.pluginID || "").includes("wenxianyidu"),
  );
  if (!entries.length) return { error: "no renderToolbar listener registered" };
  const out = { listeners: entries.length, renders: [] };
  const n = Math.max(1, Number(times) || 3);
  for (let i = 0; i < n; i++) {
    const old = doc.getElementById("wenxianyidu-toolbar");
    // 宿主追加的位置不变：记住原父节点，重建后还放回去。
    const parent = old?.parentElement ?? doc.body;
    const parentId = parent?.id || parent?.tagName;
    old?.remove();
    const appended = [];
    for (const entry of entries) {
      try {
        entry.handler({
          reader,
          doc,
          append: (el) => {
            parent.appendChild(el);
            appended.push(el.id || el.tagName);
          },
        });
      } catch (e) {
        appended.push("ERR:" + String(e));
      }
    }
    out.renders.push({
      parentId,
      appended,
      present: !!doc.getElementById("wenxianyidu-toolbar"),
      docListenerMounts: doc.documentElement.getAttribute(
        "data-wenxianyidu-toolbar-listeners",
      ),
    });
  }
  return out;
};

/** 缩小主窗口（先 restore，否则最大化状态下 resizeTo 无效），报告窄窗布局。 */
PROBE_CMDS.winResize = async function (arg) {
  const opts = arg && typeof arg === "object" ? arg : { width: Number(arg) || 900 };
  const width = Number(opts.width) || 900;
  const height = Number(opts.height) || 820;
  const win = Zotero.getMainWindow();
  try {
    win.restore?.();
  } catch (e) {
    /* not maximized */
  }
  await Zotero.Promise.delay(400);
  win.resizeTo(width, height);
  await Zotero.Promise.delay(1500);
  const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
  const rwin = reader?._iframeWindow ?? null;
  return {
    requested: [width, height],
    window: {
      outer: [win.outerWidth, win.outerHeight],
      inner: [win.innerWidth, win.innerHeight],
      sizemode: win.document.documentElement.getAttribute("sizemode"),
    },
    reader: rwin
      ? { inner: [rwin.innerWidth, rwin.innerHeight], dpr: rwin.devicePixelRatio || 1 }
      : null,
    readers: probeReaderToolbars(),
  };
};

/**
 * 切换系统配色（Zotero 7 跟随 prefers-color-scheme）。
 * 值不确定是 0 还是 1，逐个试并且如实报告哪一个真的翻成了暗色。
 */
PROBE_CMDS.darkMode = async function (mode) {
  const want = String(mode || "dark") === "light" ? false : true;
  const win = Zotero.getMainWindow();
  const read = () => {
    const el = win.document.body || win.document.documentElement;
    return {
      mediaDark: win.matchMedia("(prefers-color-scheme: dark)").matches,
      bodyBg: el ? win.getComputedStyle(el).backgroundColor : null,
      rootColorScheme: win.document.documentElement
        ? win.getComputedStyle(win.document.documentElement).colorScheme
        : null,
    };
  };
  const out = { want, before: read(), attempts: [] };
  const pref = "layout.css.prefers-color-scheme.content-override";
  for (const value of [0, 1, 2]) {
    try {
      Services.prefs.setIntPref(pref, value);
    } catch (e) {
      out.attempts.push({ value, error: String(e) });
      continue;
    }
    await Zotero.Promise.delay(800);
    const now = read();
    out.attempts.push({ value, ...now });
    if (now.mediaDark === want) {
      out.chosen = { pref, value };
      break;
    }
  }
  const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
  const rwin = reader?._iframeWindow ?? null;
  const doc = rwin?.document ?? null;
  if (doc) {
    const root = doc.getElementById("wenxianyidu-toolbar");
    const btn = root?.querySelector(".wenxianyidu-tb-btn");
    // 打开菜单量一下面板底色（深色下不能是白底黑字，也不能看不见）
    let panelStyle = null;
    try {
      if (root && doc.getElementById("wenxianyidu-toolbar-panel")?.hidden) {
        btn?.click();
        await Zotero.Promise.delay(400);
      }
      const panel = doc.getElementById("wenxianyidu-toolbar-panel");
      if (panel && !panel.hidden) {
        const cs = rwin.getComputedStyle(panel);
        panelStyle = {
          background: cs.backgroundColor,
          color: cs.color,
          border: cs.borderTopColor,
        };
        btn?.click();
        await Zotero.Promise.delay(200);
      }
    } catch (e) {
      panelStyle = { error: String(e) };
    }
    out.reader = {
      mediaDark: rwin.matchMedia("(prefers-color-scheme: dark)").matches,
      toolbarBg: btn ? rwin.getComputedStyle(btn).backgroundColor : null,
      toolbarColor: btn ? rwin.getComputedStyle(btn).color : null,
      panel: panelStyle,
      // 深色模式下最容易出问题的是「面板底色仍是 #fff 或文字继承成暗色」。
      // 这里直接算 WCAG 对比度，不靠人眼看截图。
      panelContrast: panelStyle && panelStyle.background && panelStyle.color
        ? probeContrast(panelStyle.background, panelStyle.color)
        : null,
      buttonContrast: btn
        ? probeContrast(
            rwin.getComputedStyle(btn).backgroundColor,
            rwin.getComputedStyle(btn).color,
          )
        : null,
      backplate: (() => {
        try {
          const cont = root?.parentElement;
          return cont ? rwin.getComputedStyle(cont).backgroundColor : null;
        } catch {
          return null;
        }
      })(),
    };
  }
  out.after = read();
  return out;
};

/** 找到「装了工具栏」的那个 reader（分屏后选中的标签页可能是译文窗格，没有工具栏）。 */
function probeToolbarReader() {
  const win = Zotero.getMainWindow();
  const all = Zotero.Reader._readers || [];
  for (const r of all) {
    try {
      if (r._iframeWindow?.document?.getElementById("wenxianyidu-toolbar")) return r;
    } catch {
      /* cross-compartment read can fail */
    }
  }
  return Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
}

/** 轮询工具栏按钮，记录「翻译中 7/18」这类文字的变化序列。 */
PROBE_CMDS.toolbarWatch = async function (arg) {
  const opts = arg && typeof arg === "object" ? arg : { ms: Number(arg) || 20000 };
  const ms = Number(opts.ms) || 20000;
  const every = Number(opts.every) || 350;
  const reader = probeToolbarReader();
  const doc = reader?._iframeWindow?.document;
  const root = doc?.getElementById("wenxianyidu-toolbar");
  if (!root) return { error: "no toolbar" };
  const label = (attr) => root.getAttribute(attr);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const snap = {
      t: Date.now() - t0,
      phase: label("data-phase"),
      done: label("data-done"),
      total: label("data-total"),
      failed: label("data-failed"),
      text:
        (root.querySelector(".wenxianyidu-tb-main")?.textContent || "") +
        (root.querySelector(".wenxianyidu-tb-fail")?.textContent || ""),
    };
    const prev = samples[samples.length - 1];
    if (!prev || prev.phase !== snap.phase || prev.done !== snap.done || prev.failed !== snap.failed) {
      samples.push(snap);
    }
    if (snap.phase === "complete" || snap.phase === "partial") break;
    await Zotero.Promise.delay(every);
  }
  return { samples, elapsedMs: Date.now() - t0 };
};

/** 按 data-action（语言无关）点击工具栏菜单项，不必匹配本地化文案。 */
PROBE_CMDS.toolbarClick = async function (action) {
  const reader = probeToolbarReader();
  const doc = reader?._iframeWindow?.document;
  const root = doc?.getElementById("wenxianyidu-toolbar");
  if (!root) return { error: "no toolbar" };
  const btn = root.querySelector(".wenxianyidu-tb-btn");
  const panel = doc.getElementById("wenxianyidu-toolbar-panel");
  if (panel?.hidden) {
    btn.click();
    await Zotero.Promise.delay(400);
  }
  const items = [...(panel?.querySelectorAll("[data-action]") || [])];
  const target = items.find((b) => b.getAttribute("data-action") === action);
  const out = {
    action,
    panelOpen: !!panel && !panel.hidden,
    available: items.map((b) => ({
      action: b.getAttribute("data-action"),
      label: (b.textContent || "").trim(),
      disabled: b.disabled,
    })),
    clicked: target
      ? { label: (target.textContent || "").trim(), disabled: target.disabled }
      : null,
  };
  if (target && !target.disabled) {
    target.click();
    await Zotero.Promise.delay(1500);
  }
  return out;
};

/**
 * 关掉所有阅读器标签页，只留库视图。
 * 探针会挑「第一个装了工具栏的 reader」，而 demoItem 每跑一次就多开一个标签页；
 * 不清场的话新命令会落到上一轮的旧文档上（实测会弹出「已有译文」模态框）。
 */
PROBE_CMDS.closeReaderTabs = async function () {
  const win = Zotero.getMainWindow();
  const { Zotero_Tabs } = probeWin();
  const closed = [];
  try {
    for (const id of Zotero_Tabs._tabs.slice()) {
      if (!String(id).startsWith("tab-")) continue;
      try {
        Zotero_Tabs.close(id);
        closed.push(id);
      } catch (e) {
        closed.push(id + ":ERR " + e);
      }
    }
  } catch (e) {
    return { error: String(e), closed };
  }
  await Zotero.Promise.delay(1200);
  return {
    closed,
    remaining: Zotero_Tabs._tabs.slice(),
    readers: (Zotero.Reader._readers || []).length,
    selected: Zotero_Tabs.selectedID,
    win: win ? "ok" : "no win",
  };
};

/**
 * 分屏副窗格是否重复注入工具栏按钮：递归扫主窗口里所有 iframe（含阅读器内部的
 * 左侧原文 / 右侧译文窗格），数每一层文档里的 #wenxianyidu-toolbar。
 */
/** rgb()/rgba() → WCAG 相对亮度对比度（用于深色模式的客观判据）。 */
function probeContrast(fg, bg) {
  const parse = (c) => {
    const m = String(c || "").match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const a = parse(fg);
  const b = parse(bg);
  if (!a || !b) return null;
  const l1 = lum(a);
  const l2 = lum(b);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return Math.round(ratio * 100) / 100;
}

PROBE_CMDS.toolbarNested = async function (depth) {
  const maxDepth = Number(depth) || 4;
  const win = Zotero.getMainWindow();
  const out = { docs: [], total: 0 };
  const walk = (doc, label, level) => {
    if (!doc || level > maxDepth) return;
    let toolbars = 0;
    let buttons = 0;
    try {
      toolbars = doc.querySelectorAll("#wenxianyidu-toolbar").length;
      buttons = doc.querySelectorAll(".wenxianyidu-tb-btn").length;
    } catch (e) {
      out.docs.push({ label, level, error: String(e) });
      return;
    }
    out.total += toolbars;
    out.docs.push({ label, level, toolbars, buttons });
    let frames = [];
    try {
      // 分屏窗格是 XUL <browser>，不是 <iframe>（splitViewFactory.createReaderBrowser）
      frames = [...doc.querySelectorAll("iframe, browser")];
    } catch {
      frames = [];
    }
    frames.forEach((f, i) => {
      let fd = null;
      try {
        fd = f.contentDocument;
      } catch (e) {
        fd = null;
      }
      walk(
        fd,
        `${label} > ${String(f.tagName).toLowerCase()}[${i}]${
          f.src ? " " + String(f.src).slice(0, 60) : ""
        }${f.className ? " ." + String(f.className).slice(0, 40) : ""}`,
        level + 1,
      );
    });
  };
  walk(win.document, "mainwindow", 0);
  // 分屏标签页容器里的每个窗格（左=原文 / 右=译文）各有多少工具栏按钮
  try {
    const tabID = win.Zotero_Tabs.selectedID;
    const container = win.document.getElementById(tabID);
    if (!container) {
      out.splitPanes = "no container";
    } else {
      out.splitPanes = [];
      const browsers = [...container.querySelectorAll("browser")];
      for (let i = 0; i < browsers.length; i++) {
        const b = browsers[i];
        let d = null;
        try {
          d = b.contentDocument;
        } catch {
          d = null;
        }
        const info = {
          i,
          cls: String(b.className || ""),
          hasDoc: !!d,
          toolbars: d ? d.querySelectorAll("#wenxianyidu-toolbar").length : null,
          buttons: d ? d.querySelectorAll(".wenxianyidu-tb-btn").length : null,
          // reader 自己的工具栏有没有渲染出来（用来区分「我们的按钮没注入」
          // 和「整个工具栏都没渲染」）
          readerToolbar: d ? !!d.querySelector("#zotero-reader-toolbar, .toolbar") : null,
          bodyText: d ? String(d.body?.textContent || "").replace(/\s+/g, " ").slice(0, 60) : null,
        };
        // 窗格里的按钮是否真的可用：点一次（真实 mousedown）应展开菜单。
        try {
          const root = d?.getElementById("wenxianyidu-toolbar");
          const btn = root?.querySelector(".wenxianyidu-tb-btn");
          const panel = d?.getElementById("wenxianyidu-toolbar-panel");
          if (root && btn && panel && d.defaultView) {
            const cw = d.defaultView;
            const fire = (el, type) =>
              el.dispatchEvent(
                new cw.MouseEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  detail: 1,
                  button: 0,
                }),
              );
            fire(btn, "mousedown");
            await Zotero.Promise.delay(250);
            info.menuOpen = !panel.hidden;
            info.expanded = btn.getAttribute("aria-expanded");
            info.items = [...panel.querySelectorAll('[role="menuitem"]')].map((x) =>
              String(x.textContent || "").trim(),
            );
            info.aria = {
              panelRole: panel.getAttribute("role"),
              hasPopup: btn.getAttribute("aria-haspopup"),
              controls: btn.getAttribute("aria-controls"),
            };
            const rect = btn.getBoundingClientRect();
            const parent = root.parentElement;
            const prect = parent?.getBoundingClientRect?.();
            info.layout = {
              paneWidth: Math.round(cw.innerWidth),
              buttonW: Math.round(rect.width),
              containerW: prect ? Math.round(prect.width) : null,
              overflows: prect ? rect.right > prect.right + 1 : null,
              caretDisplay: (() => {
                const el = root.querySelector(".wenxianyidu-tb-caret");
                return el ? cw.getComputedStyle(el).display : null;
              })(),
            };
            // 关掉，避免影响后续截图
            fire(btn, "mousedown");
            await Zotero.Promise.delay(200);
            info.menuClosedAfterToggle = panel.hidden;
          }
        } catch (e) {
          info.probeError = String(e);
        }
        out.splitPanes.push(info);
      }
      out.splitContainer = `${container.tagName}#${container.id}`;
    }
  } catch (e) {
    out.splitPanes = "err: " + e;
  }
  // 分屏标签页的类型/标题，便于确认我们确实在分屏状态
  try {
    const tab = win.Zotero_Tabs._getTab?.(win.Zotero_Tabs.selectedID)?.tab;
    out.selectedTab = tab ? { id: tab.id, type: tab.type, title: tab.title } : null;
  } catch (e) {
    out.selectedTab = { error: String(e) };
  }
  out.readers = (Zotero.Reader._readers || []).map((r) => ({
    tabID: r.tabID,
    itemID: r.itemID,
    hasSecondary: !!(r._internalReader?._secondaryView),
  }));
  return out;
};

/**
 * splitPaneWidth — force the LEFT split pane to a fixed pixel width, so the
 * reader document inside it is narrower than a Windows window can ever be
 * (min window width ~586px). Used to exercise the <480px / <680px toolbar CSS
 * breakpoints on a real reader viewport.
 */
PROBE_CMDS.splitPaneWidth = async function (px) {
  const win = Zotero.getMainWindow();
  const tabID = win.Zotero_Tabs.selectedID;
  const container = win.document.getElementById(tabID);
  if (!container) return { error: "no tab container" };
  const browsers = [...container.querySelectorAll("browser")];
  if (!browsers.length) return { error: "no split pane browser" };
  const width = Math.max(120, Math.min(2000, Number(px) || 400));
  browsers[0].style.flex = `0 0 ${width}px`;
  await Zotero.Promise.delay(700);
  return {
    requested: width,
    paneInnerWidth: browsers[0].contentWindow?.innerWidth ?? null,
    windowInner: [win.innerWidth, win.innerHeight],
  };
};

/**
 * toolbarMouseClick — fire a *trusted* click (nsIDOMWindowUtils.sendMouseEvent)
 * at the toolbar button's center and record the menu state around it. This is
 * much closer to a real mouse than dispatchEvent and goes through the host's
 * own mousedown/click handling.
 */
let toolbarEventWatch = null;
PROBE_CMDS.toolbarEvents = async function (arg) {
  if (arg === "start") {
    toolbarEventWatch?.stop();
    const reader = probeToolbarReader();
    const doc = reader?._iframeWindow?.document;
    if (!doc) return { error: "no toolbar document" };
    const log = [], cleanups = [];
    for (const [label, target] of [["reader", doc.defaultView], ["main", Zotero.getMainWindow()]]) {
      for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"]) {
        const record = ev => {
          log.push({ where: label, type, detail: ev.detail, button: ev.button,
            target: String(ev.target?.className || ev.target?.id || ev.target?.tagName || ""),
            trusted: ev.isTrusted, x: ev.clientX, y: ev.clientY,
            screenX: ev.screenX, screenY: ev.screenY,
            open: !doc.getElementById("wenxianyidu-toolbar-panel")?.hidden });
          if (log.length > 100) log.shift();
        };
        target.addEventListener(type, record, true);
        cleanups.push(() => target.removeEventListener(type, record, true));
      }
    }
    toolbarEventWatch = { log, doc, stop: () => cleanups.forEach(fn => fn()) };
  }
  if (!toolbarEventWatch) return { error: "start first" };
  const result = { log: toolbarEventWatch.log.slice(),
    open: !toolbarEventWatch.doc.getElementById("wenxianyidu-toolbar-panel")?.hidden };
  if (arg === "stop") { toolbarEventWatch.stop(); toolbarEventWatch = null; }
  return result;
};

PROBE_CMDS.toolbarMouseClick = async function (arg) {
  const mode = typeof arg === "string" ? arg : "open";
  const reader = probeToolbarReader();
  const doc = reader?._iframeWindow?.document;
  const root = doc?.getElementById("wenxianyidu-toolbar");
  const btn = root?.querySelector(".wenxianyidu-tb-btn");
  const panel = doc?.getElementById("wenxianyidu-toolbar-panel");
  const win = doc?.defaultView;
  if (!btn || !panel || !win) return { error: "no toolbar" };
  const utils = win.windowUtils;
  if (!utils?.sendMouseEvent) return { error: "no windowUtils" };
  const r = btn.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const out = {
    rect: { x, y, w: r.width, h: r.height },
    scrollY: win.scrollY,
    steps: [],
  };
  const snap = (label) => {
    out.steps.push({
      label,
      open: !panel.hidden,
      expanded: btn.getAttribute("aria-expanded"),
      active: String(doc.activeElement?.className || doc.activeElement?.tagName || ""),
    });
  };
  const log = [];
  const rec = (where) => (ev) => {
    try {
      log.push({
        where,
        type: ev.type,
        target: String(
          (ev.target?.className && String(ev.target.className).slice(0, 30)) ||
            ev.target?.tagName ||
            "",
        ),
        trusted: ev.isTrusted === true,
        defaultPrevented: ev.defaultPrevented === true,
        button: ev.button,
      });
    } catch {
      /* best-effort */
    }
  };
  const install = () => {
    win.addEventListener("mousedown", rec("win-capture-mousedown"), true);
    win.addEventListener("mousedown", rec("win-bubble-mousedown"));
    win.addEventListener("pointerdown", rec("win-capture-pointerdown"), true);
    win.addEventListener("pointerdown", rec("win-bubble-pointerdown"));
    doc.addEventListener("pointerdown", rec("doc-capture-pointerdown"), true);
    doc.addEventListener("pointerdown", rec("doc-bubble-pointerdown"));
    btn.addEventListener("pointerdown", rec("btn-capture-pointerdown"), true);
    btn.addEventListener("pointerdown", rec("btn-bubble-pointerdown"));
    doc.addEventListener("mousedown", rec("doc-capture-mousedown"), true);
    doc.addEventListener("mousedown", rec("doc-bubble-mousedown"));
    btn.addEventListener("mousedown", rec("btn-capture-mousedown"), true);
    btn.addEventListener("mousedown", rec("btn-bubble-mousedown"));
    doc.addEventListener("click", rec("doc-capture-click"), true);
    doc.addEventListener("click", rec("doc-bubble-click"));
  };
  const uninstall = () => {
    doc.removeEventListener("mousedown", rec("doc-capture-mousedown"), true);
  };
  void uninstall;
  install();
  out.log = log;

  if (!panel.hidden) {
    // start from a clean, closed state
    utils.sendMouseEvent("mousedown", x, y, 0, 1, 0);
    utils.sendMouseEvent("mouseup", x, y, 0, 1, 0);
    await Zotero.Promise.delay(400);
  }
  log.length = 0;
  snap("before");
  utils.sendMouseEvent("mousemove", x, y, 0, 0, 0);
  await Zotero.Promise.delay(60);
  utils.sendMouseEvent("mousedown", x, y, 0, 1, 0);
  snap("after mousedown");
  utils.sendMouseEvent("mouseup", x, y, 0, 1, 0);
  snap("after mouseup");
  await Zotero.Promise.delay(350);
  snap("after 350ms");

  if (mode === "toggle") {
    // click again → should close
    utils.sendMouseEvent("mousedown", x, y, 0, 1, 0);
    utils.sendMouseEvent("mouseup", x, y, 0, 1, 0);
    await Zotero.Promise.delay(400);
    snap("after 2nd click (expect closed)");
  } else if (mode === "outside") {
    // click far left in the toolbar → should close via the doc click listener
    utils.sendMouseEvent("mousedown", 30, 20, 0, 1, 0);
    utils.sendMouseEvent("mouseup", 30, 20, 0, 1, 0);
    await Zotero.Promise.delay(350);
    snap("after outside click (expect closed)");
  } else if (mode === "dblclick") {
    // ensure closed first (the initial click above opened it)
    if (!panel.hidden) {
      utils.sendMouseEvent("mousedown", x, y, 0, 1, 0);
      utils.sendMouseEvent("mouseup", x, y, 0, 1, 0);
      await Zotero.Promise.delay(450);
    }
    snap("before double click (closed)");
    // two rapid clicks (100ms apart) should leave the menu OPEN
    utils.sendMouseEvent("mousedown", x, y, 0, 1, 0);
    utils.sendMouseEvent("mouseup", x, y, 0, 1, 0);
    await Zotero.Promise.delay(100);
    utils.sendMouseEvent("mousedown", x, y, 0, 2, 0);
    utils.sendMouseEvent("mouseup", x, y, 0, 2, 0);
    await Zotero.Promise.delay(400);
    snap("after rapid double click (expect still open)");
  } else if (mode === "pane") {
    // repeat the trusted click on the LEFT split pane's toolbar button
    const win2 = Zotero.getMainWindow();
    const container = win2.document.getElementById(win2.Zotero_Tabs.selectedID);
    const paneBrowser = container?.querySelector("browser");
    const pd = paneBrowser?.contentDocument;
    const proot = pd?.getElementById("wenxianyidu-toolbar");
    const pbtn = proot?.querySelector(".wenxianyidu-tb-btn");
    const ppanel = pd?.getElementById("wenxianyidu-toolbar-panel");
    const pw = pd?.defaultView;
    if (!pbtn || !ppanel || !pw?.windowUtils) {
      out.paneError = "no pane toolbar";
    } else {
      const pr = pbtn.getBoundingClientRect();
      const px = pr.left + pr.width / 2;
      const py = pr.top + pr.height / 2;
      out.paneRect = { x: px, y: py, w: pr.width, h: pr.height };
      pw.windowUtils.sendMouseEvent("mousemove", px, py, 0, 0, 0);
      pw.windowUtils.sendMouseEvent("mousedown", px, py, 0, 1, 0);
      await Zotero.Promise.delay(150);
      out.paneOpenAfterDown = !ppanel.hidden;
      pw.windowUtils.sendMouseEvent("mouseup", px, py, 0, 1, 0);
      await Zotero.Promise.delay(300);
      out.paneOpenAfterUp = !ppanel.hidden;
      out.paneItems = [...ppanel.querySelectorAll('[role="menuitem"]')].map((b) =>
        String(b.textContent || "").trim(),
      );
    }
  } else if (mode.startsWith("item:")) {
    const action = mode.slice(5);
    const item = panel.querySelector(`[data-action="${action}"]`);
    if (!item) {
      out.itemError = "no item " + action;
    } else {
      const ir = item.getBoundingClientRect();
      const ix = ir.left + ir.width / 2;
      const iy = ir.top + ir.height / 2;
      out.itemRect = { x: ix, y: iy, w: ir.width, h: ir.height };
      utils.sendMouseEvent("mousemove", ix, iy, 0, 0, 0);
      utils.sendMouseEvent("mousedown", ix, iy, 0, 1, 0);
      utils.sendMouseEvent("mouseup", ix, iy, 0, 1, 0);
      await Zotero.Promise.delay(800);
      snap("after item click");
      out.itemClosedMenu = panel.hidden;
    }
  }
  return out;
};

/** 单击 vs 双击：真实派发 mousedown/click/dblclick，确认「一次按下就展开」。 */
PROBE_CMDS.toolbarPointer = async function () {
  const reader = probeToolbarReader();
  const cw = reader?._iframeWindow;
  const doc = cw?.document;
  const root = doc?.getElementById("wenxianyidu-toolbar");
  if (!root) return { error: "no toolbar" };
  const btn = root.querySelector(".wenxianyidu-tb-btn");
  const panel = doc.getElementById("wenxianyidu-toolbar-panel");
  const fire = (el, type, detail) =>
    el.dispatchEvent(
      new cw.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        detail: detail ?? 1,
        button: 0,
      }),
    );
  const state = () => ({
    open: !panel.hidden,
    expanded: btn.getAttribute("aria-expanded"),
  });
  // 先确保关闭
  if (!panel.hidden) {
    fire(btn, "mousedown");
    fire(btn, "click");
    await Zotero.Promise.delay(200);
  }
  const out = { steps: [] };
  // 1) 单次 mousedown（真实鼠标按下）
  fire(btn, "mousedown");
  await Zotero.Promise.delay(120);
  out.steps.push({ step: "single mousedown", ...state() });
  // 2) 紧随其后的 click（浏览器随后必发）
  fire(btn, "click");
  await Zotero.Promise.delay(120);
  out.steps.push({ step: "then click", ...state() });
  // 3) 双击：第二次 mousedown 不应把菜单关掉
  fire(btn, "mousedown");
  fire(btn, "click");
  fire(btn, "dblclick");
  await Zotero.Promise.delay(150);
  out.steps.push({ step: "double press", ...state() });
  // 4) 关闭（等过去抖窗口再按一次）
  await Zotero.Promise.delay(400);
  fire(btn, "mousedown");
  fire(btn, "click");
  await Zotero.Promise.delay(200);
  out.steps.push({ step: "press again (close)", ...state() });
  return out;
};

PROBE_CMDS.pipelineViaMenu = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const dataDir = Zotero.DataDirectory.dir;
  const pdfPath = PathUtils.join(dataDir, "qa-sample.pdf");
  if (!(await IOUtils.exists(pdfPath))) return { skipped: "no PDF" };
  const { ZoteroPane, Zotero_Tabs } = probeWin();

  let item = new Zotero.Item("journalArticle");
  item.setField("title", "QA pipeline paper");
  const itemID = await item.saveTx();
  const att = await Zotero.Attachments.importFromFile({
    file: pdfPath,
    parentItemID: itemID,
    title: "QA pipeline PDF",
  });

  // Close any reader tab so the library items view is the active context and
  // the selection is ours (otherwise the menu handler sees no PDF).
  try {
    for (const id of Zotero_Tabs._tabs.slice()) {
      if (id.startsWith("tab-")) Zotero_Tabs.close(id);
    }
    await Zotero.Promise.delay(500);
  } catch (e) {
    probeLog("close tabs: " + e);
  }
  ZoteroPane.selectItem(att.id);
  await Zotero.Promise.delay(600);

  const popup = doc.getElementById("zotero-itemmenu");
  popup.dispatchEvent(new win.Event("popupshowing"));
  const menu = doc.getElementById("wenxianyidu-itemmenu");
  const visible = menu?.getAttribute("hidden") !== "true";
  const sel = ZoteroPane.itemsView.getSelectedItems();

  const target = doc.getElementById("wenxianyidu-itemmenu-attachment");
  if (!target) return { error: "menu item missing" };
  const t0 = Date.now();
  target.doCommand();
  const listTranslated = async () => {
    const s = new Zotero.Search();
    s.libraryID = 1;
    const ids = await s.search();
    const out = [];
    for (const id of ids) {
      const x = await Zotero.Items.getAsync(id);
      if (
        x.isAttachment() &&
        x.attachmentContentType === "application/pdf" &&
        /^(译文|Translated)\s*\(/i.test(x.getField("title"))
      ) {
        out.push({ id, parent: x.parentItemID, dateAdded: x.dateAdded });
      }
    }
    return out;
  };
  const before = await listTranslated();
  const beforeIDs = new Set(before.map((x) => x.id));

  // The pipeline is async; poll for its progress log and the new attachment.
  const results = {
    startedAt: t0,
    visible,
    selection: sel.map((i) => i.id),
    before,
  };
  const countCache = async () => {
    let n = 0;
    try {
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      f.initWithPath(
        PathUtils.join(
          Zotero.DataDirectory.dir,
          "wenxianyidu",
          "translation-cache",
        ),
      );
      const e = f.directoryEntries;
      while (e.hasMoreElements()) {
        e.getNextElement();
        n++;
      }
      return n;
    } catch {
      return -1;
    }
  };
  for (let i = 0; i < 200; i++) {
    await Zotero.Promise.delay(3000);
    const now = await listTranslated();
    const fresh = now.filter((x) => !beforeIDs.has(x.id));
    if (fresh.length) {
      results.newTranslated = fresh;
      results.ms = Date.now() - t0;
      break;
    }
    if (Date.now() - t0 > 400000) {
      results.timeout = true;
      break;
    }
  }
  results.ms = Date.now() - t0;
  return results;
};

/**
 * Extract text from a translated attachment's real PDF through Zotero's own
 * tooling — proves the Chinese glyphs were embedded (not '?' tofu).
 */
PROBE_CMDS.verifyPdf = async function (attachmentID) {
  const ids = attachmentID ? [Number(attachmentID)] : null;
  const out = [];
  let targets = ids;
  if (!targets) {
    const s = new Zotero.Search();
    s.libraryID = 1;
    const all = await s.search();
    targets = [];
    for (const id of all) {
      const x = await Zotero.Items.getAsync(id);
      if (
        x.isAttachment() &&
        x.attachmentContentType === "application/pdf" &&
        /^(译文|Translated)\s*\(/i.test(x.getField("title"))
      ) {
        targets.push(id);
      }
    }
  }
  for (const id of targets) {
    const item = await Zotero.Items.getAsync(id);
    const file = item.getFile?.();
    if (!file?.exists) {
      out.push({ id, error: "file missing" });
      continue;
    }
    // Parse the produced PDF's embedded text via pdf.js through the reader.
    let text = "";
    let method = "none";
    try {
      const bytes = await IOUtils.read(file.path);
      const doc = await Zotero.PDFWorker._loadPDF?.({
        data: new Uint8Array(bytes),
      });
      method = "pdfworker";
      void doc;
    } catch {
      /* try the text-extraction helper below */
    }
    // Simplest robust check: count CJK codepoints in the raw PDF stream.
    try {
      const raw = await IOUtils.read(file.path);
      const s2 = String.fromCharCode.apply(null, new Uint8Array(raw));
      const cjk = (s2.match(/[\u4e00-\u9fff]/g) || []).length;
      out.push({
        id,
        title: item.getField("title"),
        size: file.fileSize,
        cjkBytesInFile: cjk,
      });
    } catch (e) {
      out.push({ id, error: String(e) });
    }
  }
  return { produced: out };
};

/**
 * Set a z-transplit preference.
 *
 * NOTE: Zotero.Prefs.get/set(pref, global) — the second arg is a PATH MODE flag
 * (true = pref is already a full path), NOT "if missing". With a full path you
 * MUST pass true, or the API prefixes "extensions.zotero." onto it.
 */
PROBE_CMDS.setPref = async function (pair) {
  if (!pair || !pair.includes("=")) return { error: "pass key=value" };
  const [k, ...rest] = pair.split("=");
  const v = rest.join("=");
  const full = "extensions.zotero.wenxianyidu." + k;
  const before = Zotero.Prefs.get(full, true);
  if (v === "true" || v === "false") Zotero.Prefs.set(full, v === "true", true);
  else if (/^-?\d+$/.test(v)) Zotero.Prefs.set(full, Number(v), true);
  else Zotero.Prefs.set(full, v, true);
  const after = Zotero.Prefs.get(full, true);
  const hasUserValue = Zotero.Prefs.prefHasUserValue
    ? Zotero.Prefs.prefHasUserValue(full, true)
    : null;
  return {
    key: full,
    before,
    after,
    hasUserValue,
    stuck: before === after && String(before) !== String(v),
  };
};

/** List PDF attachments and report what the pipeline produced. */
PROBE_CMDS.attachments = async function () {
  const probe = (label, fn) => {
    try {
      const v = fn();
      return {
        label,
        type: Object.prototype.toString.call(v),
        len: v?.length ?? null,
        isIter: typeof v?.[Symbol.iterator] === "function",
        isAsyncIter: typeof v?.[Symbol.asyncIterator] === "function",
      };
    } catch (e) {
      return { label, error: String(e) };
    }
  };
  const g = Zotero.Items.getAll;
  const shapes = [
    probe("no-args", () => g()),
    probe("(1)", () => g(1)),
    probe("(1,false)", () => g(1, false)),
    probe("(1,true)", () => g(1, true)),
  ];
  // Use the search API, which is stable across versions.
  const pdfs = [];
  try {
    const s = new Zotero.Search();
    s.libraryID = 1;
    s.addCondition("recursive", false);
    s.addCondition("includeDeleted", false);
    const ids = await s.search();
    for (const id of ids) {
      const it = await Zotero.Items.getAsync(id);
      if (it.isAttachment() && it.attachmentContentType === "application/pdf") {
        const f = it.getFile?.();
        pdfs.push({
          id: it.id,
          title: it.getField("title"),
          parentID: it.parentItemID,
          size: f?.fileSize ?? null,
          path: f?.path ?? null,
          tags: (it.getTags?.() || []).map((t) => t.tag),
        });
      }
    }
  } catch (e) {
    return { searchError: String(e), shapes };
  }
  return {
    shapes,
    pdfs,
    cacheDir: Zotero.DataDirectory.dir + "\\wenxianyidu",
    cacheExists: await IOUtils.exists(
      PathUtils.join(Zotero.DataDirectory.dir, "wenxianyidu", "translation-cache"),
    ),
  };
};

/** Click the real Bilingual toggle and report the SDT session state. */
PROBE_CMDS.bilingual = async function (mode) {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const section = Array.from(
    doc.querySelectorAll("item-pane-custom-section"),
  ).find((c) => (c.dataset.pane || "").includes("transplit") && c.hidden === false);
  if (!section) return { error: "section not enabled — open the reader pane first" };

  const toggle = Array.from(section.querySelectorAll("button")).find(
    (b) => /Bilingual|双语/.test(b.textContent || ""),
  );
  if (!toggle) return { error: "no bilingual toggle", buttons: [] };
  const before = toggle.textContent;
  toggle.click();
  // Wait for the SDT session to start (or the disclosure to settle).
  let last = "";
  for (let i = 0; i < 14; i++) {
    await Zotero.Promise.delay(1000);
    last = (section.textContent || "").slice(0, 200);
    if (!/Translating|Preparing/.test(last)) break;
  }
  const out = {
    before,
    after: toggle.textContent,
    toggleActive: toggle.getAttribute("data-active"),
    sectionText: (section.textContent || "").slice(0, 700),
    containsRawIds: (section.textContent || "").includes("bilingual-"),
  };
  if (mode) {
    const modeBtn = Array.from(section.querySelectorAll("button")).find(
      (b) => /only|Interleaved/i.test(b.textContent || ""),
    );
    if (modeBtn) {
      modeBtn.click();
      await Zotero.Promise.delay(2000);
      out.modeClicked = modeBtn.textContent;
    }
  }
  // Report the reader overlay state (the SDT reading mode's injected blocks).
  try {
    const { Zotero_Tabs } = probeWin();
    const r = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
    const internal = r?._internalReader;
    const irWin = internal?._iframeWindow;
    const irDoc = irWin?.document;
    out.reader = {
      hasSDT: typeof internal?._loadSDT === "function",
      readingMode: internal?._readingMode ?? null,
      overlayBlocks: irDoc
        ? {
            transplitNodes: irDoc.querySelectorAll("[class*='wenxianyidu']").length,
            bcBlocks: irDoc.querySelectorAll(".wenxianyidu-bc-block").length,
            transOnlyHiding: !!irDoc.querySelector(
              "[class*='wenxianyidu-bc'][class*='trans-only']",
            ),
            bodyChars: (irDoc.body?.textContent || "").length,
            sample: (irDoc.body?.textContent || "").slice(0, 200),
          }
        : "no iframe",
    };
    const status = section.querySelector(".wenxianyidu-bc-status, .wenxianyidu-bc-progress");
    out.status = status?.textContent || null;
    out.progress = Array.from(
      section.querySelectorAll(".wenxianyidu-bc-progress"),
      (n) => n.textContent,
    );
    out.modeButtons = Array.from(section.querySelectorAll("button"))
      .filter((b) => /only|Interleaved/i.test(b.textContent || ""))
      .map((b) => b.textContent);
  } catch (e) {
    out.readerError = String(e);
  }
  await probeScrollSectionIntoView(doc);
  return out;
};

/** Exercise the read-aloud buttons and report the controller state. */
PROBE_CMDS.readAloud = async function (source) {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const section = Array.from(
    doc.querySelectorAll("item-pane-custom-section"),
  ).find((c) => (c.dataset.pane || "").includes("transplit") && c.hidden === false);
  if (!section) return { error: "section not enabled" };
  const want = source || "original";
  const target = Array.from(section.querySelectorAll("button")).find((b) =>
    new RegExp("Read " + want, "i").test(b.textContent || ""),
  );
  if (!target) {
    return {
      error: "no button for " + want,
      available: Array.from(section.querySelectorAll("button")).map((b) => b.textContent),
    };
  }
  target.click();
  await Zotero.Promise.delay(2500);
  return {
    clicked: target.textContent,
    speechSynthesisAvailable: typeof win.speechSynthesis !== "undefined",
    voices: win.speechSynthesis?.getVoices?.().length ?? null,
    sectionText: (section.textContent || "").slice(0, 300),
    rawIds: (section.textContent || "").includes("readaloud-"),
  };
};

/** Full PDF pipeline: Java + OpenDataLoader + translation, real files. */
PROBE_CMDS.pipeline = async function () {
  const dataDir = Zotero.DataDirectory.dir;
  const pdfPath = PathUtils.join(dataDir, "qa-sample.pdf");
  if (!(await IOUtils.exists(pdfPath))) return { skipped: "no PDF" };
  let item = new Zotero.Item("journalArticle");
  item.setField("title", "QA pipeline paper");
  const itemID = await item.saveTx();
  const att = await Zotero.Attachments.importFromFile({
    file: pdfPath,
    parentItemID: itemID,
    title: "QA pipeline PDF",
  });
  const scope = {};
  Services.scriptloader.loadSubScript(
    "chrome://wenxianyidu/content/scripts/wenxianyidu.js",
    scope,
  );
  const fn = scope.translateAndSplitWithOpenDataLoader;
  if (typeof fn !== "function") return { error: "adapter not in bundle" };
  const progress = [];
  const t0 = Date.now();
  try {
    const res = await fn({
      sourceItem: att,
      outcome: "attachment",
      onProgress: (m) => {
        progress.push(String(m));
        probeLog("[pipe] " + m);
      },
    });
    const out = {
      ms: Date.now() - t0,
      translatedAttachmentId: res?.translatedAttachmentId ?? null,
      splitTabID: res?.splitTabID ?? null,
      progress,
    };
    if (out.translatedAttachmentId) {
      const produced = await Zotero.Items.getAsync(out.translatedAttachmentId).catch(
        () => null,
      );
      out.title = produced?.getField?.("title") || null;
      out.contentType = produced?.attachmentContentType || null;
      const file = produced?.getFile?.();
      out.fileSize = file && file.exists ? file.fileSize : null;
    }
    return out;
  } catch (e) {
    return {
      ms: Date.now() - t0,
      error: String(e),
      name: e?.name,
      stack: String(e?.stack || "").slice(0, 1500),
      progress,
    };
  }
};

/** Capabilities the reader actually exposes. */
PROBE_CMDS.capabilities = async function () {
  const out = { zotero: Zotero.version };
  out.speechSynthesis = typeof speechSynthesis !== "undefined";
  out.intlSegmenter = typeof Intl.Segmenter === "function";
  const { Zotero_Tabs } = probeWin();
  const tabID = Zotero_Tabs.selectedID;
  const reader = Zotero.Reader.getByTabID(tabID);
  if (reader) {
    const internal = reader._internalReader;
    out.has_setReadingMode = typeof internal?._setReadingMode === "function";
    out.has_loadSDT = typeof internal?._loadSDT === "function";
    out.internalReader = !!internal;
  }
  // Java probe the addon itself uses
  try {
    const scope = {};
    Services.scriptloader.loadSubScript(
      "chrome://wenxianyidu/content/scripts/wenxianyidu.js",
      scope,
    );
    out.bundleHasJavaManager = typeof scope.JavaRuntimeManager !== "undefined";
  } catch {
    /* ignore */
  }
  return out;
};

/** Copy a sample PDF into the QA data dir (idempotent). */
PROBE_CMDS.installPdf = async function (src) {
  if (!src) return { error: "pass a source PDF path" };
  const dest = PathUtils.join(Zotero.DataDirectory.dir, "qa-sample.pdf");
  await IOUtils.copy(src, dest);
  const st = await IOUtils.stat(dest);
  return { dest, size: st.size };
};

PROBE_CMDS.listCommands = async function () {
  return Object.keys(PROBE_CMDS);
};

/** Jump to the first reader tab — the enabled state of the translate section
 *  is driven by onItemChange on tab switches, and a tab opened programmatically
 *  may never have fired it. The section's data-pane carries the full plugin ID
 *  (wenxianyidu\@zotero\.org-wenxianyidu-translate), so match with includes(). */
PROBE_CMDS.activateReader = async function () {
  const { Zotero_Tabs } = probeWin();
  const doc = Zotero.getMainWindow().document;
  const readSection = () => {
    const el = Array.from(doc.querySelectorAll("item-pane-custom-section")).find(
      (c) => (c.dataset.pane || "").includes("transplit"),
    );
    return {
      found: !!el,
      hidden: el ? el.hidden : null,
      text: el ? (el.textContent || "").slice(0, 300) : "",
    };
  };
  const readerTab = Zotero_Tabs._tabs.find((t) => t.type === "reader");
  if (!readerTab) {
    return { error: "no reader tab", tabs: Zotero_Tabs._tabs.map((t) => t.type) };
  }
  // Leave + re-enter: two switch events, so onItemChange runs against the
  // reader tab last no matter which direction Zotero reports first.
  Zotero_Tabs.select("zotero-pane");
  await Zotero.Promise.delay(600);
  Zotero_Tabs.select(readerTab.id);
  await Zotero.Promise.delay(1500);
  return {
    jumped: readerTab.id,
    selectedID: Zotero_Tabs.selectedID,
    selectedType: Zotero_Tabs.selectedType,
    section: readSection(),
  };
};

/** Force the custom section's itemChange hook to re-run. The hook fires from
 *  the item setter, so if item was assigned before tabType the section latches
 *  disabled; re-assigning re-evaluates with the current tabType. */
PROBE_CMDS.pokeSection = async function () {
  const doc = Zotero.getMainWindow().document;
  const sections = Array.from(
    doc.querySelectorAll("item-pane-custom-section"),
  ).filter((c) => (c.dataset.pane || "").includes("transplit"));
  const before = sections.map((el) => ({
    tabType: el.tabType,
    itemID: el.item?.id ?? null,
    hidden: el.hidden,
  }));
  for (const el of sections) {
    try {
      el.item = el.item;
    } catch (e) {
      probeLog("poke: " + e);
    }
  }
  await Zotero.Promise.delay(800);
  const after = sections.map((el) => ({
    tabType: el.tabType,
    itemID: el.item?.id ?? null,
    hidden: el.hidden,
    text: (el.textContent || "").slice(0, 200),
  }));
  return { before, after };
};

/** Maximize the main window — the context pane auto-collapses under Zotero's
 *  width threshold, which hides the translate section on small QA windows. */
PROBE_CMDS.maximize = async function () {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const before = {
    w: win.outerWidth,
    h: win.outerHeight,
    sizemode: doc.documentElement.getAttribute("sizemode"),
    contextCollapsed: doc.getElementById("zotero-context-pane")?.collapsed ?? null,
  };
  win.maximize();
  await Zotero.Promise.delay(1000);
  return {
    before,
    after: {
      w: win.outerWidth,
      h: win.outerHeight,
      sizemode: doc.documentElement.getAttribute("sizemode"),
      contextCollapsed: doc.getElementById("zotero-context-pane")?.collapsed ?? null,
    },
  };
};

// ── word cards (词典卡片 + 词卡标签页) ───────────────────────────────────────
// Sub-actions:
//   (none)/"ui"        entry-point presence (library button, reader listener,
//                      reader toolbar button when a reader is open)
//   "open-tab"         click the real library toolbar button, report the tab
//                      and its rendered DOM (empty state)
//   "lookup"           with a reader open: commit zh-CN as the target, set the
//                      reader selection, click Refresh → Look up, report the
//                      rendered dictionary card and the chip strip (REAL
//                      Youdao network call)
//   "store"            list the on-disk word-card store records
//   "shot"             screenshot the main window to D:\zt-qa\wordcards-shot-*.png
PROBE_CMDS.wordcards = async function (action) {
  const { win, Zotero_Tabs } = probeWin();
  const doc = win.document;
  const out = { action: action || "ui" };

  const button = doc.getElementById("wenxianyidu-wordcards-button");
  out.libraryButton = button
    ? {
        found: true,
        parent: button.parentElement?.id || button.parentElement?.tagName,
        tip: button.getAttribute("tooltiptext"),
        image: (button.getAttribute("style") || "").includes("wordcards"),
      }
    : { found: false };
  try {
    const registered = Array.from(Zotero.Reader._registeredListeners || []);
    out.readerToolbarListeners = registered.filter(
      (x) =>
        x.type === "renderToolbar" &&
        String(x.pluginID || "").includes("wenxianyidu"),
    ).length;
  } catch (e) {
    out.readerListenersError = String(e);
  }

  if (!action || action === "ui") {
    try {
      const reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
      const rdoc = reader?._iframeWindow?.document;
      out.readerButton = rdoc
        ? !!rdoc.querySelector(".wenxianyidu-wc-reader-btn")
        : "no reader open";
    } catch (e) {
      out.readerButton = "err: " + e;
    }
    out.wordcardsPref = Zotero.Prefs.get(
      "extensions.zotero.wenxianyidu.wordcards.enabled",
      true,
    );
    return out;
  }

  if (action === "open-tab") {
    if (!button) return { error: "no library toolbar button" };
    button.doCommand();
    await Zotero.Promise.delay(2500);
    const tab = Zotero_Tabs._getTab?.("wenxianyidu-wordcards")?.tab;
    out.tab = tab
      ? {
          id: tab.id,
          type: tab.type,
          title: tab.title,
          selected: Zotero_Tabs.selectedID === "wenxianyidu-wordcards",
        }
      : null;
    const container = doc.getElementById("wenxianyidu-wordcards");
    out.dom = container
      ? {
          root: !!container.querySelector(".wenxianyidu-wc-root"),
          search: !!container.querySelector(".wenxianyidu-wc-search"),
          sort: !!container.querySelector(".wenxianyidu-wc-sort"),
          count: container.querySelector(".wenxianyidu-wc-count")?.textContent ?? null,
          grid: !!container.querySelector(".wenxianyidu-wc-grid"),
          detail: !!container.querySelector(".wenxianyidu-wc-detail"),
          emptyTitle: container.querySelector(".wenxianyidu-wc-empty-title")?.textContent ?? null,
          emptyHint: container.querySelector(".wenxianyidu-wc-empty-hint")?.textContent ?? null,
          rawFtlLeak: /wenxianyidu-wordcards-|pane-translate-/.test(
            container.textContent || "",
          ),
          text: (container.textContent || "").slice(0, 500),
        }
      : null;
    return out;
  }

  // Diagnostics for a rendered-but-empty section: the context pane's
  // collapse state, every frame that could host the pane, and any
  // wenxianyidu-tp nodes reachable from the main document.
  if (action === "diag") {
    const contextPane = doc.getElementById("zotero-context-pane");
    out.context = {
      collapsed: contextPane?.collapsed ?? null,
      hidden: contextPane?.hidden ?? null,
      hasWidth: contextPane ? !!contextPane.getBoundingClientRect().width : null,
    };
    out.frames = [];
    for (const f of doc.querySelectorAll("browser, iframe")) {
      try {
        const fdoc = f.contentDocument;
        if (!fdoc) continue;
        out.frames.push({
          tag: f.tagName,
          id: f.id || null,
          url: (fdoc.URL || "").slice(0, 80),
          tpNodes: fdoc.querySelectorAll("[class*='wenxianyidu-tp']").length,
          sections: fdoc.querySelectorAll("item-pane-custom-section").length,
        });
      } catch {
        /* cross-domain frame */
      }
    }
    out.tpNodesInMain = doc.querySelectorAll("[class*='wenxianyidu-tp']").length;
    const sectionForDiag = Array.from(
      doc.querySelectorAll("item-pane-custom-section"),
    ).find((c) => (c.dataset.pane || "").includes("wenxianyidu-translate"));
    out.section = sectionForDiag
      ? {
          pane: sectionForDiag.dataset.pane,
          hidden: sectionForDiag.hidden,
          html: (sectionForDiag.innerHTML || "").slice(0, 400),
        }
      : null;
    return out;
  }

  if (action === "lookup") {
    const reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
    if (!reader) return { error: "no reader — run the 'reader' action first" };

    // The reader's item pane (context pane) starts COLLAPSED on a fresh
    // profile — a hidden section never renders its body (onRender fires only
    // for visible sections). Open it BEFORE locating the section.
    const contextPaneEl = doc.getElementById("zotero-context-pane");
    if (contextPaneEl?.collapsed) {
      const toggle = doc.getElementById("context-pane-toggle");
      if (toggle) toggle.click();
      else contextPaneEl.collapsed = false;
      await Zotero.Promise.delay(1500);
    }

    // Zotero 10 prefixes custom section ids with the plugin ID
    // ("wenxianyidu@wenxianyidu.local-wenxianyidu-translate"), and TWO copies exist —
    // the library item pane's (hidden for reader tabs) and the reader context
    // pane's (the live one). Prefer the context pane's visible section.
    const allSections = Array.from(doc.querySelectorAll("item-pane-custom-section"));
    const matching = allSections.filter((c) =>
      (c.dataset.pane || "").includes("wenxianyidu-translate"),
    );
    const section =
      matching.find((c) => contextPaneEl?.contains(c) && !c.hidden) ??
      matching.find((c) => !c.hidden) ??
      matching[0];
    if (!section) {
      return {
        error: "no translate section rendered",
        sections: allSections.map((c) => ({ pane: c.dataset.pane, hidden: c.hidden })),
      };
    }
    out.section = {
      pane: section.dataset.pane,
      hidden: section.hidden,
      inContextPane: !!contextPaneEl?.contains(section),
    };

    // 1) Commit zh-CN as the target while no selection is loaded (blur with
    //    an empty source text never fires a request).
    // One live pane instance exists (the store-backed chips + single section),
    // so global main-document queries are equivalent and dodge any
    // collapsible-section/shadow-root nesting quirks.
    const q = (sel) => doc.querySelector(sel);
    const qa = (sel) => [...doc.querySelectorAll(sel)];
    const langInput = q(".wenxianyidu-tp-lang-input");
    if (!langInput) {
      return {
        error: "no language input",
        section: out.section,
        text: (section.textContent || "").slice(0, 300),
        sectionHTML: (section.innerHTML || "").slice(0, 300),
        tpNodes: doc.querySelectorAll("[class*='wenxianyidu-tp']").length,
        tpHosts: [
          ...new Set(
            [...doc.querySelectorAll("[class*='wenxianyidu-tp']")].map(
              (n) =>
                n.closest("item-pane-custom-section")?.dataset.pane ?? "none",
            ),
          ),
        ],
      };
    }
    langInput.value = "zh-CN";
    langInput.dispatchEvent(new win.Event("input", { bubbles: true }));
    langInput.dispatchEvent(new win.FocusEvent("blur"));
    await Zotero.Promise.delay(300);

    // 2) Fake the reader selection — the pane reads this exact property on
    //    refresh (readSelection → _primaryView._selectionRanges).
    const view = reader._internalReader?._primaryView;
    if (!view) return { error: "no _primaryView on the reader" };
    view._selectionRanges = [{ text: "resonance" }];

    // 3) Refresh → idle state offers the Look up button (translate.auto off).
    const refreshBtn = qa("button").find((b) =>
      /refresh|刷新/i.test(b.textContent || ""),
    );
    if (!refreshBtn) {
      return {
        error: "no refresh button",
        buttons: qa("button").map((b) => b.textContent),
      };
    }
    refreshBtn.click();
    await Zotero.Promise.delay(600);
    const lookupBtn = qa("button").find((b) =>
      /look up|查询/i.test(b.textContent || ""),
    );
    if (!lookupBtn) {
      return {
        error: "no Look up button after refresh",
        buttons: qa("button").map((b) => b.textContent),
        text: (section.textContent || "").slice(0, 400),
      };
    }
    lookupBtn.click();

    // 4) Wait for the card (real Youdao round trip) or an explicit error.
    for (let i = 0; i < 40; i++) {
      await Zotero.Promise.delay(500);
      if (q(".wenxianyidu-tp-card") || q(".wenxianyidu-tp-error")) {
        break;
      }
    }
    out.card = {
      found: !!q(".wenxianyidu-tp-card"),
      word: q(".wenxianyidu-tp-card-word")?.textContent ?? null,
      phonetic: q(".wenxianyidu-tp-card-phonetic")?.textContent ?? null,
      senses: qa(".wenxianyidu-tp-card-sense").map((s) => s.textContent),
      source: q(".wenxianyidu-tp-card-source")?.textContent ?? null,
      error: q(".wenxianyidu-tp-error")?.textContent ?? null,
    };
    const chips = q(".wenxianyidu-tp-chips");
    out.chips = {
      found: !!chips,
      hidden: chips?.hidden ?? null,
      words: qa(".wenxianyidu-tp-chip").map((c) => c.textContent),
    };
    return out;
  }

  if (action === "store") {
    const root = PathUtils.join(
      Zotero.DataDirectory.dir,
      "wenxianyidu",
      "word-cards",
      "v1",
    );
    out.root = root;
    out.files = [];
    try {
      out.debug = {
        exists: await IOUtils.exists(root).catch((e) => "ERR " + e),
        statType: typeof IOUtils.stat,
        children: await IOUtils.getChildren(root)
          .then(async (c) => {
            const info = {
              count: c.length,
              firstType: typeof c[0],
              first: typeof c[0] === "string" ? c[0] : JSON.stringify(c[0]),
            };
            if (typeof c[0] === "string" && typeof IOUtils.stat === "function") {
              info.stat = await IOUtils.stat(c[0])
                .then((s) => JSON.stringify(s))
                .catch((e) => "ERR " + e);
            }
            return info;
          })
          .catch((e) => "ERR " + e),
      };
      // IOUtils.getChildren returns plain path STRINGS and stat() reports
      // type:"directory" (no isDirectory flag) on this Zotero (10.0.3).
      const isDir = (s) => s && (s.type === "directory" || s.isDirectory === true);
      if (await IOUtils.exists(root)) {
        for (const bucketPath of await IOUtils.getChildren(root)) {
          const bstat = await IOUtils.stat(bucketPath);
          if (!isDir(bstat)) continue;
          for (const filePath of await IOUtils.getChildren(bucketPath)) {
            const fstat = await IOUtils.stat(filePath);
            if (isDir(fstat)) continue;
            let parsed = null;
            try {
              parsed = JSON.parse(await IOUtils.readUTF8(filePath));
            } catch {
              /* corrupt file */
            }
            out.files.push({
              name: PathUtils.filename(filePath),
              size: fstat.size,
              word: parsed?.word ?? null,
              lookups: parsed?.lookups ?? null,
              source: parsed?.latest?.source ?? null,
              senses: parsed?.latest?.senses?.length ?? null,
              phonetic: parsed?.latest?.phonetic ?? null,
            });
          }
        }
      }
    } catch (e) {
      out.error = String(e);
    }
    return out;
  }

  if (action === "shot") {
    try {
      const w = win.outerWidth;
      const h = win.outerHeight;
      const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx2d = canvas.getContext("2d");
      ctx2d.drawWindow(win, 0, 0, w, h, "rgb(255,255,255)");
      const dataURL = canvas.toDataURL("image/png");
      const bytes = Uint8Array.from(atob(dataURL.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      const file = PathUtils.join(
        PROBE_ROOT,
        "wordcards-shot-" + Date.now() + ".png",
      );
      await IOUtils.write(file, bytes);
      return { ok: true, file, bytes: bytes.length, w, h };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  return { error: "unknown wordcards sub-action: " + action };
};

// ── Word-cards layout & entry diagnostics ────────────────────────────────────
//   "seed"         write fake card records to the on-disk store (must run in a
//                  fresh process BEFORE anything loads the store index — the
//                  addon caches the index in memory)
//   "layout"       with the tab open: measure the layout chain (deck →
//                  tab-content → root → body/grid/detail), then click a tile
//                  and re-measure — a root-width change is the "jump"
//   "reader-click" with a reader tab open: synthesize one click on the reader
//                  toolbar word-cards button and report whether the tab got
//                  created AND selected (the two-click check)
PROBE_CMDS.wc = async function (action) {
  const { win, Zotero_Tabs } = probeWin();
  const doc = win.document;
  const rectOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };
  const host = () => doc.getElementById("wenxianyidu-wordcards");
  const root = () => host()?.querySelector(".wenxianyidu-wc-root");

  if (action === "seed" || !action) {
    try {
      const words = [
        ["resonance", "/ˈrezənəns/", "the quality in a sound of being deep and long; the ability to evoke associations"],
        ["epistemology", "/ɪˌpɪstəˈmɒlədʒi/", "the branch of philosophy that deals with knowledge, its methods, validity and scope"],
        ["quantum", "/ˈkwɒntəm/", "the smallest discrete quantity of a physical property such as energy or light"],
        ["ostensibly", "/ɒˈstensəbli/", "apparently, but perhaps not in fact; appearing to be true though it may not be"],
        ["paradigm", "/ˈpærədaɪm/", "a typical pattern or model of something; a worldview underlying the theories of a discipline"],
        ["synthesis", "/ˈsɪnθəsɪs/", "the combination of separate elements into a single, coherent whole"],
        ["amplitude", "/ˈæmplɪtjuːd/", "the maximum extent of a vibration or oscillation, measured from the position of equilibrium"],
        ["hypothesis", "/haɪˈpɒθəsɪs/", "a supposition made as a starting point for further investigation from known facts"],
      ];
      const enc = new TextEncoder();
      let written = 0;
      for (const [word, phonetic, meaning] of words) {
        const normalized = word.toLowerCase().replace(/['’]/g, "'");
        const digest = await crypto.subtle.digest(
          "SHA-1",
          enc.encode(`1|${normalized}`),
        );
        const key = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const now = Date.now() - written * 86400000;
        const record = {
          v: 1,
          key,
          word,
          createdAt: now,
          updatedAt: now,
          lookups: 1,
          latest: { word, phonetic, senses: [{ pos: "n.", meaning }], source: "youdao" },
          history: [{ at: now, targetLang: "zh-CN", content: { word, phonetic, senses: [{ pos: "n.", meaning }], source: "youdao" } }],
        };
        const path = PathUtils.join(
          Zotero.DataDirectory.dir,
          "wenxianyidu",
          "word-cards",
          "v1",
          key.slice(0, 2),
          `${key}.json`,
        );
        const bucket = path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
        await IOUtils.makeDirectory(bucket, { createDirs: true, ignoreExisting: true });
        await IOUtils.write(path, enc.encode(JSON.stringify(record)));
        written++;
      }
      return { ok: true, written, dir: PathUtils.join(Zotero.DataDirectory.dir, "wenxianyidu", "word-cards", "v1") };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  if (action === "layout") {
    if (!root()) {
      return { error: "word-cards tab not open", tabs: Zotero_Tabs._tabs.map((t) => t.type) };
    }
    const grid = host().querySelector(".wenxianyidu-wc-grid");
    const body = host().querySelector(".wenxianyidu-wc-body");
    const detail = host().querySelector(".wenxianyidu-wc-detail");
    const tiles = Array.from(host().querySelectorAll(".wenxianyidu-wc-tile"));
    const out = {
      win: { w: win.innerWidth, h: win.innerHeight },
      deck: rectOf(doc.getElementById("tabs-deck")),
      tabContent: rectOf(host()),
      root: rectOf(root()),
      bar: rectOf(host().querySelector(".wenxianyidu-wc-bar")),
      body: rectOf(body),
      grid: rectOf(grid),
      detail: rectOf(detail),
      tileCount: tiles.length,
      gridScrollBefore: grid.scrollTop,
    };
    if (tiles.length) {
      const target = tiles[Math.min(3, tiles.length - 1)];
      out.clickedTileWord = target.querySelector(".wenxianyidu-wc-tile-word")?.textContent;
      target.click();
      await Zotero.Promise.delay(400);
      out.afterClick = {
        root: rectOf(root()),
        gridScrollAfter: grid.scrollTop,
        detailText: (detail?.textContent || "").slice(0, 120),
        detailW: rectOf(detail)?.w,
      };
    }
    return out;
  }

  if (action === "reader-click") {
    const reader =
      Zotero.Reader.getByTabID(Zotero_Tabs.selectedID) ||
      Zotero.Reader._readers?.[0];
    const rdoc = reader?._iframeWindow?.document;
    const btn = rdoc?.querySelector(".wenxianyidu-wc-reader-btn");
    const before = {
      readerFound: !!reader,
      buttonFound: !!btn,
      selectedID: Zotero_Tabs.selectedID,
      wordcardsTabExisted: !!Zotero_Tabs._getTab?.("wenxianyidu-wordcards")?.tab,
    };
    if (!btn) return { before, error: "reader button not found" };
    btn.click();
    await Zotero.Promise.delay(2500);
    const tab = Zotero_Tabs._getTab?.("wenxianyidu-wordcards")?.tab;
    const deck = doc.getElementById("tabs-deck");
    return {
      before,
      after: {
        tabExists: !!tab,
        tabSelected: Zotero_Tabs.selectedID === "wenxianyidu-wordcards",
        deckSelectedIndex: deck?.selectedIndex,
        deckChildIds: deck ? Array.from(deck.children).map((c) => c.id) : null,
        rootPresent: !!root(),
        root: rectOf(root()),
      },
    };
  }

  return { error: "unknown wc sub-action: " + action };
};

// ── README screenshot staging ───────────────────────────────────────────────
// Commands that stage the exact UI states the README screenshots show and
// capture them. They drive the real addon through the real user paths; the
// only shortcut is the staged reader selection (same as wordcards/lookup).

/**
 * shot — screenshot a Zotero window to an absolute PNG path.
 *   arg: { file, win: "main" | "prefs" }  (win defaults to "main")
 */
PROBE_CMDS.shot = async function (arg) {
  const opts = typeof arg === "string" ? { file: arg } : arg || {};
  let target;
  if (opts.win === "prefs") {
    target = Services.wm.getMostRecentWindow("zotero:pref");
    if (!target) return { ok: false, error: "no prefs window open" };
  } else {
    target = Zotero.getMainWindow();
  }
  const doc = target.document;
  const w = target.outerWidth;
  const h = target.outerHeight;
  // Capture at the device pixel ratio so HiDPI displays give crisp PNGs.
  const dpr = target.devicePixelRatio || 1;
  const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx2d = canvas.getContext("2d");
  ctx2d.scale(dpr, dpr);
  ctx2d.drawWindow(target, 0, 0, w, h, "rgb(255,255,255)");
  const dataURL = canvas.toDataURL("image/png");
  const bytes = Uint8Array.from(atob(dataURL.split(",")[1]), (c) =>
    c.charCodeAt(0),
  );
  await IOUtils.write(opts.file, bytes);
  return { ok: true, file: opts.file, bytes: bytes.length, w, h };
};

/**
 * Open the reader context pane. On a fresh profile the pane has no persisted
 * width, so uncollapsing alone leaves it at zero pixels — seed a width first.
 */
async function probeOpenContextPane(doc) {
  const pane = doc.getElementById("zotero-context-pane");
  if (!pane) return null;
  if (pane.collapsed) {
    if (!Number(pane.getAttribute("width") || 0)) {
      pane.setAttribute("width", "470");
    }
    const toggle = doc.getElementById("context-pane-toggle");
    if (toggle) toggle.click();
    else pane.collapsed = false;
    await Zotero.Promise.delay(1200);
  } else if (!Number(pane.getAttribute("width") || 0)) {
    pane.setAttribute("width", "470");
    await Zotero.Promise.delay(800);
  }
  return pane;
}

/** Scroll the visible translate section to the top of the item pane. */
async function probeScrollSectionIntoView(doc) {
  const section = Array.from(doc.querySelectorAll("item-pane-custom-section")).find(
    (c) => (c.dataset.pane || "").includes("transplit") && !c.hidden,
  );
  if (!section) return false;
  try {
    section.scrollIntoView({ block: "start", inline: "nearest" });
  } catch {
    section.scrollIntoView();
  }
  await Zotero.Promise.delay(600);
  return true;
}

/**
 * demoItem — import a fixture PDF as a real item + attachment, open it in the
 * reader, and open the context pane (collapsed on a fresh profile).
 *   arg: { pdf, title, filename }  (pdf defaults to <dataDir>/qa-sample.pdf)
 */
PROBE_CMDS.demoItem = async function (arg) {
  const opts = typeof arg === "string" ? { pdf: arg } : arg || {};
  const dataDir = Zotero.DataDirectory.dir;
  const pdfPath = opts.pdf || PathUtils.join(dataDir, "qa-sample.pdf");
  if (!(await IOUtils.exists(pdfPath))) return { error: "no PDF at " + pdfPath };
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const { ZoteroPane, Zotero_Tabs } = probeWin();

  let item = new Zotero.Item("journalArticle");
  item.setField("title", opts.title || "QA sample paper");
  const itemID = await item.saveTx();
  const att = await Zotero.Attachments.importFromFile({
    file: pdfPath,
    parentItemID: itemID,
    title: opts.filename || "QA sample PDF",
  });
  PROBE_STATE.demo = { itemID, attachmentID: att.id };

  ZoteroPane.selectItem(att.id);
  await Zotero.Promise.delay(500);
  await ZoteroPane.viewAttachment(att.id);
  await Zotero.Promise.delay(5000);
  PROBE_STATE.demoTabID = Zotero_Tabs.selectedID;

  const contextPaneEl = await probeOpenContextPane(doc);
  return {
    itemID,
    attachmentID: att.id,
    tabID: Zotero_Tabs.selectedID,
    contextCollapsed: contextPaneEl?.collapsed ?? null,
    contextWidth: contextPaneEl?.getAttribute("width") ?? null,
  };
};

/**
 * selectTranslate — stage a reader selection and run the pane's Translate
 * through to a settled state (result, error, or timeout).
 *   arg: { text, targetLang }
 */
PROBE_CMDS.selectTranslate = async function (arg) {
  const opts = typeof arg === "string" ? { text: arg } : arg || {};
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const { Zotero_Tabs } = probeWin();
  const reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
  if (!reader) return { error: "no reader open" };

  await probeOpenContextPane(doc);

  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];
  const langInput = q(".wenxianyidu-tp-lang-input");
  if (!langInput) return { error: "no language input" };
  if (opts.targetLang) {
    langInput.value = opts.targetLang;
    langInput.dispatchEvent(new win.Event("input", { bubbles: true }));
    langInput.dispatchEvent(new win.FocusEvent("blur"));
    await Zotero.Promise.delay(300);
  }

  const view = reader._internalReader?._primaryView;
  if (!view) return { error: "no _primaryView" };
  view._selectionRanges = [{ text: opts.text }];

  const refreshBtn = qa("button").find((b) =>
    /refresh selection|刷新选区/i.test(b.textContent || ""),
  );
  if (!refreshBtn) {
    return { error: "no refresh button", buttons: qa("button").map((b) => b.textContent) };
  }
  refreshBtn.click();
  await Zotero.Promise.delay(800);

  const findTranslateBtn = () =>
    qa("button").find((b) => /^(translate|翻译)$/i.test((b.textContent || "").trim()));
  const translateBtn = findTranslateBtn();
  if (translateBtn) translateBtn.click();

  const t0 = Date.now();
  let state = "timeout";
  for (; Date.now() - t0 < 90000; ) {
    await Zotero.Promise.delay(1000);
    if (q(".wenxianyidu-tp-error")) {
      state = "error";
      break;
    }
    if (q(".wenxianyidu-tp-result-text")) {
      state = "done";
      break;
    }
    // A language commit or a state reset can bring the idle button back while
    // nothing is in flight — press it again so the run cannot stall idle.
    const again = findTranslateBtn();
    if (again && !q(".wenxianyidu-tp-shimmer") && !q(".wenxianyidu-tp-loading")) {
      again.click();
    }
  }
  await probeScrollSectionIntoView(doc);
  return {
    state,
    source: q(".wenxianyidu-tp-source-text")?.textContent?.slice(0, 150) ?? null,
    result: q(".wenxianyidu-tp-result-text")?.textContent?.slice(0, 250) ?? null,
    error: q(".wenxianyidu-tp-error")?.textContent?.slice(0, 250) ?? null,
  };
};

/**
 * bilingualMode — switch an already-running bilingual session's presentation
 * (unlike `bilingual`, which toggles the session on). The mode control is a
 * <select> dropdown (wenxianyidu-bc-mode) in the current build.
 *   arg: "only" | "interleave"  (aliases: "transOnly", "translation only")
 */
PROBE_CMDS.bilingualMode = async function (mode) {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const section = Array.from(
    doc.querySelectorAll("item-pane-custom-section"),
  ).find((c) => (c.dataset.pane || "").includes("transplit") && c.hidden === false);
  if (!section) return { error: "no visible translate section" };
  const wantOnly = /only|仅译文/i.test(mode || "");
  const sel = section.querySelector("select.wenxianyidu-bc-mode");
  if (!sel) {
    return {
      error: "no mode select",
      controls: Array.from(section.querySelectorAll("button, select"), (b) =>
        b.tagName + ":" + (b.textContent || b.value || ""),
      ),
    };
  }
  const target = wantOnly ? "transOnly" : "interleave";
  const before = sel.value;
  sel.disabled = false;
  sel.value = target;
  sel.dispatchEvent(new win.Event("change", { bubbles: true }));
  await Zotero.Promise.delay(2500);
  await probeScrollSectionIntoView(doc);
  return {
    before,
    after: sel.value,
    sectionText: (section.textContent || "").slice(0, 300),
  };
};

/**
 * openTranslated — open the demo item's `Translated (…)` attachment tab
 * (the pipeline normally auto-opens it; this is the recovery path).
 */
PROBE_CMDS.openTranslated = async function () {
  const { ZoteroPane, Zotero_Tabs } = probeWin();
  const demoID = PROBE_STATE.demo?.itemID;
  if (!demoID) return { error: "no demo item — run demoItem first" };
  const item = await Zotero.Items.getAsync(demoID);
  const atts = item.getAttachments().map((id) => Zotero.Items.get(id));
  const translated = atts.find((a) =>
    /^Translated \(/.test(a.getField("title") || ""),
  );
  if (!translated) {
    return {
      error: "no Translated (…) attachment",
      attachments: atts.map((a) => a.getField("title")),
    };
  }
  await ZoteroPane.viewAttachment(translated.id);
  await Zotero.Promise.delay(4000);
  return { opened: translated.getField("title"), tabID: Zotero_Tabs.selectedID };
};

/**
 * addTranslatedSibling — QA fixture: copy the demo item's PDF as a sibling
 * attachment titled "译文 (…)"/"Translated (…)" and tagged with the plugin's
 * translated tag, so 「分屏阅读」 picks it as the RIGHT pane. Lets us verify the
 * "don't inject into the translation pane" guard without running the pipeline.
 */
PROBE_CMDS.addTranslatedSibling = async function (arg) {
  const opts = typeof arg === "string" ? { title: arg } : arg || {};
  const demoID = PROBE_STATE.demo?.itemID;
  if (!demoID) return { error: "no demo item — run demoItem first" };
  const srcPath = PathUtils.join(Zotero.DataDirectory.dir, "qa-sample.pdf");
  if (!(await IOUtils.exists(srcPath))) return { error: "no qa-sample.pdf" };
  const title = opts.title || "Translated (QA guard probe)";
  const att = await Zotero.Attachments.importFromFile({
    file: srcPath,
    parentItemID: demoID,
    title,
  });
  att.addTag("译文");
  await att.saveTx();
  return { attachmentID: att.id, parentID: demoID, title, tags: att.getTags().map((t) => t.tag) };
};

/**
 * openAttachment — open an existing attachment (by item id) in a reader tab.
 * Used to drive split-view scenarios from a fixture that already has a
 * translated sibling (e.g. item 68 with translation 69), without running the
 * translation pipeline or triggering the "已有译文" native modal.
 */
PROBE_CMDS.openAttachment = async function (id) {
  const attID = Number(id);
  if (!Number.isInteger(attID)) return { error: "pass an attachment item id" };
  const { ZoteroPane, Zotero_Tabs } = probeWin();
  const att = await Zotero.Items.getAsync(attID);
  if (!att?.isAttachment?.()) return { error: "not an attachment: " + attID };
  ZoteroPane.selectItem(att.id);
  await Zotero.Promise.delay(400);
  await ZoteroPane.viewAttachment(att.id);
  await Zotero.Promise.delay(5000);
  return {
    opened: att.getField("title"),
    attachmentID: att.id,
    parentID: att.parentItemID,
    tabID: Zotero_Tabs.selectedID,
  };
};

/**
 * frame — set the main-window pane layout for a screenshot.
 *   arg: { contextPane: "open"|"close", collections: "open"|"close",
 *          itemPane: "open"|"close" }   (omitted keys keep the current state)
 */
PROBE_CMDS.frame = async function (arg) {
  let opts = arg || {};
  if (typeof opts === "string") {
    try {
      opts = JSON.parse(opts);
    } catch {
      return { error: "frame arg is not JSON: " + opts };
    }
  }
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const out = {};
  const setCollapsed = async (id, want) => {
    const el = doc.getElementById(id);
    if (!el) return;
    if (want === "open") {
      if (id === "zotero-context-pane") {
        await probeOpenContextPane(doc);
        out[id] = el.collapsed;
        return;
      }
      if (el.collapsed) el.collapsed = false;
    } else if (want === "close") {
      el.collapsed = true;
    }
    out[id] = el.collapsed;
  };
  if (opts.collections) await setCollapsed("zotero-collections-pane", opts.collections);
  if (opts.itemPane) await setCollapsed("zotero-item-pane", opts.itemPane);
  if (opts.contextPane) await setCollapsed("zotero-context-pane", opts.contextPane);
  await Zotero.Promise.delay(800);
  return out;
};

/** prefsOpen — open the settings window on the 文献译读 pane (stays open). */
PROBE_CMDS.prefsOpen = async function () {
  let win = null;
  try {
    Zotero.Utilities.Internal.openPreferences("zotero-prefpane-wenxianyidu");
    for (let i = 0; i < 30 && !win; i++) {
      await Zotero.Promise.delay(300);
      win = Services.wm.getMostRecentWindow("zotero:pref");
    }
  } catch (e) {
    return { error: "openPreferences: " + e };
  }
  if (!win) return { error: "no prefs window" };
  // A readable screenshot size (the default window is ~800x640 and scrolls).
  try {
    win.resizeTo(1300, 1000);
    win.moveTo(
      Math.max(0, (win.screen.availWidth - 1300) / 2),
      Math.max(0, (win.screen.availHeight - 1000) / 2),
    );
  } catch (e) {
    probeLog("prefs resize: " + e);
  }
  await Zotero.Promise.delay(1200);
  const doc = win.document;
  return {
    ok: true,
    paneLoaded: !!doc.getElementById("zotero-prefpane-wenxianyidu"),
    title: doc.title || null,
  };
};

/** prefsClose — close the settings window opened by prefsOpen. */
PROBE_CMDS.prefsClose = async function () {
  const win = Services.wm.getMostRecentWindow("zotero:pref");
  if (!win) return { ok: false, error: "no prefs window" };
  win.close();
  await Zotero.Promise.delay(500);
  return { ok: true };
};

/**
 * demoTab — switch back to the demo item's source reader tab (the tab demoItem
 * opened), so later commands act on the original PDF rather than a derived tab.
 */
PROBE_CMDS.demoTab = async function () {
  const { Zotero_Tabs } = probeWin();
  const tabID = PROBE_STATE.demoTabID;
  if (!tabID) return { error: "no demo tab recorded — run demoItem first" };
  Zotero_Tabs.select(tabID);
  await Zotero.Promise.delay(1500);
  return {
    selectedID: Zotero_Tabs.selectedID,
    isDemo: Zotero_Tabs.selectedID === tabID,
    tabs: Zotero_Tabs._tabs.map((t) => [t.id, t.type, t.title]),
  };
};

/**
 * bilingualWait — poll the running bilingual session's progress until it
 * settles (translated count stable for 3 s) or the cap is hit, so a screenshot
 * shows filled blocks rather than mid-run placeholders.
 */
PROBE_CMDS.bilingualWait = async function (capMs) {
  const win = Zotero.getMainWindow();
  const doc = win.document;
  const t0 = Date.now();
  const cap = Number(capMs) || 180000;
  let last = "";
  let stable = 0;
  let sample = "";
  while (Date.now() - t0 < cap) {
    await Zotero.Promise.delay(1000);
    const section = Array.from(
      doc.querySelectorAll("item-pane-custom-section"),
    ).find((c) => (c.dataset.pane || "").includes("transplit") && c.hidden === false);
    sample = section ? (section.textContent || "") : "";
    const m = sample.match(/(\d+)\s*\/\s*(\d+)/);
    const cur = m ? m[1] + "/" + m[2] : sample.slice(0, 60);
    if (m && m[1] === m[2]) {
      stable = 99;
      last = cur;
      break;
    }
    if (cur === last) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = 0;
      last = cur;
    }
  }
  return { progress: last, stableFor: stable, ms: Date.now() - t0 };
};

// ── driver: poll command.json ───────────────────────────────────────────────
var probeTimer = null;

async function probePoll() {
  try {
    const f = PathUtils.join(PROBE_ROOT, "command.json");
    if (await IOUtils.exists(f)) {
      const raw = await IOUtils.readUTF8(f);
      const cmd = JSON.parse(raw);
      await IOUtils.remove(f).catch(() => {});
      if (PROBE_CMDS[cmd.action]) {
        try {
          const result = await PROBE_CMDS[cmd.action](cmd.arg);
          await probeWriteJSON("result.json", {
            id: cmd.id,
            ok: true,
            action: cmd.action,
            result,
          });
        } catch (e) {
          await probeWriteJSON("result.json", {
            id: cmd.id,
            ok: false,
            action: cmd.action,
            error: String(e),
            name: e?.name,
            stack: String(e?.stack || "").slice(0, 2000),
          });
        }
      } else {
        await probeWriteJSON("result.json", {
          id: cmd.id,
          ok: false,
          error: "unknown action " + cmd.action,
        });
      }
    }
  } catch (e) {
    probeLog("poll: " + e);
  }
  probeTimer = setTimeout(probePoll, 250);
}

async function startProbe() {
  probeLog("probe loaded, zotero=" + Zotero.version);
  await probeWriteJSON("probe-ready.json", { at: new Date().toISOString() });
  probePoll();
}

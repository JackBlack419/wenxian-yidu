/**
 * 文献译读 设置面板（编辑 → 设置 → 文献译读）行为脚本。
 *
 * 由 Zotero.PreferencePanes.register({ scripts: [...] }) 加载，执行时机早于
 * 面板 DOM 插入设置窗口（见 Zotero_Preferences._loadPane：先加载脚本，再拉取
 * 并解析 xhtml 片段），所以这里不能直接查询元素；入口是片段根元素上的
 * onload="WenxianYiduPrefs.onLoad(event)"（Zotero 在 _initImportedNodesPostInsert
 * 里对面板容器每个子元素派发 load 事件）。
 *
 * 约定：
 *   - 面板脚本运行在 Cu.Sandbox(window, { sandboxPrototype: window }) 中，
 *     document / Zotero 都从设置窗口解析；顶层声明不会挂到 window 上，所以
 *     必须显式挂 window.WenxianYiduPrefs 才能被 xhtml 里的 oncommand 调用。
 *   - 只用 Zotero.Prefs / Zotero.PDFTranslate / Zotero.DataDirectory 这些
 *     设置窗口里一定存在的 API，不依赖插件主包（Zotero.WenxianYidu）是否加载。
 *   - 任何一步失败都不能让面板崩掉：全部 try/catch，且不弹 alert/confirm，
 *     出错只写 Zotero.debug。
 *   - 引擎切换只切 hidden 属性，不重建 DOM、不移动焦点，因此不跳焦也不抖滚动。
 */

(function () {
  "use strict";

  var PREF_PREFIX = "extensions.zotero.wenxianyidu.";

  var MAX_CHARS_MIN = 100;
  var MAX_CHARS_MAX = 50000;
  var MAX_CHARS_DEFAULT = 10000;

  // 与 addon/prefs.js 的 translate.batchMaxTokens 默认值对齐。
  var BATCH_TOKENS_MIN = 1000;
  var BATCH_TOKENS_MAX = 65536;
  var BATCH_TOKENS_DEFAULT = 8192;

  /**
   * 字体覆盖目录。与 src/core/pdf/translation/opendataloaderSplitAdapter.ts
   * #translationAssetsDir 保持一字不差：代码读的是 {DataDir}/wenxianyidu/…，
   * 面板就必须显示同一个路径，否则用户会把字体放错地方。
   */
  var ASSETS_SUBDIR = "wenxianyidu/translation-assets";

  /** 引擎值 -> 字段组元素 id（与 xhtml 中的 id 对应）。 */
  var ENGINE_GROUPS = [
    ["youdao", "wenxianyidu-pref-engine-youdao"],
    ["niutrans", "wenxianyidu-pref-engine-niutrans"],
    ["youdao-official", "wenxianyidu-pref-engine-youdao-official"],
    ["google", "wenxianyidu-pref-engine-google"],
    ["bing", "wenxianyidu-pref-engine-bing"],
    ["bing-web", "wenxianyidu-pref-engine-bingweb"],
    ["deepl", "wenxianyidu-pref-engine-deepl"],
    ["ai", "wenxianyidu-pref-engine-ai"],
    ["custom", "wenxianyidu-pref-engine-custom"],
    ["zotero-pdf-translate", "wenxianyidu-pref-engine-pdftranslate"],
  ];

  /** 元素引用缓存，load 时填充。 */
  var els = {};

  /** zotero-pdf-translate 下拉项的两种标签（本地化后的）。 */
  var pdfTranslateLabels = { base: "", missing: "" };

  function $(id) {
    try {
      return document.getElementById(id);
    } catch (e) {
      return null;
    }
  }

  function show(el, visible) {
    if (!el) return;
    try {
      if (visible) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "true");
    } catch (e) {
      /* 忽略：元素可能已被替换 */
    }
  }

  function getPref(key) {
    try {
      return Zotero.Prefs.get(PREF_PREFIX + key, true);
    } catch (e) {
      return undefined;
    }
  }

  function setPref(key, value) {
    try {
      Zotero.Prefs.set(PREF_PREFIX + key, value, true);
      return true;
    } catch (e) {
      Zotero.debug("[文献译读] prefs: set " + key + " failed: " + e);
      return false;
    }
  }

  // ── maxChars ────────────────────────────────────────────────────────────

  function readMaxChars() {
    var raw = getPref("translate.maxChars");
    var n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    if (!isFinite(n) || isNaN(n)) return MAX_CHARS_DEFAULT;
    return Math.min(MAX_CHARS_MAX, Math.max(MAX_CHARS_MIN, Math.round(n)));
  }

  function setMaxCharsError(visible) {
    show(els.maxCharsError, visible);
    if (els.maxCharsInput) {
      try {
        if (visible) els.maxCharsInput.setAttribute("aria-invalid", "true");
        else els.maxCharsInput.removeAttribute("aria-invalid");
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  /** 解析输入框内容；合法返回整数，否则返回 null。 */
  function parseMaxChars(raw) {
    if (raw === null || raw === undefined) return null;
    var text = String(raw).trim();
    if (text === "") return null;
    if (!/^\d+$/.test(text)) return null;
    var n = parseInt(text, 10);
    if (!isFinite(n)) return null;
    if (n < MAX_CHARS_MIN || n > MAX_CHARS_MAX) return null;
    return n;
  }

  function onMaxCharsInput() {
    if (!els.maxCharsInput) return;
    var n = parseMaxChars(els.maxCharsInput.value);
    if (n === null) {
      // 输入中途（空串 / 超范围 / 非数字）只提示，不写 pref：
      // 半成品值不该污染设置，也不会触发 Zotero.Prefs.set 的整型转换异常。
      setMaxCharsError(true);
      return;
    }
    setMaxCharsError(false);
    setPref("translate.maxChars", n);
  }

  function onMaxCharsChange() {
    if (!els.maxCharsInput) return;
    var n = parseMaxChars(els.maxCharsInput.value);
    if (n !== null) {
      setMaxCharsError(false);
      setPref("translate.maxChars", n);
      return;
    }
    // 失焦时仍不合法（非纯整数 / 越界 / 负数 / 空串）：恢复为当前 pref 值且
    // 不写 pref —— 与文案承诺一致（“填错或留空时会继续使用上一次的合法值，
    // 不会改写设置”），越界值也不得被夹紧后覆盖设置。
    els.maxCharsInput.value = String(readMaxChars());
    setMaxCharsError(false);
  }

  // ── batchMaxTokens（合并批量输入上限）────────────────────────────────────
  // 与 maxChars 同一套路：INT pref 不写半成品值，读 pref → 校验 → 写 pref。

  function readBatchTokens() {
    var raw = getPref("translate.batchMaxTokens");
    var n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    if (!isFinite(n) || isNaN(n)) return BATCH_TOKENS_DEFAULT;
    return Math.min(BATCH_TOKENS_MAX, Math.max(BATCH_TOKENS_MIN, Math.round(n)));
  }

  function setBatchTokensError(visible) {
    show(els.batchTokensError, visible);
    if (els.batchTokensInput) {
      try {
        if (visible) els.batchTokensInput.setAttribute("aria-invalid", "true");
        else els.batchTokensInput.removeAttribute("aria-invalid");
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  /** 解析输入框内容；合法返回整数，否则返回 null。 */
  function parseBatchTokens(raw) {
    if (raw === null || raw === undefined) return null;
    var text = String(raw).trim();
    if (text === "") return null;
    if (!/^\d+$/.test(text)) return null;
    var n = parseInt(text, 10);
    if (!isFinite(n)) return null;
    if (n < BATCH_TOKENS_MIN || n > BATCH_TOKENS_MAX) return null;
    return n;
  }

  function onBatchTokensInput() {
    if (!els.batchTokensInput) return;
    var n = parseBatchTokens(els.batchTokensInput.value);
    if (n === null) {
      setBatchTokensError(true);
      return;
    }
    setBatchTokensError(false);
    setPref("translate.batchMaxTokens", n);
  }

  function onBatchTokensChange() {
    if (!els.batchTokensInput) return;
    var n = parseBatchTokens(els.batchTokensInput.value);
    if (n !== null) {
      setBatchTokensError(false);
      setPref("translate.batchMaxTokens", n);
      return;
    }
    // 与 maxChars 同一策略：非法值一律恢复为当前 pref 值且不写 pref。
    els.batchTokensInput.value = String(readBatchTokens());
    setBatchTokensError(false);
  }

  // ── AI prompt 模板 ────────────────────────────────────────────────────────
  // 规则与 src/core/translation/promptTemplate.ts#validatePromptTemplate 一字
  // 不差（那里是权威实现，这里是设置面板里的即时反馈；tests/unit/ui/
  // preferencesPane.dom.test.ts 用一个样例矩阵把两份实现的判定钉在一起）。
  // 与 maxChars / ODL timeout 同一套路：不挂 preference 属性，读 pref → 校验 →
  // 写 pref，半成品值不落盘；失焦仍非法则恢复当前 pref 值。

  var AI_PROMPT_MAX = 4000;
  var AI_PLACEHOLDERS = ["text", "sourceLang", "targetLang"];

  /** 与 TS 版同序的七种非法原因 → 隐藏本地化节点 id 后缀。 */
  var AI_PROMPT_STRING_IDS = {
    "too-long": "wenxianyidu-pref-string-ai-prompt-too-long",
    "unknown-placeholder": "wenxianyidu-pref-string-ai-prompt-unknown-placeholder",
    "missing-text": "wenxianyidu-pref-string-ai-prompt-missing-text",
    "duplicate-text": "wenxianyidu-pref-string-ai-prompt-duplicate-text",
    "missing-source-lang": "wenxianyidu-pref-string-ai-prompt-missing-source-lang",
    "missing-target-lang": "wenxianyidu-pref-string-ai-prompt-missing-target-lang",
    "unbalanced-braces": "wenxianyidu-pref-string-ai-prompt-unbalanced-braces",
  };

  /** @returns {{ok: boolean, reason: string}} reason 为空表示合法。 */
  function checkAIPrompt(raw) {
    var template =
      raw === null || raw === undefined ? "" : String(raw).replace(/^\s+|\s+$/g, "");
    if (template === "") return { ok: true, reason: "" };
    if (template.length > AI_PROMPT_MAX) return { ok: false, reason: "too-long" };

    var names = [];
    var scan = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
    var m;
    while ((m = scan.exec(template)) !== null) names.push(m[1]);
    for (var i = 0; i < names.length; i++) {
      // 拼错的占位符要先报「未知占位符」：{{txt}} 同时触犯两条规则，而这条才
      // 是用户能直接改的那条（与 TS 版同序）。
      if (AI_PLACEHOLDERS.indexOf(names[i]) < 0) {
        return { ok: false, reason: "unknown-placeholder" };
      }
    }
    var residual = template.replace(/\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\}/g, "");
    // 不成对的花括号排在「缺失占位符」之前：半成品的 {{text} 同时也丢了
    // {{text}}，而「花括号落单」才是用户能直接改的那个说法（与 TS 版同序）。
    if (residual.indexOf("{{") >= 0 || residual.indexOf("}}") >= 0) {
      return { ok: false, reason: "unbalanced-braces" };
    }
    function count(name) {
      var c = 0;
      for (var i = 0; i < names.length; i++) if (names[i] === name) c++;
      return c;
    }
    if (count("text") === 0) return { ok: false, reason: "missing-text" };
    if (count("text") > 1) return { ok: false, reason: "duplicate-text" };
    if (count("sourceLang") === 0) {
      return { ok: false, reason: "missing-source-lang" };
    }
    if (count("targetLang") === 0) {
      return { ok: false, reason: "missing-target-lang" };
    }
    return { ok: true, reason: "" };
  }

  function setAIPromptError(reason) {
    var errorEl = els.aiPromptError;
    if (!errorEl) return;
    if (!reason) {
      show(errorEl, false);
      if (els.aiPromptInput) {
        try {
          els.aiPromptInput.removeAttribute("aria-invalid");
        } catch (e) {
          /* 忽略 */
        }
      }
      return;
    }
    // 文案从隐藏的本地化节点取，JS 不写死任何字符串（与 pdftranslate 标签同款）。
    var source = AI_PROMPT_STRING_IDS[reason]
      ? $(AI_PROMPT_STRING_IDS[reason])
      : null;
    if (source && source.textContent) errorEl.textContent = source.textContent;
    show(errorEl, true);
    if (els.aiPromptInput) {
      try {
        els.aiPromptInput.setAttribute("aria-invalid", "true");
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  function readPromptInput() {
    if (!els.aiPromptInput) return "";
    var v;
    try {
      v = els.aiPromptInput.value;
    } catch (e) {
      v = undefined;
    }
    // XUL textbox 有 value；非 XUL 渲染（测试台）退回 textContent。
    if (v === undefined || v === null) v = els.aiPromptInput.textContent;
    return v === undefined || v === null ? "" : String(v);
  }

  function writePromptInput(text) {
    if (!els.aiPromptInput) return;
    try {
      els.aiPromptInput.value = text;
    } catch (e) {
      /* 忽略 */
    }
    if (els.aiPromptInput.value !== text) els.aiPromptInput.textContent = text;
  }

  function onAIPromptInput() {
    if (!els.aiPromptInput) return;
    var check = checkAIPrompt(readPromptInput());
    if (check.ok) {
      setAIPromptError("");
      setPref("translate.ai.prompt", readPromptInput());
      return;
    }
    // 半成品值只提示，不写 pref（与 maxChars 同一策略）。
    setAIPromptError(check.reason);
  }

  function onAIPromptChange() {
    if (!els.aiPromptInput) return;
    var check = checkAIPrompt(readPromptInput());
    if (check.ok) {
      setAIPromptError("");
      setPref("translate.ai.prompt", readPromptInput());
      return;
    }
    // 失焦仍非法：恢复为当前 pref 值且不写 pref。
    writePromptInput(String(getPref("translate.ai.prompt") || ""));
    setAIPromptError("");
  }

  /** 「恢复默认模板」按钮：写空串即内置默认模板。 */
  function restoreDefaultPrompt() {
    setPref("translate.ai.prompt", "");
    writePromptInput("");
    setAIPromptError("");
  }

  // ── pdfParser.opendataloader.timeout ─────────────────────────────────────
  // 与 maxChars 同一套路：INT pref 不能写半成品值，所以这个输入框不挂
  // preference 属性，由本脚本读 pref、校验后再写。
  // 取值范围与 addon/prefs.js 的默认值（300 秒）对齐。

  var TIMEOUT_MIN = 30;
  var TIMEOUT_MAX = 3600;
  var TIMEOUT_DEFAULT = 300;

  function readTimeout() {
    var raw = getPref("pdfParser.opendataloader.timeout");
    var n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    if (!isFinite(n) || isNaN(n)) return TIMEOUT_DEFAULT;
    return Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, Math.round(n)));
  }

  function setTimeoutError(visible) {
    show(els.timeoutError, visible);
    if (els.timeoutInput) {
      try {
        if (visible) els.timeoutInput.setAttribute("aria-invalid", "true");
        else els.timeoutInput.removeAttribute("aria-invalid");
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  /** 解析输入框内容；合法返回整数，否则返回 null。 */
  function parseTimeout(raw) {
    if (raw === null || raw === undefined) return null;
    var text = String(raw).trim();
    if (text === "") return null;
    if (!/^\d+$/.test(text)) return null;
    var n = parseInt(text, 10);
    if (!isFinite(n)) return null;
    if (n < TIMEOUT_MIN || n > TIMEOUT_MAX) return null;
    return n;
  }

  function onTimeoutInput() {
    if (!els.timeoutInput) return;
    var n = parseTimeout(els.timeoutInput.value);
    if (n === null) {
      setTimeoutError(true);
      return;
    }
    setTimeoutError(false);
    setPref("pdfParser.opendataloader.timeout", n);
  }

  function onTimeoutChange() {
    if (!els.timeoutInput) return;
    var n = parseTimeout(els.timeoutInput.value);
    if (n !== null) {
      setTimeoutError(false);
      setPref("pdfParser.opendataloader.timeout", n);
      return;
    }
    // 与 maxChars 同一策略：非法值一律恢复为当前 pref 值且不写 pref。
    els.timeoutInput.value = String(readTimeout());
    setTimeoutError(false);
  }

  // ── 引擎字段组显隐 ──────────────────────────────────────────────────────

  function syncEngineFields() {
    var engine = "";
    if (els.engineList) {
      try {
        engine = String(els.engineList.value || "");
      } catch (e) {
        engine = "";
      }
    }
    if (!engine) engine = String(getPref("translate.engineType") || "youdao");

    ENGINE_GROUPS.forEach(function (pair) {
      var el = $(pair[1]);
      if (el) show(el, pair[0] === engine);
    });
    show($("wenxianyidu-pref-traditional-prompt-note"), engine !== "ai" && engine !== "custom");
  }

  function addonBridge() {
    return Zotero.WenxianYidu || (Zotero.getMainWindow && Zotero.getMainWindow().Zotero.WenxianYidu);
  }

  function credentialStatus(text) {
    var target = $("wenxianyidu-pref-secret-status");
    if (target) target.textContent = text;
  }

  function bindSecureCredentials() {
    var root = $("zotero-prefpane-wenxianyidu");
    if (!root) return;
    var bridge;
    try { bridge = addonBridge(); } catch (_) { /* unavailable */ }
    var fields = root.querySelectorAll("[data-secret-pref]");
    Array.from(fields).forEach(function (field) {
      var key = field.getAttribute("data-secret-pref");
      try { field.value = bridge && bridge.credentials ? bridge.credentials.get(key) || "" : ""; } catch (_) {
        field.value = ""; field.disabled = true; field._credentialReadFailed = true;
        credentialStatus("无法读取本机安全存储，请解锁密码管理器后重新打开设置。已有密钥不会被清除。");
      }
      if (!bridge || !bridge.credentials) {
        field.disabled = true;
        credentialStatus("安全存储尚未就绪，请重新启用插件或重启 Zotero。不会将密钥写入普通设置。");
        return;
      }
      field.addEventListener("change", function () {
        field._credentialSave = bridge.credentials.set(key, field.value).then(function () {
          credentialStatus("凭据已保存到本机安全存储。");
        }).catch(function () {
          credentialStatus("凭据保存失败，请检查系统安全存储后重试。密钥未写入普通设置。");
          throw new Error("Credential storage unavailable");
        });
        field._credentialSave.catch(function () {});
      });
    });
  }

  function saveEndpoint(field) {
    var raw = String(field.value || "").trim();
    try {
      if (raw) {
        var endpoint = new URL(raw);
        if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].indexOf(endpoint.hostname) !== -1)) throw new Error("远程 AI 接口必须使用 HTTPS；本机模型可使用 localhost HTTP。");
        if (endpoint.username || endpoint.password || Array.from(endpoint.searchParams.keys()).some(function (key) { return /^(?:key|api[-_]?key|token|access[-_]?token|secret|password|sign)$/i.test(key); })) throw new Error("请将密钥填写在 API Key 字段，不要放入接口地址。");
      }
      field.removeAttribute("aria-invalid");
      setPref(field.getAttribute("data-endpoint-pref"), raw);
      return true;
    } catch (error) {
      field.setAttribute("aria-invalid", "true");
      credentialStatus(String(error.message || "请输入有效的接口地址。"));
      return false;
    }
  }

  function bindEndpointFields() {
    var root = $("zotero-prefpane-wenxianyidu");
    if (!root) return;
    Array.from(root.querySelectorAll("[data-endpoint-pref]")).forEach(function (field) {
      field.value = String(getPref(field.getAttribute("data-endpoint-pref")) || "");
      field.addEventListener("change", function () { saveEndpoint(field); });
    });
  }

  async function flushSecureCredentials(engine) {
    var bridge = addonBridge();
    if (!bridge || !bridge.credentials) throw new Error("安全存储未就绪，请重启 Zotero 后重试。");
    var root = $("zotero-prefpane-wenxianyidu");
    var prefix = {
      "google": "translate.google.", "bing": "translate.bing.", "deepl": "translate.deepl.",
      "ai": "translate.ai.", "custom": "translate.custom.", "niutrans": "translate.niutrans.",
      "youdao-official": "translate.youdaoOfficial."
    }[engine];
    var fields = root && prefix ? Array.from(root.querySelectorAll("[data-secret-pref]")).filter(function (field) {
      return field.getAttribute("data-secret-pref").indexOf(prefix) === 0;
    }) : [];
    await Promise.all(fields.map(function (field) {
      if (field._credentialReadFailed) throw new Error("无法读取本机安全存储，请重新打开设置后重试。");
      return bridge.credentials.set(field.getAttribute("data-secret-pref"), String(field.value || ""));
    }));
  }

  async function testConnection() {
    var button = $("wenxianyidu-pref-test-connection");
    var status = $("wenxianyidu-pref-connection-status");
    var selectedEngine = String(els.engineList && els.engineList.value || getPref("translate.engineType") || "youdao");
    if (button) button.disabled = true;
    if (status) status.textContent = "正在用一条示例句测试当前引擎…";
    try {
      setPref("translate.engineType", selectedEngine);
      var bridge = addonBridge();
      if (!bridge || !bridge.translation) throw new Error("翻译模块未就绪，请重启 Zotero 后重试。");
      var endpointField = selectedEngine === "ai" ? $("wenxianyidu-pref-ai-url") : selectedEngine === "custom" ? $("wenxianyidu-pref-custom-url") : null;
      if (endpointField && !saveEndpoint(endpointField)) throw new Error("请先修正接口地址；密钥应填写在 API Key 字段。");
      // Keyless engines need no credentials and remain usable if the OS store is unavailable.
      if (["youdao", "bing-web", "zotero-pdf-translate", "mtranserver"].indexOf(selectedEngine) === -1) await flushSecureCredentials(selectedEngine);
      if (els.aiPromptInput && selectedEngine === "ai") {
        var check = checkAIPrompt(readPromptInput());
        if (!check.ok) throw new Error("请先修正提示词模板，再测试连接。");
        setPref("translate.ai.prompt", readPromptInput());
      }
      var result = await bridge.translation.testConnection();
      if (String(getPref("translate.engineType")) !== selectedEngine) return;
      if (status) status.textContent = result.success ? "连接成功：" + String(result.text || "已返回译文") : "测试失败：" + String(result.error || "服务未返回结果");
    } catch (error) {
      // The engine bridge redacts provider errors; storage errors never include credentials.
      if (status) status.textContent = "测试失败：" + String(error.message || "请检查引擎配置");
    } finally { if (button) button.disabled = false; }
  }

  function bindOfflinePreparation() {
    var start = $("wenxianyidu-offline-start"), cancel = $("wenxianyidu-offline-cancel"), status = $("wenxianyidu-offline-status");
    var api = addonBridge() && addonBridge().offline;
    if (!start || !api) return;
    var disposed = false, updates = 0;
    var meter = $("wenxianyidu-offline-progress");
    function display(phase, percent, snapshot) {
      if (disposed) return;
      var active = snapshot ? snapshot.active : ["missing", "ready", "failed", "cancelled"].indexOf(phase) === -1;
      start.disabled = active; cancel.disabled = !active || phase === "cancelling";
      status.textContent = javaString("wenxianyidu-pref-offline-phase-" + phase) + (typeof percent === "number" ? " (" + percent + "%)" : "") + (snapshot && snapshot.error ? " · " + snapshot.error : "");
      if (meter) { meter.hidden = !active; if (typeof percent === "number") meter.value = percent; else meter.removeAttribute("value"); }
    }
    var unsubscribe = api.subscribe(function (phase, percent, snapshot) { updates++; display(phase, percent, snapshot); });
    var initialUpdates = updates;
    api.getStatus().then(function (s) { if (initialUpdates === updates) display(s.phase, s.percent, s); }).catch(function () { if (initialUpdates === updates) display("failed"); });
    start.addEventListener("command", async function () {
      start.disabled = true; cancel.disabled = false;
      try { await api.prepare(); }
      catch (error) { /* Shared status retains cancellation or the failure reason. */ }
    });
    cancel.addEventListener("command", function () { api.cancel(); });
    window.addEventListener("unload", function () { disposed = true; unsubscribe(); });
  }

  function bindModelLists() {
    ["ai", "custom"].forEach(function (engine) {
      var model = $("wenxianyidu-pref-" + engine + "-model");
      var endpoint = $("wenxianyidu-pref-" + engine + "-url");
      var key = $("wenxianyidu-pref-" + engine + "-key");
      var button = $("wenxianyidu-pref-" + engine + "-models-fetch");
      var search = $("wenxianyidu-pref-" + engine + "-models-search");
      var list = $("wenxianyidu-pref-" + engine + "-models-list");
      var status = $("wenxianyidu-pref-" + engine + "-models-status");
      if (!button || !model || !list || !search) return;
      var ids = [], generation = 0, controller;
      function render() {
        list.replaceChildren();
        ids.filter(function (id) { return id.toLowerCase().indexOf(search.value.toLowerCase()) !== -1; }).forEach(function (id) {
          var option = document.createElementNS("http://www.w3.org/1999/xhtml", "option"); option.value = id; option.textContent = id; list.appendChild(option);
        });
        list.selectedIndex = -1;
      }
      function invalidate() { generation++; if (controller) controller.abort(); button.disabled = false; ids = []; render(); search.hidden = true; list.hidden = true; status.textContent = ""; }
      [endpoint, key].forEach(function (field) { if (field) field.addEventListener("input", invalidate); });
      button.addEventListener("command", async function () {
        if (controller) controller.abort();
        controller = new AbortController();
        var request = ++generation;
        button.disabled = true; status.textContent = javaString("wenxianyidu-pref-models-loading");
        try {
          var bridge = addonBridge();
          ids = await bridge.translation.listModels({ engine: engine, apiUrl: String(endpoint.value || ""), apiKey: String(key.value || ""), signal: controller.signal });
          if (request !== generation) return;
          render(); search.hidden = false; list.hidden = false;
          status.textContent = javaString("wenxianyidu-pref-models-ready");
        } catch (error) { if (request === generation) status.textContent = javaString("wenxianyidu-pref-models-failed") + " " + (error.name === "AbortError" ? javaString("wenxianyidu-pref-models-timeout") : String(error.message || "")); }
        finally { if (request === generation) button.disabled = false; }
      });
      search.addEventListener("input", render);
      list.addEventListener("change", function () { if (!list.value) return; model.value = list.value; setPref("translate." + engine + ".model", list.value); });
      window.addEventListener("unload", function () { generation++; if (controller) controller.abort(); });
    });
  }

  function applyAIPreset(event) {
    var preset = String(event.target.value || "custom");
    if (preset === "custom") return;
    var url = preset === "deepseek" ? "https://api.deepseek.com/chat/completions" : "http://127.0.0.1:11434/v1";
    var model = preset === "deepseek" ? "deepseek-flash" : "";
    setPref("translate.ai.apiUrl", url); setPref("translate.ai.model", model);
    if ($("wenxianyidu-pref-ai-url")) $("wenxianyidu-pref-ai-url").value = url;
    if ($("wenxianyidu-pref-ai-model")) $("wenxianyidu-pref-ai-model").value = model;
    // A preset changes the destination: never reuse another provider's key.
    var keyInput = $("wenxianyidu-pref-ai-key");
    if (keyInput) keyInput.value = "";
    try { var bridge = addonBridge(); if (bridge && bridge.credentials) bridge.credentials.clear("translate.ai.apiKey").catch(function () { credentialStatus("无法清除原接口密钥，请先检查安全存储。"); }); } catch (_) { /* an empty UI field is retained */ }
    credentialStatus(preset === "local" ? "请填写本机实际已安装的模型名称。已清空原接口密钥，本地模型通常无需密钥。" : "已填入 DeepSeek 地址和模型，请粘贴属于该平台的 API Key。原接口密钥已清空。");
  }

  function previewPrompt() {
    var target = $("wenxianyidu-pref-ai-preview-result"); if (!target) return;
    var bridge; try { bridge = addonBridge(); } catch (_) { /* no bridge */ }
    var prompt = readPromptInput() || (bridge && bridge.translation && bridge.translation.getDefaultPrompt());
    if (!prompt) { target.textContent = "默认模板尚未载入，请重启插件后重试。"; show(target, true); return; }
    target.textContent = String(prompt).replace(/\{\{text\}\}/g, "This study evaluates the accuracy of machine translation.").replace(/\{\{sourceLang\}\}/g, "English").replace(/\{\{targetLang\}\}/g, "Simplified Chinese");
    show(target, true);
  }

  function openHelp(event) {
    event.preventDefault();
    var href = event.currentTarget.getAttribute("href");
    if (href && /^https:\/\//.test(href)) Zotero.launchURL(href);
  }

  function toggleAdvancedEngines(event) {
    var selected = String(getPref("translate.engineType") || "youdao");
    var advanced = ["google", "bing", "deepl", "custom", "zotero-pdf-translate"];
    var visible = !!event.target.checked || advanced.indexOf(selected) !== -1;
    var root = $("zotero-prefpane-wenxianyidu");
    if (root) Array.from(root.querySelectorAll(".wenxianyidu-advanced-engine")).forEach(function (item) { show(item, visible); });
  }

  function simplifyLayout() {
    var root = $("zotero-prefpane-wenxianyidu");
    if (!root) return;
    var engineGroup = $("wenxianyidu-pref-group-engine");
    var general = $("wenxianyidu-pref-group-general");
    var pdf = $("wenxianyidu-pref-group-pdf");
    var container = engineGroup && engineGroup.parentNode;
    if (!container) return;
    [[general, "高级阅读选项"], [pdf, "全文处理组件（首次自动准备）"]].forEach(function (pair) {
      var group = pair[0]; if (!group || group.parentNode && group.parentNode.localName === "details") return;
      var details = document.createElementNS("http://www.w3.org/1999/xhtml", "details");
      var summary = document.createElementNS("http://www.w3.org/1999/xhtml", "summary"); summary.textContent = pair[1]; details.appendChild(summary); details.appendChild(group); container.appendChild(details);
    });
    // Region selection should never silently change the chosen service.
    var region = $("wenxianyidu-pref-region");
    if (region) {
      var regionRow = region.closest("hbox");
      if (regionRow) { regionRow.hidden = true; if (regionRow.nextElementSibling) regionRow.nextElementSibling.hidden = true; }
    }
  }

  // ── 网络区域 ────────────────────────────────────────────────────────────

  // 推荐值表必须与 src/utils/region.ts 保持一字不差：面板脚本运行在独立
  // 沙箱里，无法 import 主包，只能镜像这份小表（与 ASSETS_SUBDIR 同一约定）。
  var REGION_PROFILES = {
    global: { engine: "google", bingRegion: "global" },
    cn: { engine: "bing-web", bingRegion: "chinanorth" },
  };
  // 出厂默认值（addon/prefs.js 的镜像）。推荐值只覆盖仍等于这些值的键。
  var REGION_SHIPPED_DEFAULTS = {
    "translate.engineType": "google",
    "translate.bing.region": "",
  };
  var REGION_RECOMMENDED_KEYS = [
    "translate.engineType",
    "translate.bing.region",
  ];

  function regionRecommendation(region, key) {
    var profile = REGION_PROFILES[region];
    if (!profile) return REGION_SHIPPED_DEFAULTS[key];
    return key === "translate.engineType" ? profile.engine : profile.bingRegion;
  }

  /**
   * 套用区域推荐值，返回实际写入的键。守门与 src/utils/region.ts 一致：
   * 只有当前值仍等于出厂默认的键才会被改写——用户显式选过的引擎不被推翻。
   */
  function applyRegionRecommendations(region) {
    var written = [];
    if (!REGION_PROFILES[region]) return written;
    REGION_RECOMMENDED_KEYS.forEach(function (key) {
      var current = getPref(key);
      var currentText =
        current === undefined || current === null ? "" : String(current);
      if (currentText !== REGION_SHIPPED_DEFAULTS[key]) return;
      var next = regionRecommendation(region, key);
      if (currentText === next) return;
      setPref(key, next);
      written.push(key);
    });
    return written;
  }

  /** 应用提示：文案从 xhtml 里隐藏的本地化节点搬运，JS 不写死任何字符串。 */
  function showRegionNote(written) {
    var note = els.regionNote;
    if (!note) return;
    var source = $(written.length
      ? "wenxianyidu-pref-region-note-applied"
      : "wenxianyidu-pref-region-note-nochange");
    if (source && source.textContent) note.textContent = source.textContent;
    show(note, Boolean(source && source.textContent));
  }

  function onRegionPicked() {
    var region = "auto";
    if (els.regionList) {
      try {
        region = String(els.regionList.value || "auto");
      } catch (e) {
        region = "auto";
      }
    }
    var written = applyRegionRecommendations(region);
    // 推荐值可能改写了引擎：让引擎下拉与字段分组立即跟上（Zotero 的
    // preference 反向同步时机不保证，这里显式回读 pref）。
    if (written.indexOf("translate.engineType") !== -1 && els.engineList) {
      try {
        els.engineList.value = String(getPref("translate.engineType") || "");
      } catch (e) {
        /* 忽略：下拉值同步失败只影响回显，不影响已写入的 pref */
      }
    }
    syncEngineFields();
    showRegionNote(written);
  }

  // ── zotero-pdf-translate 探测 ───────────────────────────────────────────

  /**
   * 与 src/core/translation/featureReadiness.ts#hasPDFTranslatePlugin 同一判据：
   * Zotero.PDFTranslate.api.translate 存在才算装好。任何宿主差异都不能抛异常。
   */
  function hasPDFTranslate() {
    try {
      if (typeof Zotero === "undefined" || !Zotero) return false;
      var api = Zotero.PDFTranslate && Zotero.PDFTranslate.api;
      return Boolean(api && typeof api.translate === "function");
    } catch (e) {
      return false;
    }
  }

  function syncPDFTranslateStatus() {
    var installed = hasPDFTranslate();
    show($("wenxianyidu-pref-pdftranslate-installed"), installed);
    show($("wenxianyidu-pref-pdftranslate-missing"), !installed);

    // 下拉项标签同步：没装插件时标注「（未安装）」，装了就恢复原标签。
    // 文案来自 xhtml 里那个隐藏的本地化节点（Fluent 在 load 之前就翻译完了），
    // JS 不写死任何字符串。
    var item = els.pdfTranslateItem;
    if (item) {
      var label = installed ? pdfTranslateLabels.base : pdfTranslateLabels.missing;
      if (label) item.setAttribute("label", label);
    }
  }

  // ── 字体覆盖目录 ────────────────────────────────────────────────────────

  // 数据目录占位文案：来自 xhtml 里隐藏的本地化节点（英文界面显示英文），
  // JS 不写死任何字符串。
  var dataDirPlaceholder = "{Data directory}";

  function assetsDir() {
    var dir = "";
    try {
      dir = (Zotero.DataDirectory && Zotero.DataDirectory.dir) || "";
    } catch (e) {
      dir = "";
    }
    if (!dir) return dataDirPlaceholder + "/" + ASSETS_SUBDIR;
    // 统一成正斜杠：Windows 上 DataDirectory.dir 带反斜杠，混排很难读。
    return String(dir).replace(/\\/g, "/") + "/" + ASSETS_SUBDIR;
  }

  // ── 密钥显示/隐藏 ───────────────────────────────────────────────────────

  function toggleKeyVisibility(event) {
    var checkbox = event && event.target ? event.target : null;
    if (!checkbox) return;
    var row = null;
    try {
      row = checkbox.closest ? checkbox.closest(".wenxianyidu-row") : null;
    } catch (e) {
      row = null;
    }
    if (!row) row = checkbox.parentNode;
    if (!row || !row.querySelector) return;
    var input = row.querySelector("input");
    if (!input) return;
    try {
      input.setAttribute("type", checkbox.checked ? "text" : "password");
    } catch (e) {
      /* 忽略 */
    }
  }

  // ── Java 运行库：状态检测 + 安装/修复 ───────────────────────────────────
  // 检测与安装都走主包暴露的 Zotero.WenxianYidu.java（面板脚本运行在独立
  // 沙箱里，无法 import 主包模块——与 REGION_PROFILES 镜像同一约束）。主包
  // 未加载（bundle 失败 / 插件刚重载）时只提示，不把面板搞成假失败。
  // 检测会 spawn 一次 `java -version` 进程（可能数秒），所以只在点击按钮时
  // 执行；面板加载与面板显示都不自动探测，避免打开设置时卡顿。

  var javaStrings = {};
  /** 「安装 / 修复」按钮的原始 label，安装中态结束后恢复。 */
  var javaInstallLabelBase = "";
  var javaCheckInFlight = false;
  var javaInstallInFlight = false;

  function javaApi() {
    try {
      var zt = Zotero && Zotero.WenxianYidu;
      var api = zt && zt.java;
      // 检测与安装按需可用：主包只暴露了其中一半时，另一半单独降级。
      if (
        api &&
        (typeof api.getStatus === "function" ||
          typeof api.install === "function")
      ) {
        return api;
      }
    } catch (e) {
      /* 主包未挂载 */
    }
    return null;
  }

  function javaString(id) {
    var node = $(id);
    return node && node.textContent ? String(node.textContent).trim() : "";
  }

  function setJavaStatusText(text) {
    if (els.javaStatus) els.javaStatus.textContent = text;
  }

  function setJavaButtonsDisabled(disabled) {
    [els.javaCheckBtn, els.javaInstallBtn].forEach(function (btn) {
      if (!btn) return;
      try {
        if (disabled) btn.setAttribute("disabled", "true");
        else btn.removeAttribute("disabled");
      } catch (e) {
        /* 忽略 */
      }
    });
  }

  function setJavaInstallLabel(installing) {
    if (!els.javaInstallBtn) return;
    var label = installing ? javaStrings.btnInstalling : javaInstallLabelBase;
    if (label) {
      try {
        els.javaInstallBtn.setAttribute("label", label);
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  /**
   * 占位符填充。本地化值（Fluent）里写 { $version }，静态回退正文里写
   * {version}，这里对两种写法都替换，文案作者两种都安全。
   */
  function fillJavaTemplate(text, vars) {
    var out = String(text || "");
    Object.keys(vars || {}).forEach(function (key) {
      var value = String(vars[key]);
      out = out.split("{" + key + "}").join(value);
      out = out.split("{ $" + key + " }").join(value);
      out = out.split("{$" + key + "}").join(value);
    });
    return out;
  }

  /** 读取 getStatus() 的结果并回显到状态行。 */
  function refreshJavaStatus() {
    var api = javaApi();
    if (!api || typeof api.getStatus !== "function") {
      setJavaStatusText(javaStrings.nobundle);
      return Promise.resolve();
    }
    setJavaStatusText(javaStrings.checking);
    return Promise.resolve()
      .then(function () {
        return api.getStatus();
      })
      .then(function (status) {
        if (status && status.ready) {
          setJavaStatusText(
            fillJavaTemplate(
              status.managed ? javaStrings.readyManaged : javaStrings.readySystem,
              { version: (status && status.version) || "?" },
            ),
          );
        } else {
          // 探测失败的原因串多为英文 JVM 输出，不上墙；通用文案引导下一步。
          setJavaStatusText(javaStrings.missing);
        }
      })
      .catch(function (e) {
        setJavaStatusText(
          fillJavaTemplate(javaStrings.statusError, {
            detail: String((e && e.message) || e),
          }),
        );
      });
  }

  function onJavaCheck() {
    if (javaCheckInFlight) return;
    javaCheckInFlight = true;
    var done = function () {
      javaCheckInFlight = false;
    };
    refreshJavaStatus().then(done, done);
  }

  function onJavaInstall() {
    if (javaInstallInFlight) return;
    var api = javaApi();
    if (!api || typeof api.install !== "function") {
      setJavaStatusText(javaStrings.nobundle);
      return;
    }
    javaInstallInFlight = true;
    setJavaButtonsDisabled(true);
    setJavaInstallLabel(true);
    setJavaStatusText(javaStrings.statusInstalling);
    // 安装在主包内执行（ProgressWindow 显示在主窗口）；无论成败这里都恢复
    // 按钮并重新检测，失败时状态行回到「未检测到」引导重试，主窗口另有无
    // 障碍的失败说明与手动下载页。
    Promise.resolve()
      .then(function () {
        return api.install();
      })
      .catch(function (e) {
        try {
          Zotero.debug(
            "[文献译读] preferences: java install failed: " + e,
          );
        } catch (e2) {
          /* 忽略 */
        }
        return false;
      })
      .then(function () {
        javaInstallInFlight = false;
        setJavaButtonsDisabled(false);
        setJavaInstallLabel(false);
        return refreshJavaStatus();
      });
  }

  function cacheJavaStrings() {
    javaStrings.btnInstalling = javaString(
      "wenxianyidu-pref-string-java-btn-installing",
    );
    javaStrings.checking = javaString(
      "wenxianyidu-pref-string-java-status-checking",
    );
    javaStrings.statusInstalling = javaString(
      "wenxianyidu-pref-string-java-status-installing",
    );
    javaStrings.readyManaged = javaString(
      "wenxianyidu-pref-string-java-status-ready-managed",
    );
    javaStrings.readySystem = javaString(
      "wenxianyidu-pref-string-java-status-ready-system",
    );
    javaStrings.missing = javaString(
      "wenxianyidu-pref-string-java-status-missing",
    );
    javaStrings.statusError = javaString(
      "wenxianyidu-pref-string-java-status-error",
    );
    javaStrings.nobundle = javaString(
      "wenxianyidu-pref-string-java-status-nobundle",
    );
    javaInstallLabelBase = els.javaInstallBtn
      ? els.javaInstallBtn.getAttribute("label") || ""
      : "";
  }

  // ── 解析组件：状态检测 + 下载/修复 ─────────────────────────────────────
  // 与 Java 运行库小节同一套路：检测与下载走主包暴露的 Zotero.WenxianYidu.odlJar
  // （面板沙箱无法 import 主包模块）。检测只读磁盘（对约 24MB 组件做一次哈希
  // 核对，亚秒级），同样只在点击按钮时执行。下载失败后主包在会话内不再自动
  // 重试，这个按钮是唯一的手动重试入口，因此失败时把错误细节直接上墙。

  var odlStrings = {};
  /** 「下载 / 修复」按钮的原始 label，下载中态结束后恢复。 */
  var odlDownloadLabelBase = "";
  var odlCheckInFlight = false;
  var odlDownloadInFlight = false;

  function odlApi() {
    try {
      var zt = Zotero && Zotero.WenxianYidu;
      var api = zt && zt.odlJar;
      if (
        api &&
        (typeof api.getStatus === "function" ||
          typeof api.install === "function")
      ) {
        return api;
      }
    } catch (e) {
      /* 主包未挂载 */
    }
    return null;
  }

  function setOdlStatusText(text) {
    if (els.odlStatus) els.odlStatus.textContent = text;
  }

  function setOdlButtonsDisabled(disabled) {
    [els.odlCheckBtn, els.odlDownloadBtn].forEach(function (btn) {
      if (!btn) return;
      try {
        if (disabled) btn.setAttribute("disabled", "true");
        else btn.removeAttribute("disabled");
      } catch (e) {
        /* 忽略 */
      }
    });
  }

  function setOdlDownloadLabel(downloading) {
    if (!els.odlDownloadBtn) return;
    var label = downloading ? odlStrings.btnDownloading : odlDownloadLabelBase;
    if (label) {
      try {
        els.odlDownloadBtn.setAttribute("label", label);
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  /** 读取 getStatus() 的结果并回显到状态行。 */
  function refreshOdlStatus() {
    var api = odlApi();
    if (!api || typeof api.getStatus !== "function") {
      setOdlStatusText(odlStrings.nobundle);
      return Promise.resolve();
    }
    setOdlStatusText(odlStrings.checking);
    return Promise.resolve()
      .then(function () {
        return api.getStatus();
      })
      .then(function (status) {
        if (status && status.present) {
          var template =
            status.source === "landed"
              ? odlStrings.readyLanded
              : odlStrings.readyBundled;
          setOdlStatusText(
            fillJavaTemplate(template, {
              version: (status && status.version) || "?",
            }),
          );
        } else {
          // 「缺失」与「副本存在但指纹不符」都引导到下载/修复：后者在下次
          // 解析时也会自动重新获取，按钮只是把修复提前。
          setOdlStatusText(odlStrings.missing);
        }
      })
      .catch(function (e) {
        setOdlStatusText(
          fillJavaTemplate(odlStrings.statusError, {
            detail: String((e && e.message) || e),
          }),
        );
      });
  }

  function onOdlCheck() {
    if (odlCheckInFlight) return;
    odlCheckInFlight = true;
    var done = function () {
      odlCheckInFlight = false;
    };
    refreshOdlStatus().then(done, done);
  }

  function onOdlDownload() {
    if (odlDownloadInFlight) return;
    var api = odlApi();
    if (!api || typeof api.install !== "function") {
      setOdlStatusText(odlStrings.nobundle);
      return;
    }
    odlDownloadInFlight = true;
    setOdlButtonsDisabled(true);
    setOdlDownloadLabel(true);
    setOdlStatusText(odlStrings.statusDownloading);
    // 下载在主包内执行（ProgressWindow 显示在主窗口）；无论成败这里都恢复
    // 按钮。失败时状态行显示错误细节（多为网络原因），不再用缺失引导覆盖。
    Promise.resolve()
      .then(function () {
        return api.install();
      })
      .catch(function (e) {
        try {
          Zotero.debug(
            "[文献译读] preferences: component download failed: " + e,
          );
        } catch (e2) {
          /* 忽略 */
        }
        setOdlStatusText(
          fillJavaTemplate(odlStrings.downloadFailed, {
            detail: String((e && e.message) || e),
          }),
        );
        return null;
      })
      .then(function (failed) {
        odlDownloadInFlight = false;
        setOdlButtonsDisabled(false);
        setOdlDownloadLabel(false);
        if (failed === null) return undefined;
        return refreshOdlStatus();
      });
  }

  function cacheOdlStrings() {
    odlStrings.btnDownloading = javaString(
      "wenxianyidu-pref-string-odl-comp-btn-downloading",
    );
    odlStrings.checking = javaString(
      "wenxianyidu-pref-string-odl-comp-status-checking",
    );
    odlStrings.statusDownloading = javaString(
      "wenxianyidu-pref-string-odl-comp-status-downloading",
    );
    odlStrings.readyLanded = javaString(
      "wenxianyidu-pref-string-odl-comp-status-ready-landed",
    );
    odlStrings.readyBundled = javaString(
      "wenxianyidu-pref-string-odl-comp-status-ready-bundled",
    );
    odlStrings.missing = javaString(
      "wenxianyidu-pref-string-odl-comp-status-missing",
    );
    odlStrings.statusError = javaString(
      "wenxianyidu-pref-string-odl-comp-status-error",
    );
    odlStrings.downloadFailed = javaString(
      "wenxianyidu-pref-string-odl-comp-download-failed",
    );
    odlStrings.nobundle = javaString(
      "wenxianyidu-pref-string-odl-comp-status-nobundle",
    );
    odlDownloadLabelBase = els.odlDownloadBtn
      ? els.odlDownloadBtn.getAttribute("label") || ""
      : "";
  }

  // ── 入口 ────────────────────────────────────────────────────────────────

  function cacheElements() {
    els.maxCharsInput = $("wenxianyidu-pref-maxchars");
    els.maxCharsError = $("wenxianyidu-pref-maxchars-error");
    els.batchTokensInput = $("wenxianyidu-pref-batchtokens");
    els.batchTokensError = $("wenxianyidu-pref-batchtokens-error");
    els.timeoutInput = $("wenxianyidu-pref-odl-timeout");
    els.timeoutError = $("wenxianyidu-pref-odl-timeout-error");
    els.engineList = $("wenxianyidu-pref-engine-type");
    els.regionList = $("wenxianyidu-pref-region");
    els.regionNote = $("wenxianyidu-pref-region-note");
    els.pdfTranslateItem = $("wenxianyidu-pref-engine-item-pdftranslate");
    els.aiPromptInput = $("wenxianyidu-pref-ai-prompt");
    els.aiPromptError = $("wenxianyidu-pref-ai-prompt-error");
    els.javaCheckBtn = $("wenxianyidu-pref-pdf-java-check");
    els.javaInstallBtn = $("wenxianyidu-pref-pdf-java-install");
    els.javaStatus = $("wenxianyidu-pref-pdf-java-status");
    els.odlCheckBtn = $("wenxianyidu-pref-odl-comp-check");
    els.odlDownloadBtn = $("wenxianyidu-pref-odl-comp-download");
    els.odlStatus = $("wenxianyidu-pref-odl-comp-status");

    // Zotero 在派发 load 之前已经跑完 document.l10n.translateFragment()，
    // 所以这里读到的 label / textContent 已经是本地化后的文案。
    if (els.pdfTranslateItem) {
      pdfTranslateLabels.base = els.pdfTranslateItem.getAttribute("label") || "";
    }
    var missingLabel = $("wenxianyidu-pref-string-pdftranslate-missing");
    if (missingLabel && missingLabel.textContent) {
      pdfTranslateLabels.missing = String(missingLabel.textContent).trim();
    }
    if (!pdfTranslateLabels.missing) {
      // Fluent 没生效时退回 menuitem 自身的静态标签，至少不会出现空项。
      pdfTranslateLabels.missing = pdfTranslateLabels.base;
    }
    var dataDirLabel = $("wenxianyidu-pref-string-datadir");
    if (dataDirLabel && dataDirLabel.textContent) {
      dataDirPlaceholder = String(dataDirLabel.textContent).trim();
    }
  }

  function bindEvents() {
    if (els.maxCharsInput) {
      els.maxCharsInput.addEventListener("input", onMaxCharsInput);
      // change 在失焦/回车时触发：合法值写 pref，非法值恢复为当前 pref 值。
      els.maxCharsInput.addEventListener("change", onMaxCharsChange);
    }
    if (els.batchTokensInput) {
      els.batchTokensInput.addEventListener("input", onBatchTokensInput);
      els.batchTokensInput.addEventListener("change", onBatchTokensChange);
    }
    if (els.timeoutInput) {
      els.timeoutInput.addEventListener("input", onTimeoutInput);
      els.timeoutInput.addEventListener("change", onTimeoutChange);
    }
    if (els.aiPromptInput) {
      els.aiPromptInput.addEventListener("input", onAIPromptInput);
      els.aiPromptInput.addEventListener("change", onAIPromptChange);
    }
    if (els.engineList) {
      // XUL menulist 选中项变化主要抛 select；command 在某些平台上也会抛，
      // 两个都听，syncEngineFields 是幂等的，重复执行没有副作用。
      els.engineList.addEventListener("select", syncEngineFields);
      els.engineList.addEventListener("command", function () { confirmEngine(); syncEngineFields(); });
    }
    if (els.regionList) {
      // 与引擎下拉同理两个事件都听；onRegionPicked 幂等（重复套用第二次
      // 起不再有键可写）。
      els.regionList.addEventListener("select", onRegionPicked);
      els.regionList.addEventListener("command", onRegionPicked);
    }
    if (els.javaCheckBtn) {
      // XUL button 的激活事件是 command。
      els.javaCheckBtn.addEventListener("command", onJavaCheck);
    }
    if (els.javaInstallBtn) {
      els.javaInstallBtn.addEventListener("command", onJavaInstall);
    }
    if (els.odlCheckBtn) {
      els.odlCheckBtn.addEventListener("command", onOdlCheck);
    }
    if (els.odlDownloadBtn) {
      els.odlDownloadBtn.addEventListener("command", onOdlDownload);
    }
    // 面板每次显示时重新探测：用户可能开着设置窗口去装了 zotero-pdf-translate。
    var root = $("zotero-prefpane-wenxianyidu");
    if (root) root.addEventListener("showing", syncPDFTranslateStatus);
  }

  function onLoad() {
    try {
      cacheElements();
      bindEvents();

      if (els.maxCharsInput) {
        // 这个输入框不挂 preference 属性：空串会让 Zotero 的整型 pref 写入抛
        // 异常，所以由本脚本读 pref、校验后再写。
        els.maxCharsInput.value = String(readMaxChars());
      }
      setMaxCharsError(false);

      if (els.batchTokensInput) {
        // 同 maxChars：INT pref 由本脚本读 pref、校验后再写。
        els.batchTokensInput.value = String(readBatchTokens());
      }
      setBatchTokensError(false);

      if (els.timeoutInput) {
        // 同上：pdfParser.opendataloader.timeout 也是 INT pref。
        els.timeoutInput.value = String(readTimeout());
      }
      setTimeoutError(false);

      // prompt 模板：空值 = 内置默认模板，所以输入框留空是合法初始态。
      if (els.aiPromptInput) {
        writePromptInput(String(getPref("translate.ai.prompt") || ""));
      }
      setAIPromptError("");

      syncEngineFields();
      bindSecureCredentials();
      bindEndpointFields();
      bindModelLists();
      bindOfflinePreparation();
      simplifyLayout();
      toggleAdvancedEngines({ target: $("wenxianyidu-pref-show-advanced-engines") || {} });
      syncPDFTranslateStatus();

      cacheJavaStrings();
      cacheOdlStrings();

      var path = $("wenxianyidu-pref-pdf-fonts-path");
      if (path) path.textContent = assetsDir();
    } catch (e) {
      Zotero.debug("[文献译读] preferences: onLoad failed: " + e);
    }
  }

  // xhtml 里的 oncommand 在 window 作用域求值，必须挂到 window 上。
  window.WenxianYiduPrefs = {
    confirmEngine: confirmEngine,
    onLoad: onLoad,
    toggleKeyVisibility: toggleKeyVisibility,
    restoreDefaultPrompt: restoreDefaultPrompt,
    testConnection: testConnection,
    applyAIPreset: applyAIPreset,
    previewPrompt: previewPrompt,
    toggleAdvancedEngines: toggleAdvancedEngines,
    openHelp: openHelp,
  };
  function confirmEngine() {
    var selected = String(els.engineList && els.engineList.value || getPref("translate.engineType") || "bing-web");
    setPref("translate.engineType", selected);
    setPref("translate.engineConfirmed", true);
    var status = $("wenxianyidu-pref-connection-status");
    if (status) status.textContent = selected === "mtranserver" ? "已选择离线引擎，请先点击“准备离线翻译”，就绪后返回论文翻译。" : "已选择当前引擎，可返回论文翻译；自有接口建议先测试连接。";
  }
})();

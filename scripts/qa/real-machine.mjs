/**
 * real-machine.mjs — real-machine (实机) test launcher for z-transplit.
 *
 * Spawns a genuine, unmodified Zotero 10 with:
 *   - an isolated profile + data directory (never touches the user's library),
 *   - the built addon installed as a proxy addon (the same pattern
 *     `zotero-plugin serve` uses),
 *   - a QA driver addon that runs handlers with full chrome privileges.
 *
 * Commands are sent by writing D:\zt-qa\command.json; results land in
 * D:\zt-qa\result.json.
 *
 * Usage:
 *   node scripts/qa/real-machine.mjs boot                  # boot & wait until ready
 *   node scripts/qa/real-machine.mjs send <action> [arg]   # send a command
 *   node scripts/qa/real-machine.mjs shoot                 # close Zotero
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { ownsInstance, assertInsideQa } from "./instance-safety.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const QA_ROOT = path.join(ROOT, ".qa");
const PROBE_ID = "wenxianyidu-qa-probe@zotero.org";
const ADDON_ID = "wenxianyidu@wenxianyidu.local";
const ZOTERO_BIN = process.env.ZOTERO_BIN || "D:\\software\\Zetero\\zotero.exe";

const cmdDir = QA_ROOT;
const readyFile = path.join(cmdDir, "probe-ready.json");
const cmdFile = path.join(cmdDir, "command.json");
const resultFile = path.join(cmdDir, "result.json");
const zoteroLog = path.join(cmdDir, "zotero-stdout.log");
const pidFile = path.join(cmdDir, "qa-zotero.pid");

const profileDir = path.join(cmdDir, "profile");
const dataDir = path.join(cmdDir, "data");
const extensionsDir = path.join(profileDir, "extensions");

function log(...m) {
  console.log("[real-machine]", ...m);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail closed: only the exact executable plus isolated profile may be stopped. */
function stopQaZotero() {
  const ps = `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process -Filter "name='zotero.exe'" | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate) | ConvertTo-Json -Compress`;
  const encoded = Buffer.from(ps,"utf16le").toString("base64");
  const out = execFileSync("powershell.exe", ["-NoProfile","-EncodedCommand",encoded], {encoding:"utf8", timeout:15000, windowsHide:true});
  const parsed = out.trim() ? JSON.parse(out) : [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  for (const row of rows) {
    if (!ownsInstance(row, ZOTERO_BIN, profileDir)) continue;
    try { execFileSync("taskkill.exe", ["/f","/t","/pid",String(row.ProcessId)], {stdio:"ignore", windowsHide:true, timeout:15000}); }
    catch (error) { log("QA instance termination returned:", error.status); }
  }
  rmIfExists(pidFile);
}

function rmIfExists(f) {
  assertInsideQa(QA_ROOT, f);
  // A force-killed Zotero can hold handles for a moment; retry instead of
  // silently leaving a stale profile (a stale extensions.json skips the addon).
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(f, { force: true, recursive: true });
      if (!fs.existsSync(f)) return;
    } catch {
      /* retry */
    }
    sleepSync(500);
  }
  throw new Error("could not remove " + f + " after 10 attempts");
}

function sleepSync(ms) {
  const at = Date.now() + ms;
  // Atomics.wait is the only synchronous sleep that doesn't spin the CPU.
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    while (Date.now() < at) {
      /* spin */
    }
  }
}

/** Proxy-addon file: a text file whose content is the addon source dir. */
function writeProxyAddon(id, sourceDir) {
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(path.join(extensionsDir, id), sourceDir, "utf8");
}

/** Directory install: a real copy at extensions/<id>/ (as a user install is). */
function writeDirAddon(id, sourceDir) {
  const dest = path.join(extensionsDir, id);
  assertInsideQa(QA_ROOT, dest);
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(sourceDir, dest, { recursive: true });
}

/**
 * Build the addon-under-test: a copy of the build output whose bootstrap loads
 * the real-machine probe. The shipped build dir is never modified.
 *
 * The addon is installed (unmodified) so we test the artifact users get, and a
 * *second* copy — the probe — is what the launcher drives.
 */
function buildProbeCopy() {
  const src = path.join(ROOT, ".scaffold", "build", "addon");
  const dest = path.join(QA_ROOT, "addon-under-test");
  assertInsideQa(QA_ROOT, dest);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "scripts", "qa", "driver2", "probe.js"),
    path.join(dest, "content", "scripts", "probe.js"),
  );
  // Controlled progress states for screenshots: modify ONLY the QA copy.
  const bundlePath = path.join(dest, "content", "scripts", "wenxianyidu.js");
  const bundle = fs.readFileSync(bundlePath, "utf8");
  if (bundle.includes("function updateOfflinePreparationStatus(")) {
    const closing = bundle.lastIndexOf("\n})();");
    const instrumented = closing < 0 ? bundle : bundle.slice(0, closing) + "\n  Zotero.WenxianYidu.offline.__qaProgress023 = updateOfflinePreparationStatus;" + bundle.slice(closing);
    if (!instrumented.includes("offline.__qaProgress023 =")) throw Error("Progress QA hook could not be installed");
    fs.writeFileSync(bundlePath, instrumented, "utf8");
  }
  // Patch the bootstrap: after the addon's own startup, load the probe.
  const bootPath = path.join(dest, "bootstrap.js");
  const boot = fs.readFileSync(bootPath, "utf8");
  const patched = boot.replace(
    /await Zotero\.WenxianYidu\.hooks\.onStartup\(\);/,
    `await Zotero.WenxianYidu.hooks.onStartup();\n  try {\n    const probe = ctx._probe = { bundleScope: ctx };\n    Services.scriptloader.loadSubScript(\`\${rootURI}/content/scripts/probe.js\`, probe);\n    probe.startProbe();\n  } catch (e) {\n    Zotero.logError ? Zotero.logError("[文献译读 QA] probe failed: " + e) : Zotero.debug("probe failed: " + e);\n  }`,
  );
  if (!patched.includes("startProbe")) {
    throw new Error("bootstrap patch failed — onStartup marker not found");
  }
  fs.writeFileSync(bootPath, patched, "utf8");
  return dest;
}

function boot() {
  // Kill only OUR previous instance by default; a full machine-wide kill is
  // opt-in (QA_KILL_ALL=1) so the user's own Zotero session survives a QA boot.
  stopQaZotero();
  sleepSync(1000);
  // A fresh profile each boot: Zotero caches extensions.json and a stale
  // entry would silently skip our addon. The data dir is wiped too unless
  // QA_KEEP_DATA=1, so a pipeline run can be inspected afterwards.
  rmIfExists(profileDir);
  if (!process.env.QA_KEEP_DATA) rmIfExists(dataDir);
  rmIfExists(readyFile);
  rmIfExists(resultFile);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  // Zotero discovers exactly one addon per proxy-file install, so the addon
  // under test is a QA copy with probe.js and a controlled progress hook.
  // The shipped build directory and production XPI are never patched.
  writeDirAddon(ADDON_ID, buildProbeCopy());
  log("installed:", fs.readdirSync(extensionsDir).join(", "));

  // QA_LOCALE picks the UI language (default en-US, matching the repo's
  // language-independent QA assertions); QA_EXTRA_PREFS points at a JSON
  // object of extra user_pref values (engine credentials for a shot run —
  // the file lives outside the repo and is never committed).
  const locale = process.env.QA_LOCALE || "zh-CN";
  const extraPrefs = [];
  if (process.env.QA_EXTRA_PREFS && fs.existsSync(process.env.QA_EXTRA_PREFS)) {
    const parsed = JSON.parse(fs.readFileSync(process.env.QA_EXTRA_PREFS, "utf8"));
    for (const [name, value] of Object.entries(parsed)) {
      extraPrefs.push(
        `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`,
      );
    }
    log("extra prefs:", Object.keys(parsed).join(", "));
  }

  fs.writeFileSync(
    path.join(profileDir, "prefs.js"),
    [
      `user_pref("extensions.zotero.debug", true);`,
      `user_pref("extensions.zotero.debug.time", true);`,
      `user_pref("extensions.autoDisableScopes", 0);`,
      `user_pref("extensions.logging.enabled", true);`,
      `user_pref("extensions.lastAppBuildId", "");`,
      `user_pref("extensions.lastAppVersion", "");`,
      `user_pref("browser.shell.checkDefaultBrowser", false);`,
      `user_pref("toolkit.telemetry.enabled", false);`,
      // A fresh QA profile looks like a first install, and on first run Zotero
      // opens https://www.zotero.org/start in the user's default browser
      // (zoteroPane.js checks `firstRun2`). The harness boots many short-lived
      // profiles, so that turned into the same web page popping up over and over
      // on a machine where someone is working. Pretend the first run is done.
      `user_pref("extensions.zotero.firstRun2", false);`,
      `user_pref("extensions.zotero.firstRun", false);`,
      // The UI language under test (en-US keeps QA assertions language-
      // independent; zh-CN exercises the Chinese strings).
      `user_pref("general.useragent.locale", "${locale}");`,
      `user_pref("intl.locale.requested", "${locale}");`,
      ...extraPrefs,
    ].join("\n") + "\n",
    "utf8",
  );

  const out = fs.openSync(zoteroLog, "w");
  log("spawning", ZOTERO_BIN);
  const child = spawn(
    ZOTERO_BIN,
    [
      "--purgecaches",
      "-no-remote",
      "-profile",
      profileDir,
      "--dataDir",
      dataDir,
      "-ZoteroDebugText",
    ],
    { detached: true, windowsHide: true, stdio: ["ignore", out, out],
      env: process.env.QA_NO_SYSTEM_NODE === "1" ? { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` } : process.env },
  );
  child.unref();
  fs.closeSync(out);
  fs.writeFileSync(pidFile, String(child.pid), "utf8");

  return child.pid;
}

async function waitReady(timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(readyFile)) {
      log("ready after", Date.now() - t0, "ms");
      return true;
    }
    await sleep(500);
  }
  return false;
}

let cmdCounter = 100;
async function send(action, arg) {
  if (!fs.existsSync(readyFile)) {
    log("waiting for driver ready…");
    if (!(await waitReady())) throw new Error("driver never became ready");
  }
  const id = Date.now() * 1000 + (++cmdCounter % 1000);
  rmIfExists(resultFile);
  fs.writeFileSync(cmdFile, JSON.stringify({ id, action, arg }), "utf8");
  const t0 = Date.now();
  for (;;) {
    if (fs.existsSync(resultFile)) {
      const raw = fs.readFileSync(resultFile, "utf8");
      try {
        const parsed = JSON.parse(raw);
        if (parsed.id === id) {
          const evidenceDir=path.join(QA_ROOT,"results");
          fs.mkdirSync(evidenceDir,{recursive:true});
          fs.writeFileSync(path.join(evidenceDir,`${Date.now()}-${action.replace(/[^a-z0-9-]/gi,"_")}.json`),raw);
          return parsed;
        }
      } catch {
        /* partial write */
      }
    }
    if (Date.now() - t0 > (Number(process.env.QA_CMD_TIMEOUT) || 180000)) {
      throw new Error("command timed out: " + action);
    }
    await sleep(300);
  }
}

const main = process.argv[2];

if (main === "boot") {
  const pid = boot();
  log("pid", pid, "→ log:", zoteroLog);
  const ok = await waitReady();
  log(ok ? "READY" : "TIMEOUT (check zotero-stdout.log / driver.log)");
  process.exit(ok ? 0 : 2);
} else if (main === "wait") {
  const ok = await waitReady();
  log(ok ? "READY" : "TIMEOUT");
  process.exit(ok ? 0 : 2);
} else if (main === "send") {
  const action = process.argv[3];
  const rawArg = process.argv[4];
  let arg = rawArg;
  if(rawArg && /^[\[{]/.test(rawArg)) { try { arg=JSON.parse(rawArg); } catch {} }
  if (!action) {
    log("usage: send <action> [arg]");
    process.exit(1);
  }
  const res = await send(action, arg);
  console.log(JSON.stringify(res, null, 2));
} else if (main === "shoot") {
  // Default: close only the QA instance. QA_KILL_ALL=1 keeps the old
  // machine-wide behaviour for CI-style runs.
  stopQaZotero();
  log("zotero stopped");
} else if (main === "log") {
  const which = process.argv[3] === "zotero" ? zoteroLog : zoteroLog;
  const text = fs.existsSync(which) ? fs.readFileSync(which, "utf8") : "(no log)";
  const lines = text.split("\n");
  console.log(
    lines.length > 200
      ? lines.slice(-200).join("\n") + "\n… (showing last 200 of " + lines.length + ")"
      : text,
  );
} else {
  log(`Commands:
  boot     launch Zotero with the QA profile and wait until the driver is ready
  wait     wait for the driver to become ready
  send <action> [arg]   run a driver handler and print its JSON result
  shoot    kill Zotero
  log [driver|zotero]   tail the logs`);
  process.exit(1);
}

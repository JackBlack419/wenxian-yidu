/**
 * JavaRuntimeManager — Manages a bundled Java JRE for OpenDataLoader.
 *
 * When the user's machine has no Java 11+, this downloads an Eclipse Temurin
 * **portable JRE** (not an installer — a .zip on Windows, .tar.gz on
 * macOS/Linux) from Adoptium, extracts it under {DataDir}/wenxianyidu/java-runtime/,
 * and exposes the absolute path to its `java` executable. Because it's a
 * portable package extracted into the user's own data directory, it needs no
 * administrator privileges, no UAC elevation, and no system PATH modification —
 * and crucially no Zotero restart: the caller resolves `java` afresh on each
 * invocation, so a freshly-extracted JRE is picked up immediately.
 *
 * Cross-platform (Win + macOS + Linux). Adoptium API (verified):
 *   GET https://api.adoptium.net/v3/binary/latest/{feature}/ga/{os}/{arch}/jre/hotspot/normal/eclipse
 *   → 307 → GitHub release asset (e.g. OpenJDK17U-jre_x64_windows_hotspot_17.0.x_x.zip)
 *   GET https://api.adoptium.net/v3/assets/latest/{feature}/hotspot?os=&architecture=&image_type=jre&vendor=eclipse
 *   → metadata incl. binary.package.checksum (SHA-256), the anchor for
 *     detecting and reusing a previously completed download.
 *
 * The install is interruption-safe: archives are kept across failed installs
 * and reused by SHA-256 on retry, extraction happens in a staging directory
 * that must pass `java -version` before atomically moving into place, and a
 * cached-but-broken runtime is detected by probe and discarded (self-heal).
 *
 * Ported from leadero's src/core/pdf/JavaRuntimeManager.ts. Changes: the managed
 * runtime directory and every temp-file prefix now carry the z-transplit
 * addon name, and log prefixes are renamed. Host-coupled (Zotero.HTTP /
 * nsIProcess / taskkill) — unit-tested against a faked host boundary in
 * tests/unit/core/pdf/javaRuntimeManager.test.ts.
 *
 * @module core/pdf/JavaRuntimeManager
 */


import { getString } from "../../utils/locale";
import { safeDebug } from "../../utils/logger";
import { sha256Hex } from "../../utils/hash";

export interface JavaStatus {
  /** A usable java executable path was resolved (managed JRE or system). */
  ready: boolean;
  version?: string;
  path?: string;
  /** True when the resolved java is the plugin-managed JRE. */
  managed?: boolean;
  error?: string;
}

export interface DownloadProgress {
  /** 0–100 during download; indeterminate phases leave percent unchanged. */
  percent: number;
  phase: "querying" | "downloading" | "extracting" | "verifying" | "done";
  message?: string;
}
export type ProgressCallback = (p: DownloadProgress) => void;


function isWindows(): boolean {
  if (Zotero.isWin) return true;
  if (Zotero.platform === "win32" || Zotero.platform === "win") return true;
  try {
    const appinfo = (Components as any).classes[
      "@mozilla.org/xre/app-info;1"
    ]?.getService?.((Components as any).interfaces?.nsIXULRuntime);
    if (appinfo?.OS === "WINNT") return true;
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: " + e);
    /* ignore */
  }
  return false;
}

function isMac(): boolean {
  if (Zotero.isMac) return true;
  if (Zotero.platform === "macosx" || Zotero.platform === "mac") return true;
  return false;
}

/** Apple Silicon (arm64) vs Intel (x64) on macOS. */
function isMacArm64(): boolean {
  try {
    const sysinfo = (Components as any).classes[
      "@mozilla.org/system-info;1"
    ]?.getService?.((Components as any).interfaces?.nsIPropertyBag2);
    // macOS machine model / arch hints
    const arch = (sysinfo?.get?.("arch") as string) || "";
    if (/aarch64|arm64/i.test(arch)) return true;
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: " + e);
    /* ignore */
  }
  // Fallback: Zotero 7+ may expose isARM
  if ((Zotero as any).isARM) return true;
  return false;
}


function getDataDir(): string {
  return (Zotero as any).DataDirectory?.dir as string;
}

function pathJoin(...parts: string[]): string {
  const { join } = (globalThis as any).PathUtils || {};
  if (join) return join(...parts);
  return parts.join(isWindows() ? "\\" : "/").replace(/[/\\]+/g, (_m) =>
    isWindows() ? "\\" : "/",
  );
}

/** Managed JRE root: {DataDir}/wenxianyidu/java-runtime/ */
export function getJavaRuntimeDir(): string {
  return pathJoin(getDataDir(), "wenxianyidu", "java-runtime");
}

/**
 * Resolve the `java` executable inside the managed JRE dir.
 *
 * Adoptium extracts to a versioned subdir (e.g. `jdk-17.0.19+10-jre/`), so the
 * actual java lives at {runtime-dir}/{jdk-*-jre}/bin/java(.exe). We scan
 * children rather than hard-coding the version. Returns null if not found.
 *
 * A successful resolution is cached in `managedExeCache` so the synchronous
 * resolver in OpenDataLoaderPdfClient can use it without async IO.
 */
let managedExeCache: string | null = null;

/**
 * Synchronous peek at the cached managed-JRE path. Returns null if no managed
 * JRE has been resolved yet (call getManagedJavaExe() async first to populate).
 * Exists so OpenDataLoaderPdfClient.resolveJavaExecutable (which must stay
 * sync) can prefer the managed JRE without async IO.
 */
export function getCachedManagedJavaExe(): string | null {
  return managedExeCache;
}

export async function getManagedJavaExe(): Promise<string | null> {
  if (managedExeCache && (await pathExists(managedExeCache))) {
    return managedExeCache;
  }
  managedExeCache = null;
  const javaExe = await findJavaInDir(getJavaRuntimeDir());
  managedExeCache = javaExe;
  return javaExe;
}

/**
 * Scan a directory for an extracted Temurin JRE and return the absolute path
 * to its `java` executable. Handles both the Windows/Linux layout
 * ({dir}/jdk-xxx/bin/java) and the macOS bundle layout
 * ({dir}/jdk-xxx/Contents/Home/bin/java).
 */
async function findJavaInDir(dir: string): Promise<string | null> {
  const IOUtils = (globalThis as any).IOUtils;
  if (!(await pathExists(dir))) return null;

  const binName = isWindows() ? "java.exe" : "java";
  try {
    const children = await IOUtils.getChildren(dir);
    // Look for a jdk-* (or jre-*) top-level folder containing bin/java.
    for (const child of children) {
      const name = basename(child);
      if (!/^jdk-/i.test(name) && !/^jre-/i.test(name)) continue;
      for (const tail of [
        ["bin", binName],
        ["Contents", "Home", "bin", binName],
      ]) {
        const candidate = pathJoin(child, ...tail);
        if (await pathExists(candidate)) return candidate;
      }
    }
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: " + e);
    /* ignore — fall through */
  }
  return null;
}

/**
 * Drop the managed JRE: clear the sync cache and delete the runtime directory
 * (best-effort). Called when a cached managed JRE fails its `java -version`
 * probe — e.g. a truncated extraction — so callers fall back to system Java
 * and a later downloadJRE() starts clean instead of resurrecting the broken
 * tree. Cache clearing matters: resolveJavaExecutable() serves the cached
 * path synchronously and would keep handing out the dead executable.
 */
export async function discardManagedRuntime(): Promise<void> {
  managedExeCache = null;
  try {
    await (globalThis as any).IOUtils.remove(getJavaRuntimeDir(), {
      recursive: true,
      ignoreAbsent: true,
    });
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: discard failed: " + e);
  }
}


async function pathExists(p: string): Promise<boolean> {
  try {
    return await (globalThis as any).IOUtils.exists(p);
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: " + e);
    return false;
  }
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

// ─── nsIProcess execution ──

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run a command capturing stdout/stderr via temp-file redirection.
 * nsIProcess has no pipes, so we redirect to files and read them back.
 */
async function execCommand(
  exePath: string,
  args: string[],
  opts: { timeout?: number } = {},
): Promise<ExecResult> {
  const isWin = isWindows();
  if (isWin) {
    // Reuse the Unicode-safe, hidden process runner. A UTF-8 .bat is decoded
    // using the Windows OEM code page and corrupts Chinese paths.
    const { runProcess } = await import("./OpenDataLoaderPdfClient");
    return runProcess(exePath, args, opts.timeout ?? 120000);
  }
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const timeout = opts.timeout ?? 120000;
  const IOUtils = (globalThis as any).IOUtils;

  const tmpDir = (Zotero as any).getTempDirectory();
  const ts = Date.now();
  const stdoutFile = tmpDir.clone();
  stdoutFile.append(`wenxianyidu-jre-${ts}-out.txt`);
  const stderrFile = tmpDir.clone();
  stderrFile.append(`wenxianyidu-jre-${ts}-err.txt`);

  let wrapperExe: string;
  let wrapperArgs: string[];

  if (isWin) {
    const batLines = [
      `@"${exePath}" ${args.map((a) => `"${a}"`).join(" ")}`,
      `> "${stdoutFile.path}" 2> "${stderrFile.path}"`,
    ].join(" ");
    const batFile = tmpDir.clone();
    batFile.append(`wenxianyidu-jre-${ts}.bat`);
    await IOUtils.writeUTF8(batFile.path, batLines);
    wrapperExe = batFile.path;
    wrapperArgs = [];
    try {
      const batNs = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      batNs.initWithPath(wrapperExe);
      const proc0 = Cc["@mozilla.org/process/util;1"].createInstance(
        Ci.nsIProcess,
      );
      proc0.init(batNs);
      // Run bat synchronously-blocking isn't needed; we hand the bat path to
      // the unified promise runner below. But nsIProcess can run .bat directly.
      return runProcessWithObserver(proc0, wrapperArgs, {
        timeout,
        stdoutFile,
        stderrFile,
        cleanupPaths: [batFile.path],
      });
    } catch (e) {
      throw new Error(`Failed to launch extraction: ${e}`, { cause: e });
    }
  } else {
    const cmd = `"${exePath}" ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")} > '${stdoutFile.path}' 2> '${stderrFile.path}'`;
    wrapperExe = "/bin/sh";
    wrapperArgs = ["-c", cmd];
    const shFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    shFile.initWithPath(wrapperExe);
    const proc = Cc["@mozilla.org/process/util;1"].createInstance(
      Ci.nsIProcess,
    );
    proc.init(shFile);
    return runProcessWithObserver(proc, wrapperArgs, {
      timeout,
      stdoutFile,
      stderrFile,
    });
  }
}

// M-19: nsIProcess.kill() only terminates the direct child (.bat host on
// Windows, /bin/sh on Unix). The real JVM becomes an orphan and keeps
// running. Use taskkill /T /F on Windows to take down the whole tree;
// on other platforms fall back to plain kill().
async function killProcessTree(proc: any): Promise<void> {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  try {
    if (!proc?.isRunning) return;
    const pid: number | undefined = proc.pid;
    const isWin = isWindows();
    if (isWin && pid) {
      const env = Cc["@mozilla.org/process/environment;1"]?.getService(
        Ci.nsIEnvironment,
      );
      const sysRoot = env?.get("SystemRoot") || "C:\\Windows";
      const taskkillPath = `${sysRoot}\\System32\\taskkill.exe`;
      const tkFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      tkFile.initWithPath(taskkillPath);
      if (!tkFile.exists()) {
        proc.kill();
        return;
      }
      const tkProc = Cc["@mozilla.org/process/util;1"].createInstance(
        Ci.nsIProcess,
      );
      tkProc.init(tkFile);
      await new Promise<void>((resolve) => {
        const obs = {
          observe: () => resolve(),
          QueryInterface: (iid: any) => {
            if (iid.equals(Ci.nsIObserver) || iid.equals(Ci.nsISupports))
              return obs;
            throw (Components as any).results.NS_NOINTERFACE;
          },
        };
        try {
          tkProc.runwAsync(["/T", "/F", "/PID", String(pid)], 4, obs);
        } catch (e) {
          safeDebug("[文献译读] JavaRuntimeManager: " + e);
          resolve();
        }
        setTimeout(resolve, 10_000);
      });
      return;
    }
    proc.kill();
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: " + e);
    try { proc.kill(); } catch (e) {       safeDebug("[文献译读] JavaRuntimeManager: " + e);  /* already dead */ }
  }
}

/** Shared promise runner for an already-init'd nsIProcess. */
function runProcessWithObserver(
  proc: any,
  args: string[],
  ctx: {
    timeout: number;
    stdoutFile: any;
    stderrFile: any;
    cleanupPaths?: string[];
  },
): Promise<ExecResult> {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const IOUtils = (globalThis as any).IOUtils;
  const { timeout, stdoutFile, stderrFile, cleanupPaths } = ctx;

  return new Promise<ExecResult>((resolve) => {
    let settled = false;
    const finish = (result: Partial<ExecResult>) => {
      if (settled) return;
      settled = true;
      Promise.all([
        IOUtils.readUTF8(stdoutFile.path).catch(() => ""),
        IOUtils.readUTF8(stderrFile.path).catch(() => ""),
      ]).then(([stdout, stderr]) => {
        for (const p of cleanupPaths || []) {
          IOUtils.remove(p).catch((e: any) => { safeDebug("[文献译读] JavaRuntimeManager: temp cleanup failed: " + e); });
        }
        IOUtils.remove(stdoutFile.path).catch((e: any) => { safeDebug("[文献译读] JavaRuntimeManager: temp cleanup failed: " + e); });
        IOUtils.remove(stderrFile.path).catch((e: any) => { safeDebug("[文献译读] JavaRuntimeManager: temp cleanup failed: " + e); });
        resolve({
          exitCode: result.exitCode ?? -1,
          stdout: stdout || "",
          stderr: stderr || "",
          timedOut: result.timedOut ?? false,
        });
      });
    };

    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(
      {
        notify: () => {
          if (proc.isRunning) {
            // M-19: nsIProcess.kill() only terminates the direct child (.bat
            // host on Windows, /bin/sh on Unix). Use tree-kill so the real
            // JVM doesn't survive as an orphan.
            void (async () => {
              await killProcessTree(proc);
              finish({ exitCode: -1, timedOut: true });
            })();
          }
        },
      },
      timeout,
      Ci.nsITimer.TYPE_ONE_SHOT,
    );

    const observer = {
      observe: (_subject: any, topic: string) => {
        if (topic === "process-finished" || topic === "process-failed") {
          timer.cancel();
          finish({ exitCode: proc.exitValue });
        }
      },
      QueryInterface: (iid: any) => {
        if (iid.equals(Ci.nsIObserver) || iid.equals(Ci.nsISupports))
          return observer;
        throw (Components as any).results.NS_NOINTERFACE;
      },
    };
    proc.runwAsync(args, args.length, observer);
  });
}


interface AdoptiumAsset {
  url: string;
  filename: string;
  /** "zip" or "tar.gz" — drives the extraction command. */
  archive: "zip" | "tar.gz";
  /** SHA-256 of the archive, when the assets API was reachable. */
  sha256?: string;
}

/** Adoptium os/arch/archive triple for the current machine. */
function platformDescriptor(): {
  os: string;
  arch: string;
  archive: "zip" | "tar.gz";
} {
  if (isWindows()) return { os: "windows", arch: "x64", archive: "zip" };
  if (isMac()) {
    return { os: "mac", arch: isMacArm64() ? "aarch64" : "x64", archive: "tar.gz" };
  }
  return { os: "linux", arch: "x64", archive: "tar.gz" };
}

/**
 * Build the Adoptium binary download URL for the current platform/arch.
 * The API responds 307 → the actual GitHub release asset. No checksum is
 * known on this path — it is the fallback when the assets API is unreachable.
 */
function resolveAdoptiumAsset(featureVersion: number): AdoptiumAsset {
  const { os, arch, archive } = platformDescriptor();
  const url = `https://api.adoptium.net/v3/binary/latest/${featureVersion}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
  // Filename is best-effort (only used for logging); the server sets it.
  const filename = `temurin-${featureVersion}-jre-${os}-${arch}.${archive}`;
  return { url, filename, archive };
}

/**
 * Ask the Adoptium assets API for the latest GA JRE. Unlike the binary
 * endpoint this returns metadata — most importantly the archive's SHA-256,
 * the anchor for detecting and reusing a previously completed download.
 * Endpoint shape (verified): GET /v3/assets/latest/{feature}/hotspot
 * ?os=&architecture=&image_type=jre&vendor=eclipse → [{binary.package:
 * {name, link, size, checksum}}]. Returns null on any failure.
 */
async function queryAdoptiumLatestAsset(
  featureVersion: number,
): Promise<AdoptiumAsset | null> {
  const { os, arch, archive } = platformDescriptor();
  const url = `https://api.adoptium.net/v3/assets/latest/${featureVersion}/hotspot?os=${os}&architecture=${arch}&image_type=jre&vendor=eclipse`;
  try {
    const resp = await (Zotero as any).HTTP.request("GET", url, {
      responseType: "json",
      timeout: 30000,
    });
    const pkg = Array.isArray(resp?.response)
      ? resp.response[0]?.binary?.package
      : null;
    if (resp.status === 200 && pkg?.link && pkg?.checksum) {
      return {
        url: pkg.link,
        filename: pkg.name || `temurin-${featureVersion}-jre-${os}-${arch}.${archive}`,
        archive,
        sha256: String(pkg.checksum).toLowerCase(),
      };
    }
    safeDebug(
      `[文献译读] JavaRuntimeManager: assets API unexpected response status=${resp.status}`,
    );
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: assets API failed: " + e);
  }
  return null;
}


/**
 * Extract a downloaded JRE archive into the managed runtime dir.
 * Windows zip → tar.exe (Win10 1803+), fallback PowerShell Expand-Archive.
 * Unix tar.gz → /usr/bin/tar -xzf.
 */
async function extractArchive(
  archivePath: string,
  destDir: string,
  archive: "zip" | "tar.gz",
): Promise<void> {
  const isWin = isWindows();

  // Ensure dest exists. IOUtils' MakeDirectoryOptions only knows
  // `createAncestors`; `recursive`/`createParents` are OS.File-era names that
  // the WebIDL dictionary conversion silently drops, so ancestors were never
  // actually created.
  await (globalThis as any).IOUtils.makeDirectory(destDir, {
    createAncestors: true,
  });

  if (isWin) {
    await extractWindowsZip(archivePath, destDir);
    return;
  }

  // Unix: tar -xzf works for .tar.gz (and -xf auto-detects on modern tar).
  const flag = archive === "tar.gz" ? "-xzf" : "-xf";
  const result = await execCommand("/usr/bin/tar", [flag, archivePath, "-C", destDir], {
    timeout: 300000,
  });
  if (result.exitCode !== 0) {
    throw new Error(getString("java-error-extract-failed", {
      detail: result.stderr || "unknown error",
    }));
  }
}

/** Native ZIP extraction is independent of console code pages and shell quoting. */
export async function extractWindowsZip(archivePath: string, destDir: string, signal?: AbortSignal): Promise<void> {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const IO = (globalThis as any).IOUtils;
  const archive = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  archive.initWithPath(archivePath);
  const zip = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
  zip.open(archive);
  try {
    const entries = zip.findEntries("*");
    while (entries.hasMore()) {
      if (signal?.aborted) throw Object.assign(new Error("已取消翻译"), { name: "AbortError" });
      const raw = entries.getNext();
      const name = typeof raw === "string" ? raw : raw?.name ?? raw?.QueryInterface?.(Ci.nsISupportsCString)?.data;
      if (typeof name !== "string" || !name || /[\\:\u0000]/.test(name) || name.startsWith("/") || name.split("/").some(p => p === ".." || p === ".")) {
        throw new Error("运行库压缩包包含无效路径，安装已停止。");
      }
      const parts = name.split("/").filter(Boolean);
      if (parts.length === 0) continue;
      const target = pathJoin(destDir, ...parts);
      if (name.endsWith("/")) {
        await IO.makeDirectory(target, { createAncestors: true, ignoreExisting: true });
      } else {
        const parent = pathJoin(destDir, ...parts.slice(0, -1));
        await IO.makeDirectory(parent, { createAncestors: true, ignoreExisting: true });
        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        file.initWithPath(target);
        zip.extract(name, file);
        await IO.setPermissions?.(target, /\.exe$/i.test(name) ? 0o755 : 0o644);
      }
    }
  } finally { zip.close(); }
}


/**
 * Sibling staging dir: archives are extracted and probed here first, then
 * atomically moved into the runtime dir — a kill mid-extract can never leave
 * a half-written runtime that later gets cached as valid.
 */
function getStagingDir(): string {
  return pathJoin(getDataDir(), "wenxianyidu", "java-runtime.staging");
}

/**
 * Persistent download cache next to the runtime dir. The archive is KEPT
 * across failed installs; a retry whose checksum still matches skips the
 * ~45MB download entirely. Removed only on verified success or mismatch.
 */
function getArchivePath(archive: "zip" | "tar.gz"): string {
  return pathJoin(getDataDir(), "wenxianyidu", `java-runtime.download.${archive}`);
}

interface ArchiveMeta {
  sha256: string;
  bytes: number;
}

function getArchiveMetaPath(): string {
  return pathJoin(getDataDir(), "wenxianyidu", "java-runtime.download.json");
}

async function readArchiveMeta(): Promise<ArchiveMeta | null> {
  try {
    const raw = await (globalThis as any).IOUtils.readUTF8(getArchiveMetaPath());
    const meta = JSON.parse(raw);
    if (typeof meta?.sha256 === "string" && typeof meta?.bytes === "number") {
      return meta;
    }
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: " + e);
  }
  return null;
}

async function writeArchiveMeta(meta: ArchiveMeta): Promise<void> {
  try {
    await (globalThis as any).IOUtils.writeUTF8(
      getArchiveMetaPath(),
      JSON.stringify(meta, null, 2) + "\n",
    );
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: " + e);
  }
}

async function removeCachedArchive(): Promise<void> {
  const IOUtils = (globalThis as any).IOUtils;
  for (const p of [
    getArchivePath("zip"),
    getArchivePath("tar.gz"),
    getArchiveMetaPath(),
  ]) {
    try {
      await IOUtils.remove(p, { ignoreAbsent: true });
    } catch (e) {
      safeDebug("[文献译读] JavaRuntimeManager: archive cleanup failed: " + e);
    }
  }
}

/** Concurrent downloadJRE() calls share one in-flight install. */
let installInFlight: Promise<string> | null = null;

/**
 * Download (or reuse) and install a portable Temurin JRE. Returns the
 * absolute path to the extracted `java` executable.
 *
 * Interruption-safe by design:
 *  - The archive survives a failed install; a retry whose SHA-256 still
 *    matches (recorded locally at download time, compared against the latest
 *    release when the assets API is reachable) skips the download entirely.
 *  - Extraction goes to a staging dir that must pass `java -version` before
 *    being atomically moved into place, so a truncated runtime is never
 *    served.
 *  - A cached managed JRE that fails its probe is discarded and reinstalled
 *    (self-heal).
 */
export async function downloadJRE(
  featureVersion: number = 17,
  onProgress?: ProgressCallback,
): Promise<string> {
  if (installInFlight) return installInFlight;
  installInFlight = installJRE(featureVersion, onProgress).finally(() => {
    installInFlight = null;
  });
  return installInFlight;
}

async function installJRE(
  featureVersion: number,
  onProgress?: ProgressCallback,
  offlineAsset?: AdoptiumAsset,
): Promise<string> {
  const IOUtils = (globalThis as any).IOUtils;

  // IOUtils.write does not create parent directories — make sure the plugin's
  // data subdir exists before we cache the archive and metadata in it.
  try {
    await IOUtils.makeDirectory(pathJoin(getDataDir(), "wenxianyidu"), {
      createAncestors: true,
    });
  } catch (e) {
    safeDebug("[文献译读] JavaRuntimeManager: " + e);
  }

  // Fast path with self-heal. findJavaInDir only checks file existence, so a
  // truncated extraction would otherwise be served forever with cryptic JVM
  // crashes — an existing managed JRE counts only when it actually runs.
  const existing = await getManagedJavaExe();
  if (existing) {
    const existingProbe = await execCommand(existing, ["-version"], {
      timeout: 15000,
    });
    if (existingProbe.exitCode === 0) {
      onProgress?.({
        percent: 100,
        phase: "done",
        message: getString("java-progress-already-installed"),
      });
      return existing;
    }
    safeDebug(
      `[文献译读] JavaRuntimeManager: managed JRE broken (exit=${existingProbe.exitCode}), reinstalling: ${(existingProbe.stderr || "").slice(0, 200)}`,
    );
    onProgress?.({
      percent: 0,
      phase: "querying",
      message: getString("java-progress-self-heal"),
    });
    await discardManagedRuntime();
  }

  // Assets API first (provides the checksum anchor); the redirect-only
  // binary URL is the fallback when metadata is unreachable.
  const asset = offlineAsset ?? (
    (await queryAdoptiumLatestAsset(featureVersion)) ||
    resolveAdoptiumAsset(featureVersion));
  const runtimeDir = getJavaRuntimeDir();
  const stagingDir = getStagingDir();
  const archivePath = getArchivePath(asset.archive);

  // Reuse a previously downloaded archive when it still hashes to what was
  // recorded after the original download AND — when known — to the latest
  // release upstream. Covers "download OK, extract killed" retries and
  // offline retries, while still refreshing on new upstream patch releases.
  let archiveVerified = false;
  const meta = await readArchiveMeta();
  if (meta && (await pathExists(archivePath))) {
    let fileHash: string | null = null;
    try {
      fileHash = await sha256Hex(await IOUtils.read(archivePath));
    } catch (e) {
      safeDebug("[文献译读] JavaRuntimeManager: archive read failed: " + e);
    }
    if (
      fileHash &&
      fileHash === meta.sha256 &&
      (!asset.sha256 || asset.sha256 === fileHash)
    ) {
      archiveVerified = true;
      onProgress?.({
        percent: 100,
        phase: "downloading",
        message: getString("java-progress-reuse-archive"),
      });
    } else {
      await removeCachedArchive();
    }
  }

  if (!archiveVerified) {
    if (!asset.sha256) {
      throw new Error("无法取得官方运行库校验信息。请重试，或使用离线导入并填写官方 SHA-256。");
    }
    onProgress?.({
      percent: 0,
      phase: "downloading",
      message: getString("java-progress-download-start", {
        version: featureVersion,
        archive: asset.archive,
      }),
    });

    let response: any;
    try {
      response = await (Zotero as any).HTTP.request("GET", asset.url, {
        responseType: "arraybuffer",
        timeout: 600000, // 10 min for ~40-50MB
        requestObserver: (xhr: XMLHttpRequest) => {
          xhr.addEventListener("progress", (e: ProgressEvent) => {
            if (e.lengthComputable && e.total > 0) {
              const percent = Math.round((e.loaded / e.total) * 100);
              onProgress?.({
                percent,
                phase: "downloading",
                message: getString("java-progress-downloading", { percent }),
              });
            }
          });
        },
      } as any);
    } catch (e: any) {
      throw new Error(
        getString("java-error-download-failed", {
          detail: e?.message || String(e),
        }),
        { cause: e },
      );
    }

    if (response.status !== 200 || !response.response) {
      throw new Error(
        getString("java-error-download-http", { status: response.status }),
      );
    }

    const bytes = new Uint8Array(response.response);
    if (asset.sha256) {
      const hash = await sha256Hex(bytes);
      if (!hash || hash !== asset.sha256) {
        await removeCachedArchive();
        throw new Error(getString("java-error-checksum-mismatch"));
      }
      await IOUtils.write(archivePath, bytes);
      await writeArchiveMeta({ sha256: hash, bytes: bytes.byteLength });
      // The archive now on disk is checksum-verified — keep it across a
      // failed extraction so the retry skips the download.
      archiveVerified = true;
    } else {
      // No reference checksum (assets API unreachable): keep the old
      // one-shot semantics — extract now, never reuse across attempts, so an
      // undetected partial write is not re-extracted forever.
      await IOUtils.write(archivePath, bytes);
    }
  }

  // Staged extract → probe → atomic swap into the runtime dir.
  onProgress?.({
    percent: 100,
    phase: "extracting",
    message: getString("java-progress-extracting"),
  });
  try {
    try {
      await IOUtils.remove(stagingDir, { recursive: true, ignoreAbsent: true });
    } catch (e) {
      safeDebug("[文献译读] JavaRuntimeManager: staging cleanup failed: " + e);
    }
    await extractArchive(archivePath, stagingDir, asset.archive);

    const stagedJava = await findJavaInDir(stagingDir);
    if (!stagedJava) {
      throw new Error(getString("java-error-exe-not-found", { dir: stagingDir }));
    }
    const stagedProbe = await execCommand(stagedJava, ["-version"], {
      timeout: 30000,
    });
    if (stagedProbe.exitCode !== 0) {
      throw new Error(
        getString("java-error-probe-failed", {
          detail: stagedProbe.stderr || "java -version failed",
        }),
      );
    }

    // Verified — swap in. discardManagedRuntime() clears the cache and any
    // remains of a previous runtime dir (IOUtils.move onto an existing
    // directory fails).
    await discardManagedRuntime();
    try {
      await IOUtils.move(stagingDir, runtimeDir);
    } catch {
      if (!isWindows() || asset.archive !== "zip") throw new Error("无法保存运行库，请重试安装。");
      // Windows can keep transient image handles after java -version. A
      // directory rename may fail although native extraction and execution
      // work. Re-extract the checksum-verified ZIP into the private target;
      // the installed binary is probed again before it is ever cached.
      await discardManagedRuntime();
      await extractWindowsZip(archivePath, runtimeDir);
      try { await IOUtils.remove(stagingDir, { recursive: true, ignoreAbsent: true }); } catch { /* harmless staging remains */ }
    }
  } catch (e) {
    try {
      await IOUtils.remove(stagingDir, { recursive: true, ignoreAbsent: true });
    } catch (e2) {
      safeDebug("[文献译读] JavaRuntimeManager: staging cleanup failed: " + e2);
    }
    // Keep a checksum-verified archive for the retry; drop an unverifiable one.
    if (!archiveVerified) await removeCachedArchive();
    throw e;
  }

  // Final verification from the installed location.
  onProgress?.({
    percent: 100,
    phase: "verifying",
    message: getString("java-progress-verifying"),
  });
  const javaExe = await getManagedJavaExe();
  if (!javaExe) {
    throw new Error(getString("java-error-exe-not-found", { dir: runtimeDir }));
  }
  const probe = await execCommand(javaExe, ["-version"], { timeout: 30000 });
  if (probe.exitCode !== 0) {
    await discardManagedRuntime();
    await removeCachedArchive();
    throw new Error(
      getString("java-error-probe-failed", {
        detail: probe.stderr || "java -version failed",
      }),
    );
  }

  // Success — the cached archive has served its purpose.
  await removeCachedArchive();
  onProgress?.({
    percent: 100,
    phase: "done",
    message: getString("java-progress-done"),
  });
  return javaExe;
}

/** Import a vendor ZIP plus its published checksum without any network call. */
export async function importJavaArchive(sourcePath: string, expectedSha256: string): Promise<string> {
  if (!isWindows() || !/\.zip$/i.test(sourcePath)) throw new Error("请选择 Windows 版 Temurin JRE 17 ZIP 压缩包。");
  const expected = expectedSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("请填写官方公布的 64 位 SHA-256 校验值。");
  if (installInFlight) throw new Error("运行库正在安装，请稍后再导入。");
  const IO = (globalThis as any).IOUtils;
  const bytes = await IO.read(sourcePath);
  if (await sha256Hex(bytes) !== expected) throw new Error("压缩包校验不一致，尚未安装。请重新下载官方文件。");
  await IO.makeDirectory(pathJoin(getDataDir(), "wenxianyidu"), { createAncestors: true, ignoreExisting: true });
  await IO.write(getArchivePath("zip"), bytes);
  await writeArchiveMeta({ sha256: expected, bytes: bytes.byteLength });
  installInFlight = installJRE(17, undefined, { url: "", filename: basename(sourcePath), archive: "zip", sha256: expected })
    .finally(() => { installInFlight = null; });
  return installInFlight;
}

/**
 * Search system PATH for a `java` executable (does NOT check managed JRE).
 * Mirrors the PATH-search logic in OpenDataLoaderPdfClient.resolveJavaExecutable
 * so getJavaStatus() can fall back without importing that module.
 */
function findSystemJava(): string | null {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const Services = (globalThis as any).Services as any;

  const isWindows = (
    Services.appinfo?.OS?.toUpperCase?.() ||
    (navigator as any)?.platform ||
    ""
  ).startsWith("WIN");
  const extensions = isWindows ? [".exe", ".cmd", ".bat", ""] : [""];
  const separator = isWindows ? ";" : ":";

  const env = Cc["@mozilla.org/process/environment;1"]?.getService?.(
    Ci.nsIEnvironment,
  );
  const pathStr = env?.get("PATH") || "";

  const createFile = (p: string) => {
    try {
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      f.initWithPath(p);
      return f;
    } catch (e) {
      safeDebug("[文献译读] JavaRuntimeManager: " + e);
      return null;
    }
  };

  for (const dir of pathStr.split(separator)) {
    const dirTrimmed = dir.trim();
    if (!dirTrimmed) continue;
    for (const ext of extensions) {
      const candidate = dirTrimmed + (isWindows ? "\\" : "/") + "java" + ext;
      const file = createFile(candidate);
      if (file && file.exists() && file.isExecutable()) return candidate;
    }
  }
  return null;
}


/**
 * Resolve a usable java, preferring the managed JRE. Returns a status object
 * suitable for UI display.
 */
export async function getJavaStatus(): Promise<JavaStatus> {
  const managed = await getManagedJavaExe();
  if (managed) {
    const probe = await execCommand(managed, ["-version"], { timeout: 15000 });
    if (probe.exitCode === 0) {
      const vMatch = probe.stderr.match(/version "([^"]+)"/);
      return {
        ready: true,
        version: vMatch ? vMatch[1] : undefined,
        path: managed,
        managed: true,
      };
    }
    // Broken managed JRE (e.g. truncated extraction): drop it before falling
    // back so the sync resolver in OpenDataLoaderPdfClient stops serving the
    // dead path and a later downloadJRE() starts clean.
    await discardManagedRuntime();
  }
  // System PATH fallback (avoids circular import of OpenDataLoaderPdfClient).
  const systemJava = findSystemJava();
  if (systemJava) {
    const probe = await execCommand(systemJava, ["-version"], { timeout: 10000 });
    if (probe.exitCode === 0) {
      const vMatch =
        probe.stderr.match(/version "([^"]+)"/) ||
        probe.stderr.match(/Java\(TM\) SE Runtime Environment.*"([^"]+)"/);
      return {
        ready: true,
        version: vMatch ? vMatch[1] : undefined,
        path: systemJava,
        managed: false,
      };
    }
  }

  return { ready: false, error: "Java runtime not found. Please install Java 11+ and add it to PATH." };
}

const JavaRuntimeManager = {
  getJavaRuntimeDir,
  getManagedJavaExe,
  discardManagedRuntime,
  downloadJRE,
  getJavaStatus,
};
export default JavaRuntimeManager;

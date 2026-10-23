import { createAbortController } from "../../utils/abort";
import { sha256Hex } from "../../utils/hash";
import { extractWindowsZip } from "../pdf/JavaRuntimeManager";
import { combineSignal, assertNotCancelled } from "./providerAdapters";
import { getString } from "../../utils/locale";
import { getOfflinePreparationStatus, subscribeOfflinePreparationStatus, updateOfflinePreparationStatus, type OfflinePreparationStatus } from "./offlinePreparationStatus";

const NODE_VERSION = "24.22.1";
const NODE_SHA256 = "d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5";
const NODE_EXE_SHA256 = "d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5";
const NODE_ZIP_BYTES = 37748064;
const g = () => globalThis as any;
const io = () => g().IOUtils;
const join = (...parts: string[]) => g().PathUtils.join(...parts);
const root = () => join(g().Zotero.DataDirectory.dir, "wenxianyidu", "offline-mtran-5.0.1");
const nodeExe = () => join(root(), `node-v${NODE_VERSION}-win-x64`, "node.exe");
let preparation: Promise<void> | null = null;
let controller: AbortController | null = null;
let process: any = null;
let launch: Promise<{ port: number; token: string }> | null = null;
let serving: { port: number; token: string } | null = null;
function update(next: string, value?: number, error?: string) {
  if (controller?.signal.aborted && !["cancelled", "failed", "cancelling"].includes(next)) return;
  updateOfflinePreparationStatus(next, value, error);
}
export function subscribeOfflineStatus(fn: (phase: string, percent?: number, status?: OfflinePreparationStatus) => void): () => void {
  return subscribeOfflinePreparationStatus(status => fn(status.phase, status.percent, status));
}
export async function getOfflineStatus() {
  const ready = await io()?.exists(join(root(), "ready.json"));
  const status = getOfflinePreparationStatus();
  return { ...status, ready: !!ready && ["missing", "ready"].includes(status.phase), phase: status.phase === "missing" && ready ? "ready" : status.phase, version: "5.0.1", node: NODE_VERSION };
}
export function stopOfflineService(): void { serving = null; launch = null; try { if (process?.isRunning) process.kill(); } catch { /* exited */ } process = null; }
export function cancelOfflinePreparation(): void {
  if (!controller) return;
  controller.abort(); stopOfflineService(); update("cancelling");
}
function startProcess(executable: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const C = g().Components;
    const file = C.classes["@mozilla.org/file/local;1"].createInstance(C.interfaces.nsIFile); file.initWithPath(executable);
    const proc = C.classes["@mozilla.org/process/util;1"].createInstance(C.interfaces.nsIProcess); proc.init(file);
    process = proc;
    proc.startHidden = true;
    try { proc.runwAsync(args, args.length, { observe(_s: any, topic: string) { if (process === proc) process = null; if (topic === "process-finished") resolve(proc.exitValue); else reject(new Error(`${getString("offline-process-failed")} (${proc.exitValue})`)); } }, false); }
    catch (error) { if (process === proc) process = null; reject(error); }
  });
}
async function asset(name: string): Promise<Uint8Array> {
  const urls: Record<string, string> = {
    "package.json": "chrome://wenxianyidu/content/offline/package.json",
    "package-lock.json": "chrome://wenxianyidu/content/offline/package-lock.json",
    "worker.mjs": "chrome://wenxianyidu/content/offline/worker.mjs",
    "modelDownload.mjs": "chrome://wenxianyidu/content/offline/modelDownload.mjs",
    "records.json": "chrome://wenxianyidu/content/offline/records.json",
  };
  if (!urls[name]) throw new Error("Unknown offline asset");
  const value = await g().Zotero.File.getContentsFromURLAsync(urls[name]);
  return new TextEncoder().encode(value);
}
async function writeAsset(name: string, target = join(root(), name)): Promise<void> { await io().write(target, await asset(name)); }
async function validNode(): Promise<boolean> {
  try { return await io().exists(join(root(), "runtime-ready.json")) && await io().exists(join(root(), `node-v${NODE_VERSION}-win-x64`, "node_modules", "npm", "bin", "npm-cli.js")) && await sha256Hex(await io().read(nodeExe())) === NODE_EXE_SHA256; } catch { return false; }
}
async function removeManagedRuntimeDirectory(name: string): Promise<void> {
  if (!["node-staging", `node-v${NODE_VERSION}-win-x64`].includes(name)) throw new Error("Invalid managed directory");
  const base = root().replace(/\\/g, "/").toLowerCase();
  const target = join(root(), name);
  if (!/^(?:[a-z]:\/|\/\/)/i.test(base) || !target.replace(/\\/g, "/").toLowerCase().startsWith(base + "/")) throw new Error("Managed path is outside the plugin data directory");
  await io().remove(target, { recursive: true, ignoreAbsent: true });
}
async function downloadNode(signal: AbortSignal) {
  const archive = join(root(), "node.download.zip");
  let valid = false;
  try { valid = await sha256Hex(await io().read(archive)) === NODE_SHA256; } catch { /* first preparation */ }
  if (!valid) {
    update("downloading", 0);
    // Completed ranges survive interruption. Only the final pinned archive can
    // be extracted; an untrusted partial file is never executable.
    const chunkSize = 2 * 1024 * 1024;
    const count = Math.ceil(NODE_ZIP_BYTES / chunkSize);
    const parts: Uint8Array[] = new Array(count);
    const loaded = new Array(count).fill(0);
    const partPath = (index: number) => join(root(), `node.download.part.${index}`);
    let cursor = 0;
    const progress = () => update("downloading", Math.min(100, Math.round(loaded.reduce((a, b) => a + b, 0) / NODE_ZIP_BYTES * 100)));
    const worker = async () => {
      while (cursor < count) {
        assertNotCancelled(signal);
        const index = cursor++;
        const start = index * chunkSize, end = Math.min(NODE_ZIP_BYTES, start + chunkSize) - 1;
        try {
          const cached = await io().read(partPath(index));
          if (cached.length === end - start + 1) { parts[index] = new Uint8Array(cached); loaded[index] = cached.length; progress(); continue; }
        } catch { /* no completed range yet */ }
        let xhr: any;
        const abort = () => xhr?.abort();
        signal.addEventListener("abort", abort, { once: true });
        try {
          const response = await g().Zotero.HTTP.request("GET", `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`, {
            responseType: "arraybuffer", timeout: 180000, headers: { Range: `bytes=${start}-${end}` },
            requestObserver: (request: any) => { xhr = request; if (signal.aborted) xhr.abort(); else xhr.onprogress = (event: any) => { loaded[index] = Math.min(end - start + 1, event.loaded); progress(); }; },
          });
          assertNotCancelled(signal);
          const bytes = new Uint8Array(response.response);
          if (response.status !== 206 || bytes.length !== end - start + 1) throw new Error(getString("offline-download-failed"));
          await io().write(partPath(index), bytes, { tmpPath: `${partPath(index)}.tmp` });
          parts[index] = bytes; loaded[index] = bytes.length; progress();
        } finally { signal.removeEventListener("abort", abort); }
      }
    };
    const settled = await Promise.allSettled(Array.from({ length: 3 }, worker));
    const failed = settled.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) throw failed.reason;
    const bytes = new Uint8Array(NODE_ZIP_BYTES);
    parts.forEach((part, index) => bytes.set(part, index * chunkSize));
    assertNotCancelled(signal);
    update("verifying");
    if (await sha256Hex(bytes) !== NODE_SHA256) {
      for (let i = 0; i < count; i++) await io().remove(partPath(i), { ignoreAbsent: true });
      throw new Error(getString("offline-checksum-failed"));
    }
    await io().write(archive, bytes, { tmpPath: `${archive}.tmp` });
    for (let i = 0; i < count; i++) await io().remove(partPath(i), { ignoreAbsent: true });
  }
  assertNotCancelled(signal); update("extracting");
  // Gecko directory moves can fail on Windows paths containing npm's deep
  // hierarchy. The readiness marker is the commit point, never node.exe alone.
  await io().remove(join(root(), "runtime-ready.json"), { ignoreAbsent: true });
  await removeManagedRuntimeDirectory(`node-v${NODE_VERSION}-win-x64`);
  await extractWindowsZip(archive, root(), signal); assertNotCancelled(signal);
  if (await sha256Hex(await io().read(nodeExe())) !== NODE_EXE_SHA256) throw new Error(getString("offline-checksum-failed"));
  await io().writeJSON(join(root(), "runtime-ready.json"), { version: NODE_VERSION, sha256: NODE_EXE_SHA256 });
  await removeManagedRuntimeDirectory("node-staging");
  if (!await validNode()) throw new Error(getString("offline-checksum-failed"));
}
async function runWorker(prepare: boolean, signal?: AbortSignal) {
  await writeAsset("modelDownload.mjs");
  await writeAsset("worker.mjs");
  const token = g().Services?.uuid?.generateUUID?.().toString() ?? g().Zotero.getMainWindow().crypto.randomUUID();
  const status = join(root(), "worker-status.json");
  await io().remove(status, { ignoreAbsent: true });
  const settings = { root: root(), status, prepare, token, parentPID: g().Services?.appinfo?.processID ?? g().Zotero.getMainWindow().Services.appinfo.processID };
  const configPath = join(root(), "worker-config.json");
  await io().writeUTF8(configPath, JSON.stringify(settings));
  let exited: number | undefined;
  let failure: unknown;
  const work = startProcess(nodeExe(), [join(root(), "worker.mjs"), configPath]).then(code => { exited = code; }, error => { failure = error; });
  const started = Date.now();
  while (Date.now() - started < (prepare ? 900000 : 90000)) {
    assertNotCancelled(signal);
    try {
      const state = await io().readJSON(status);
      if (state.phase === "failed") throw Object.assign(new Error(getString("offline-prepare-failed", { error: state.error })), { workerFailure: true });
      if (prepare && state.phase === "ready") { await work; assertNotCancelled(signal); if (failure || exited !== 0) throw failure ?? new Error(getString("offline-process-failed")); return { port: 0, token }; }
      if (!prepare && state.phase === "serving") return { port: state.port as number, token };
      if (prepare && state.phase) update(state.phase, state.percent);
    } catch (error: any) { if (error.workerFailure) throw error; }
    if (failure || exited !== undefined) throw failure ?? new Error(getString("offline-process-failed"));
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  stopOfflineService(); throw new Error(getString("offline-timeout"));
}
export function prepareOffline(): Promise<void> {
  if (preparation) return preparation;
  controller = createAbortController(); const signal = controller!.signal;
  preparation = (async () => {
    if (!g().Zotero?.isWin) throw new Error(getString("offline-platform"));
    stopOfflineService(); update("verifying");
    await io().makeDirectory(root(), { createAncestors: true, ignoreExisting: true });
    await io().remove(join(root(), "ready.json"), { ignoreAbsent: true });
    if (!await validNode()) await downloadNode(signal);
    for (const name of ["package.json", "package-lock.json", "worker.mjs"]) await writeAsset(name);
    assertNotCancelled(signal); update("dependencies");
    const work = startProcess(nodeExe(), [join(root(), `node-v${NODE_VERSION}-win-x64`, "node_modules", "npm", "bin", "npm-cli.js"), "ci", "--prefix", root(), "--cache", join(root(), "npm-cache"), "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--no-update-notifier", "--registry=https://registry.npmjs.org"]);
    const cancel = () => stopOfflineService(); signal.addEventListener("abort", cancel, { once: true });
    try { if (await work !== 0) throw new Error(getString("offline-dependencies-failed")); assertNotCancelled(signal);
      await io().makeDirectory(join(root(), "config"), { createAncestors: true, ignoreExisting: true });
      await writeAsset("records.json", join(root(), "config", "records.json"));
      await runWorker(true, signal); assertNotCancelled(signal); update("ready");
    } finally { signal.removeEventListener("abort", cancel); }
  })().catch(error => { update(signal.aborted ? "cancelled" : "failed", undefined, signal.aborted ? undefined : String(error?.message || error).slice(0, 500)); stopOfflineService(); throw error; }).finally(() => { controller = null; preparation = null; });
  return preparation;
}
export async function offlineTranslateBatch(texts: string[], target: string, source = "en", signal?: AbortSignal): Promise<string[]> {
  assertNotCancelled(signal);
  if (!/^zh(?:-CN|-Hans)?$/i.test(target) || !/^(?:en(?:-\w+)?|auto)$/i.test(source)) throw new Error(getString("offline-language"));
  if (preparation || !(await getOfflineStatus()).ready) throw new Error(getString("offline-not-ready"));
  if (!serving || !process?.isRunning) {
    if (!launch) launch = (async () => { if (!await validNode()) throw new Error(getString("offline-checksum-failed")); return serving = await runWorker(false); })().finally(() => { launch = null; });
    await launch;
  }
  const response = await fetch(`http://127.0.0.1:${serving!.port}/translate/batch`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${serving!.token}` }, body: JSON.stringify({ texts, from: "en", to: "zh-Hans" }), signal: combineSignal(signal, 180000) });
  if (!response.ok) throw new Error(getString("offline-translation-failed"));
  const data: any = await response.json();
  if (!Array.isArray(data.translations) || data.translations.length !== texts.length || data.translations.some((s: any) => typeof s !== "string" || !s.trim())) throw new Error(getString("offline-translation-failed"));
  return data.translations;
}

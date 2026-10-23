// Plugin-owned MTranServer 5.0.1 adapter. No system runtime or shell is used.
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prepareModelAssets } from "./modelDownload.mjs";
const config = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
let reports = Promise.resolve();
const report = value => reports = reports.then(async () => { const temp = config.status + ".tmp"; await fs.writeFile(temp, JSON.stringify(value)); await fs.rename(temp, config.status); });
const parentWatch = setInterval(() => { try { process.kill(config.parentPID, 0); } catch (error) { writeFileSync(config.status, JSON.stringify({ phase: "failed", error: `Host process is unavailable (${error.code})` })); process.exit(0); } }, 1000);
parentWatch.unref();
let engine, server, nativeRuntime;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function inventory(dir, base = dir) {
  const files = {};
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Unexpected model symlink");
    if (entry.isDirectory()) Object.assign(files, await inventory(full, base));
    else if (!/\.(download|unpacked|tmp|lock)$/.test(entry.name)) files[path.relative(base, full)] = hash(await fs.readFile(full));
  }
  return files;
}
try {
  // Windows may otherwise bind against its older System32 ONNX runtime.
  // Explicitly load the npm-locked DLL first, using a Unicode path, and keep it
  // alive for both the main thread and MTran's inference workers.
  const { default: koffi } = await import(pathToFileURL(path.join(config.root, "node_modules/koffi/index.js")).href);
  nativeRuntime = koffi.load(path.join(config.root, "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime.dll"));
  const { MTran } = await import(pathToFileURL(path.join(config.root, "node_modules/mtranserver/dist/index.js")).href);
  engine = new MTran({ homeDir: config.root, configDir: path.join(config.root, "config"), modelDir: path.join(config.root, "models"),
    enableOfflineMode: true, checkUpdate: false, logToFile: false, logConsole: false, logRequests: false,
    host: "127.0.0.1", workersPerLanguage: 1, cacheSize: 0 });
  if (config.prepare) {
    await report({ phase: "models" });
    const modelDir = path.join(config.root, "models", "en_zh-Hans");
    for (const name of await fs.readdir(modelDir).catch(() => [])) {
      if (/^\.model\.[a-f0-9-]+\.onnx$/i.test(name)) await fs.rm(path.join(modelDir, name), { force: true });
    }
    await prepareModelAssets(config.root, { report });
    await report({ phase: "initializing" });
    await engine.init();
    await engine.downloadModel("en", "zh-Hans");
    await report({ phase: "trial" });
    const text = await engine.translate("en", "zh-Hans", "The results do not support the hypothesis.");
    if (!text?.trim() || !/[\u3400-\u9fff]/.test(text)) throw new Error("Offline trial returned no Chinese translation");
    const files = await inventory(path.join(config.root, "models"));
    await fs.writeFile(path.join(config.root, "ready.json"), JSON.stringify({ version: 1, mtran: "5.0.1", node: "24.22.1", files, text }));
    await engine.close(); await report({ phase: "ready", text }); process.exit(0);
  }
  // Verify the model inventory before every fresh offline process.
  const ready = JSON.parse(await fs.readFile(path.join(config.root, "ready.json"), "utf8"));
  for (const [relative, digest] of Object.entries(ready.files)) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Invalid model manifest path");
    if (hash(await fs.readFile(path.join(config.root, "models", relative))) !== digest) throw new Error("Offline model checksum mismatch; prepare again");
  }
  // A prepared process has no reason to contact a remote endpoint.
  globalThis.fetch = async () => { throw new Error("Network is disabled for offline translation"); };
  await engine.init();
  server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== `Bearer ${config.token}`) { res.writeHead(401).end("{}"); return; }
    if (req.url === "/health") { res.end(JSON.stringify({ nonce: config.token, offline: true })); return; }
    if (req.method !== "POST" || req.url !== "/translate/batch") { res.writeHead(404).end("{}"); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error("Request too large"); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks));
      if (!Array.isArray(input.texts) || input.texts.length > 64 || input.texts.some(s => typeof s !== "string") || input.to !== "zh-Hans" || !["en", "auto"].includes(input.from)) throw new Error("Only English to Simplified Chinese is prepared");
      const translations = [];
      for (const text of input.texts) translations.push(await engine.translate("en", "zh-Hans", text));
      res.end(JSON.stringify({ translations, failedIndices: [] }));
    } catch (error) { res.writeHead(500).end(JSON.stringify({ error: String(error.message) })); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  await report({ phase: "serving", port: server.address().port, pid: process.pid });
} catch (error) {
  await report({ phase: "failed", error: String(error.message).slice(0, 500) });
  await engine?.close?.().catch(() => {}); process.exit(1);
}

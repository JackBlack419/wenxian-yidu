// QA helper: pass a JSON argument to the real-machine probe without the
// PowerShell native-argument quoting that strips inner double quotes.
// Usage: node .verify/send.mjs <action> [json-file|inline-json]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, , action, raw] = process.argv;
if (!action) {
  console.error("usage: node .verify/send.mjs <action> [json-file|inline-json]");
  process.exit(1);
}
let json = raw;
if (raw && fs.existsSync(path.resolve(raw))) json = fs.readFileSync(path.resolve(raw), "utf8").trim();
const args = ["scripts/qa/real-machine.mjs", "send", action];
if (json !== undefined) args.push(json);
const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: process.cwd() });
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
process.exit(r.status ?? 1);

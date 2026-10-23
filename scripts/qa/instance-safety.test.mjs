import test from "node:test";
import assert from "node:assert/strict";
import { ownsInstance, profileArgument, assertInsideQa } from "./instance-safety.mjs";
const executable = "D:\\software\\Zetero\\zotero.exe";
const profile = "E:\\workspace 中文\\.qa\\profile";
const own = { ProcessId: 2345, ExecutablePath: executable, CommandLine: `"${executable}" -no-remote -profile "${profile}" --dataDir "E:\\workspace 中文\\.qa\\data"` };
test("only exact executable and exact quoted profile authorize shutdown", () => {
  assert.equal(ownsInstance(own, executable, profile), true);
  assert.equal(ownsInstance({...own, ExecutablePath:"C:\\other\\zotero.exe"}, executable, profile), false);
  assert.equal(ownsInstance({...own, CommandLine:own.CommandLine.replace(profile, profile+"-other")}, executable, profile), false);
  assert.equal(ownsInstance({...own, CommandLine:`zotero.exe -profile C:\\user -dataDir "${profile}"`}, executable, profile), false);
  assert.equal(ownsInstance({...own, CommandLine:null}, executable, profile), false);
  assert.equal(ownsInstance({...own, ProcessId:0}, executable, profile), false);
});
test("ambiguous or missing profile fails closed", () => {
  assert.equal(profileArgument(`-profile a -profile b`), null);
  assert.equal(profileArgument(`-profile -no-remote`), null);
  assert.equal(profileArgument(`-no-remote`), null);
  assert.equal(profileArgument(`-profile "C:\\qa\\profile`), null);
});
test("cleanup rejects QA root, sibling, and ancestor", () => {
  assert.ok(assertInsideQa(".qa", ".qa/profile"));
  assert.throws(()=>assertInsideQa(".qa", ".qa"));
  assert.throws(()=>assertInsideQa(".qa", ".qa-other/profile"));
  assert.throws(()=>assertInsideQa(".qa", ".qa/../data"));
});

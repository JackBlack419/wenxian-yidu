import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import path from "node:path";
import { extractWindowsZip } from "../../../../src/core/pdf/JavaRuntimeManager";
let names: string[];
let extracted: string[];
let closed: boolean;
beforeEach(() => {
  names = []; extracted = []; closed = false;
  const zip = { open: vi.fn(), findEntries: () => {
    let i = 0; return { hasMore: () => i < names.length, getNext: () => names[i++] };
  }, extract: (name: string, file: any) => { extracted.push(file.path); }, close: () => { closed = true; } };
  vi.stubGlobal("Components", { interfaces: { nsIFile: {}, nsIZipReader: {} }, classes: {
    "@mozilla.org/file/local;1": { createInstance: () => ({ path: "", initWithPath(p: string) { this.path = p; } }) },
    "@mozilla.org/libjar/zip-reader;1": { createInstance: () => zip },
  } });
  vi.stubGlobal("PathUtils", { join: path.win32.join });
  vi.stubGlobal("IOUtils", { makeDirectory: vi.fn(async () => {}), setPermissions: vi.fn(async () => {}) });
});
afterEach(() => vi.unstubAllGlobals());
describe("native Windows runtime extraction", () => {
  it("retains Chinese and space-containing paths without launching a shell", async () => {
    names = ["jdk-17/", "jdk-17/bin/java.exe", "jdk-17/legal/LICENSE"];
    await extractWindowsZip("E:\\中文目录 with spaces\\runtime.zip", "E:\\中文目录 with spaces\\staging");
    expect(extracted).toEqual(["E:\\中文目录 with spaces\\staging\\jdk-17\\bin\\java.exe", "E:\\中文目录 with spaces\\staging\\jdk-17\\legal\\LICENSE"]);
    expect(closed).toBe(true);
  });
  it.each(["../escape.exe", "jdk/../../escape.exe", "/absolute.exe", "C:/escape.exe", "jdk\\escape.exe"])("rejects an archive path outside its target: %s", async name => {
    names = [name];
    await expect(extractWindowsZip("E:\\runtime.zip", "E:\\target")).rejects.toThrow("无效路径");
    expect(extracted).toEqual([]); expect(closed).toBe(true);
  });
});

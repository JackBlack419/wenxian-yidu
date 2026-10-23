/**
 * 打包 XPI 安装下的 jar 解析与解压（src/core/pdf/OpenDataLoaderPdfClient.ts）。
 *
 * Zotero 以打包 .xpi 方式安装插件时，捆绑的 jar 在 zip 内部，磁盘探测必然
 * 落空——这是「解析组件缺失（未找到 jar 文件）」误报的根源。本套件伪造宿主
 * 边界（内存文件系统、假 nsIZipReader、假 Components 注册表），覆盖：
 *
 *   1. fileUrlFromJarUri：jar:file:…!/ 到 file: URL 的纯字符串还原。
 *   2. extractJarFromPackedXpi：全新解压 + 校验 + 暂存清理。
 *   3. 落地副本完好：复用，不重读 jar 条目。
 *   4. 落地副本损坏：重解压自愈。
 *   5. 校验和不符：拒绝落地并抛错。
 *   6. 旧构建无来源文件：跳过校验直接落地。
 *   7. zip 内没有该 jar：报「条目不存在」。
 *   8. getJarPath 端到端：解包目录优先；只有 .xpi 时走解压并进入会话备忘。
 *   9. getOdlJarStatus / installOdlJar：设置面板「解析组件」小节的只读状态
 *      检查与下载/修复入口（落地副本、内置、精简版缺失、离线失败）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  extractJarFromPackedXpi,
  fileUrlFromJarUri,
  getJarPath,
  getOdlJarStatus,
  installOdlJar,
} from "../../../../src/core/pdf/OpenDataLoaderPdfClient";

// ─── 内存文件系统（IOUtils 语义子集，Windows 分隔符）──────────────

class FakeFS {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();

  private registerAncestors(p: string): void {
    let idx = p.length;
    while ((idx = p.lastIndexOf("\\", idx - 1)) > 0) {
      this.dirs.add(p.slice(0, idx));
    }
  }

  exists(p: string): boolean {
    return this.files.has(p) || this.dirs.has(p);
  }
  isFile(p: string): boolean {
    return this.files.has(p);
  }
  isDirectory(p: string): boolean {
    return this.dirs.has(p);
  }
  read(p: string): Uint8Array {
    const v = this.files.get(p);
    if (v === undefined) throw new Error("NoSuchFile: " + p);
    return v;
  }
  write(p: string, data: Uint8Array): void {
    this.files.set(p, data);
    this.registerAncestors(p);
  }
  remove(p: string, opts: { ignoreAbsent?: boolean } = {}): void {
    if (this.files.has(p)) {
      this.files.delete(p);
      return;
    }
    if (this.dirs.has(p)) {
      for (const q of [...this.files.keys()]) {
        if (q.startsWith(p + "\\")) this.files.delete(q);
      }
      for (const q of [...this.dirs]) {
        if (q.startsWith(p + "\\")) this.dirs.delete(q);
      }
      this.dirs.delete(p);
      return;
    }
    if (!opts.ignoreAbsent) throw new Error("NoSuchFile: " + p);
  }
  move(src: string, dest: string): void {
    if (!this.exists(src)) throw new Error("NoSuchFile: " + src);
    if (this.exists(dest)) throw new Error("DestinationExists: " + dest);
    this.files.set(dest, this.files.get(src)!);
    this.files.delete(src);
    this.registerAncestors(dest);
  }
  makeDirectory(p: string, opts: { createAncestors?: boolean } = {}): void {
    if (this.dirs.has(p)) return;
    if (this.files.has(p)) throw new Error("FileExists: " + p);
    this.dirs.add(p);
    if (opts.createAncestors) this.registerAncestors(p);
  }
  /** 目录直接子项（用于断言暂存文件已清理）。 */
  children(dir: string): string[] {
    const prefix = dir.endsWith("\\") ? dir : dir + "\\";
    const names = new Set<string>();
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (!p.startsWith(prefix)) continue;
      const first = p.slice(prefix.length).split("\\")[0];
      if (first) names.add(prefix + first);
    }
    return [...names];
  }
}

// ─── 夹具 ────────────────────────────────────────────────────────

const DATA_DIR = "D:\\ZoteroData";
const PROFILE = "C:\\Users\\tester\\profile";
const EXT_DIR = PROFILE + "\\extensions";
const XPI_PATH = EXT_DIR + "\\wenxianyidu@wenxianyidu.local.xpi";
const UNPACKED_DIR = EXT_DIR + "\\wenxianyidu@wenxianyidu.local";
const ADDON_ID = "wenxianyidu@wenxianyidu.local";
const TMP_DIR = "C:\\Temp";

const JAR_BYTES = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8]);
const OTHER_BYTES = new Uint8Array([1, 1, 1, 1, 1]);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const jarEntryOf = (name: string) => `core/pdf/lib/${name}`;
const provEntryOf = (suffix: string) => `core/pdf/lib/PROVENANCE${suffix}.json`;
const utf8 = (s: string) => new TextEncoder().encode(s);

interface ZipRecord {
  entries: Map<string, Uint8Array>;
  opens: number;
  jarReads: number;
}
const zipRegistry = new Map<string, ZipRecord>();

let fs: FakeFS;
let extEntries: any[];
let loggedErrors: string[];

function zipRecordFor(xpiPath: string): ZipRecord {
  let rec = zipRegistry.get(xpiPath);
  if (!rec) {
    rec = { entries: new Map(), opens: 0, jarReads: 0 };
    zipRegistry.set(xpiPath, rec);
  }
  return rec;
}

function addJarEntry(
  xpiPath: string,
  jarName: string,
  bytes: Uint8Array = JAR_BYTES,
): void {
  zipRecordFor(xpiPath).entries.set(jarEntryOf(jarName), bytes);
}
function addProvenanceEntry(
  xpiPath: string,
  jarName: string,
  shaHex: string,
  suffix = "",
): void {
  zipRecordFor(xpiPath).entries.set(
    provEntryOf(suffix),
    utf8(JSON.stringify({ file: jarName, sha256: shaHex })),
  );
}

/** 带版本/坐标的完整 PROVENANCE（下载兜底与状态检查需要 version 字段）。 */
function addProvenanceMeta(
  xpiPath: string,
  jarName: string,
  shaHex: string,
  suffix = "",
): void {
  zipRecordFor(xpiPath).entries.set(
    provEntryOf(suffix),
    utf8(
      JSON.stringify({
        file: jarName,
        sha256: shaHex,
        version: "2.5.0",
        artifact: "org.opendataloader:opendataloader-pdf-cli:2.5.0",
      }),
    ),
  );
}

// ─── 宿主桩：Components / IOUtils / Zotero / PathUtils ───────────

function makeFakeNsIFile(initial = ""): any {
  const file = {
    path: initial,
    initWithPath(p: string) {
      this.path = p;
    },
    exists() {
      return fs.exists(this.path);
    },
    isFile() {
      return fs.isFile(this.path);
    },
    isDirectory() {
      return fs.isDirectory(this.path);
    },
    // readZipEntryText 的临时文件用法：clone → append → extract → remove。
    clone() {
      return makeFakeNsIFile(this.path);
    },
    append(name: string) {
      this.path = this.path ? this.path + "\\" + name : name;
    },
    remove() {
      fs.remove(this.path);
    },
    QueryInterface() {
      return file;
    },
  };
  return file;
}

/** extensions 目录下的一条目：leafName + isFile/isDirectory。 */
function makeExtEntry(leafName: string, kind: "file" | "dir"): any {
  const p = EXT_DIR + "\\" + leafName;
  const entry: any = {
    leafName,
    path: p,
    isFile: () => kind === "file",
    isDirectory: () => kind === "dir",
    QueryInterface() {
      return entry;
    },
  };
  return entry;
}

function makeEnumerator(items: any[]): any {
  let i = 0;
  return {
    hasMoreElements: () => i < items.length,
    getNext: () => items[i++],
  };
}

function buildGlobals(): void {
  const fakeComponents: any = {
    classes: {
      "@mozilla.org/file/local;1": {
        createInstance: () => makeFakeNsIFile(),
      },
      "@mozilla.org/libjar/zip-reader;1": {
        createInstance: () => ({
          _rec: null as ZipRecord | null,
          open(f: any) {
            const rec = zipRegistry.get(f.path);
            if (!rec) throw new Error("cannot open zip: " + f.path);
            this._rec = rec;
            rec.opens++;
          },
          hasEntry(e: string) {
            return !!this._rec?.entries.has(e);
          },
          getEntry(e: string) {
            if (!this._rec?.entries.has(e)) throw new Error("no entry: " + e);
            return { name: e };
          },
          // 真实宿主（Gecko 140）的 nsIZipReader 没有 getEntries()：条目枚举
          // 只有 findEntries(pattern)，返回 hasMore()/getNext() 迭代器，
          // getNext 给出条目名字符串。
          findEntries(_pattern: string) {
            const names = [...(this._rec?.entries.keys() ?? [])];
            let i = 0;
            return {
              hasMore: () => i < names.length,
              getNext: () => names[i++],
            };
          },
          // extract(entry, nsIFile)：把条目字节直接写到目标路径。jar 条目的
          // 解压次数沿用 jarReads 计数（复用路径不得重读 jar 字节）。
          extract(e: string, f: any) {
            const bytes = this._rec?.entries.get(e);
            if (!bytes) throw new Error("no entry: " + e);
            if (e.endsWith(".jar")) this._rec!.jarReads++;
            fs.write(f.path, bytes);
          },
          close() {},
        }),
      },
      "@mozilla.org/file/directory_service;1": {
        getService: () => ({
          get(name: string) {
            if (name !== "ProfD") throw new Error("unknown dir: " + name);
            return {
              path: PROFILE,
              clone() {
                return {
                  path: PROFILE,
                  append(n: string) {
                    this.path += "\\" + n;
                  },
                  // extensions 目录在所有场景下都视为存在，与被播种的
                  // jar 文件无关。
                  exists: () => true,
                  isDirectory: () => true,
                  get directoryEntries() {
                    return makeEnumerator(extEntries);
                  },
                };
              },
            };
          },
        }),
      },
    },
    interfaces: {
      nsIFile: {},
      nsIZipReader: {},
      nsIBinaryInputStream: {},
      nsISupportsCString: {},
      nsIProperties: {},
      nsIFileURL: {},
    },
    results: { NS_NOINTERFACE: 0x80004002 },
  };

  (globalThis as any).Components = fakeComponents;
  (globalThis as any).IOUtils = {
    exists: async (p: string) => fs.exists(p),
    read: async (p: string) => fs.read(p),
    write: async (p: string, data: Uint8Array) => fs.write(p, data),
    remove: async (p: string, opts?: any) => fs.remove(p, opts),
    move: async (s: string, d: string) => fs.move(s, d),
    makeDirectory: async (p: string, opts?: any) => fs.makeDirectory(p, opts),
    setPermissions: async () => {},
  };
  (globalThis as any).PathUtils = {
    join: (...p: string[]) => path.win32.join(...p),
  };
  (globalThis as any).Zotero = {
    isWin: true,
    DataDirectory: { dir: DATA_DIR },
    logError: (e: unknown) => loggedErrors.push(String(e)),
    // readZipEntryText 把 zip 内小条目解到临时目录后按文本读回。
    getTempDirectory: () => makeFakeNsIFile(TMP_DIR),
    File: {
      getContents: (f: any) => new TextDecoder().decode(fs.read(f.path)),
    },
  };
}

const GLOBAL_KEYS = ["Components", "IOUtils", "PathUtils", "Zotero"] as const;
let savedGlobals: Record<string, unknown> = {};

beforeEach(() => {
  fs = new FakeFS();
  zipRegistry.clear();
  extEntries = [];
  loggedErrors = [];
  savedGlobals = {};
  for (const k of GLOBAL_KEYS) {
    savedGlobals[k] = (globalThis as any)[k];
  }
  buildGlobals();
});

afterEach(() => {
  for (const k of GLOBAL_KEYS) {
    if (savedGlobals[k] === undefined) {
      delete (globalThis as any)[k];
    } else {
      (globalThis as any)[k] = savedGlobals[k];
    }
  }
});

// ─── fileUrlFromJarUri（纯字符串逻辑）────────────────────────────

describe("fileUrlFromJarUri", () => {
  it("从 jar:file:…!/ 形式还原内层 file: URL（百分号编码原样保留）", () => {
    expect(fileUrlFromJarUri("jar:file:///C:/Users/a%40b.org.xpi!/")).toBe(
      "file:///C:/Users/a%40b.org.xpi",
    );
  });

  it("容忍缺省的 !/ 后缀", () => {
    expect(fileUrlFromJarUri("jar:file:///C:/x.xpi")).toBe("file:///C:/x.xpi");
  });

  it("解包安装的 file: URI、resource: URI 与空值返回 null", () => {
    expect(fileUrlFromJarUri("file:///D:/repo/.scaffold/build/addon/")).toBeNull();
    expect(fileUrlFromJarUri("resource://wenxianyidu@wenxianyidu.local/")).toBeNull();
    expect(fileUrlFromJarUri("")).toBeNull();
    expect(fileUrlFromJarUri(undefined)).toBeNull();
    expect(fileUrlFromJarUri(null)).toBeNull();
  });
});

// ─── extractJarFromPackedXpi（伪造宿主边界）──────────────────────

describe("extractJarFromPackedXpi", () => {
  const JAR = "parser-test.jar";

  it("全新解压：字节落地、哈希核对通过、暂存文件清理", async () => {
    addJarEntry(XPI_PATH, JAR);
    addProvenanceEntry(XPI_PATH, JAR, sha256(JAR_BYTES));

    const target = await extractJarFromPackedXpi(XPI_PATH, JAR);

    expect(target).toBe(
      path.win32.join(DATA_DIR, "wenxianyidu", "lib", JAR),
    );
    expect([...fs.read(target)]).toEqual([...JAR_BYTES]);
    const rec = zipRegistry.get(XPI_PATH)!;
    expect(rec.jarReads).toBe(1);
    const libDir = path.win32.join(DATA_DIR, "wenxianyidu", "lib");
    for (const child of fs.children(libDir)) {
      expect(child).not.toContain(".staging-");
    }
  });

  it("落地副本完好：哈希匹配即复用，不再读取 jar 条目", async () => {
    addJarEntry(XPI_PATH, JAR);
    addProvenanceEntry(XPI_PATH, JAR, sha256(JAR_BYTES));
    const target = path.win32.join(DATA_DIR, "wenxianyidu", "lib", JAR);
    fs.write(target, JAR_BYTES);
    zipRecordFor(XPI_PATH); // opens = 0

    const out = await extractJarFromPackedXpi(XPI_PATH, JAR);

    expect(out).toBe(target);
    const rec = zipRegistry.get(XPI_PATH)!;
    expect(rec.opens).toBe(1); // 只打开一次 zip 用于核对来源
    expect(rec.jarReads).toBe(0); // jar 字节未重读
  });

  it("落地副本损坏：重解压自愈", async () => {
    addJarEntry(XPI_PATH, JAR);
    addProvenanceEntry(XPI_PATH, JAR, sha256(JAR_BYTES));
    const target = path.win32.join(DATA_DIR, "wenxianyidu", "lib", JAR);
    fs.write(target, OTHER_BYTES); // 损坏 / 截断的旧副本

    const out = await extractJarFromPackedXpi(XPI_PATH, JAR);

    expect(out).toBe(target);
    expect([...fs.read(target)]).toEqual([...JAR_BYTES]);
    expect(zipRegistry.get(XPI_PATH)!.jarReads).toBe(1);
  });

  it("校验和不符：拒绝落地并抛错", async () => {
    addJarEntry(XPI_PATH, JAR);
    addProvenanceEntry(XPI_PATH, JAR, sha256(OTHER_BYTES)); // 声明与实际不符
    await expect(extractJarFromPackedXpi(XPI_PATH, JAR)).rejects.toThrow(
      /checksum mismatch/,
    );
    expect(
      fs.exists(path.win32.join(DATA_DIR, "wenxianyidu", "lib", JAR)),
    ).toBe(false);
  });

  it("旧构建无来源文件：跳过校验直接落地", async () => {
    addJarEntry(XPI_PATH, JAR); // 没有 PROVENANCE*.json
    const target = await extractJarFromPackedXpi(XPI_PATH, JAR);
    expect([...fs.read(target)]).toEqual([...JAR_BYTES]);
  });

  it("zip 内没有该 jar：报条目不存在", async () => {
    addProvenanceEntry(XPI_PATH, JAR, sha256(JAR_BYTES));
    await expect(extractJarFromPackedXpi(XPI_PATH, JAR)).rejects.toThrow(
      /not found in/,
    );
  });
});

// ─── getJarPath 端到端（扫描 + 解压 + 会话备忘）──────────────────

describe("getJarPath（打包安装）", () => {
  it("解包目录存在时优先返回目录内 jar，.xpi 文件被跳过", async () => {
    const jarName = "opendataloader-pdf-cli.jar";
    const dirJar = UNPACKED_DIR + "\\core\\pdf\\lib\\" + jarName;
    fs.write(dirJar, JAR_BYTES);
    extEntries.push(
      makeExtEntry(ADDON_ID + ".xpi", "file"),
      makeExtEntry(ADDON_ID, "dir"),
    );

    const out = await getJarPath(jarName);

    expect(out).toBe(dirJar);
    // 没有触发解压：zip 注册表为空，数据目录未落地任何文件
    expect(zipRegistry.size).toBe(0);
    expect(
      fs.exists(path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName)),
    ).toBe(false);
  });

  it("只有打包 .xpi 时解压兜底生效，再次调用命中会话备忘", async () => {
    const jarName = "packed-parser.jar";
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addJarEntry(XPI_PATH, jarName);
    addProvenanceEntry(XPI_PATH, jarName, sha256(JAR_BYTES));

    const first = await getJarPath(jarName);
    expect(first).toBe(path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName));
    expect([...fs.read(first)]).toEqual([...JAR_BYTES]);
    expect(zipRegistry.get(XPI_PATH)!.opens).toBe(1);

    // 第二次调用：会话备忘直接命中，不再打开 zip
    const second = await getJarPath(jarName);
    expect(second).toBe(first);
    expect(zipRegistry.get(XPI_PATH)!.opens).toBe(1);
  });

  it("落地副本被破坏后重解压自愈", async () => {
    const jarName = "corrupt-remover.jar";
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addJarEntry(XPI_PATH, jarName);
    addProvenanceEntry(XPI_PATH, jarName, sha256(JAR_BYTES));
    const target = path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName);
    fs.write(target, OTHER_BYTES);

    const out = await getJarPath(jarName);

    expect(out).toBe(target);
    expect([...fs.read(target)]).toEqual([...JAR_BYTES]);
  });

  it("解压失败（校验和不符）时回退到原路径并上报错误", async () => {
    const jarName = "mismatched.jar";
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addJarEntry(XPI_PATH, jarName);
    addProvenanceEntry(XPI_PATH, jarName, sha256(OTHER_BYTES)); // 与实际不符

    const out = await getJarPath(jarName);

    // baseDir 为空 → 原兜底相对路径；解压失败细节已上报
    expect(out).toBe(".\\core\\pdf\\lib\\" + jarName);
    expect(loggedErrors.join("\n")).toMatch(/checksum mismatch/);
    expect(
      fs.exists(path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName)),
    ).toBe(false);
  });
});

// ─── getOdlJarStatus / installOdlJar（设置面板的组件检查与修复入口）───

describe("getOdlJarStatus / installOdlJar（解析组件修复入口）", () => {
  it("落地副本指纹相符：present + landed + 版本号", async () => {
    const jarName = "status-landed.jar";
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addProvenanceMeta(XPI_PATH, jarName, sha256(JAR_BYTES));
    const target = path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName);
    fs.write(target, JAR_BYTES);

    const status = await getOdlJarStatus(jarName);

    expect(status.present).toBe(true);
    expect(status.stale).toBe(false);
    expect(status.source).toBe("landed");
    expect(status.version).toBe("2.5.0");
    expect(status.path).toBe(target);
  });

  it("落地副本指纹不符：present false + stale（解析时会自动重新获取）", async () => {
    const jarName = "status-stale.jar";
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addProvenanceMeta(XPI_PATH, jarName, sha256(JAR_BYTES));
    fs.write(
      path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName),
      OTHER_BYTES,
    );

    const status = await getOdlJarStatus(jarName);

    expect(status.present).toBe(false);
    expect(status.stale).toBe(true);
  });

  it("精简版打包安装且无落地副本：present false，版本号仍可读出", async () => {
    const jarName = "status-missing.jar";
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addProvenanceMeta(XPI_PATH, jarName, sha256(JAR_BYTES));

    const status = await getOdlJarStatus(jarName);

    expect(status.present).toBe(false);
    expect(status.version).toBe("2.5.0");
  });

  it("完整版打包安装（XPI 内置 jar）：present + bundled", async () => {
    const jarName = "status-bundled.jar";
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addJarEntry(XPI_PATH, jarName);
    addProvenanceMeta(XPI_PATH, jarName, sha256(JAR_BYTES));

    const status = await getOdlJarStatus(jarName);

    expect(status.present).toBe(true);
    expect(status.source).toBe("bundled");
    expect(status.version).toBe("2.5.0");
  });

  it("allowDownload:false 的状态路径不发起任何网络请求", async () => {
    const jarName = "status-nodownload.jar";
    let httpCalls = 0;
    (globalThis as any).Zotero.HTTP = {
      request: async () => {
        httpCalls++;
        throw new Error("offline");
      },
    };
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addProvenanceMeta(XPI_PATH, jarName, sha256(JAR_BYTES));

    const out = await getJarPath(jarName, { allowDownload: false });

    expect(out).toBe(".\\core\\pdf\\lib\\" + jarName);
    expect(httpCalls).toBe(0);
    expect(
      fs.exists(path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName)),
    ).toBe(false);
  });

  it("落地副本完好时修复入口直接返回，不读 jar 条目、不弹下载", async () => {
    const jarName = "repair-healthy.jar";
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addProvenanceMeta(XPI_PATH, jarName, sha256(JAR_BYTES));
    const target = path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName);
    fs.write(target, JAR_BYTES);
    zipRecordFor(XPI_PATH); // opens = 0

    const out = await installOdlJar(jarName);

    expect(out).toBe(target);
    const rec = zipRegistry.get(XPI_PATH)!;
    // 打开 zip 只允许是为了读 PROVENANCE 指纹（核对落地副本），jar 条目本身
    // 不得重读（无解压），数据目录也不得出现暂存文件。
    expect(rec.jarReads).toBe(0);
    for (const child of fs.children(path.win32.join(DATA_DIR, "wenxianyidu", "lib"))) {
      expect(child).not.toContain(".staging-");
    }
  });

  it("落地副本损坏且 XPI 内置：修复即重解压自愈", async () => {
    const jarName = "repair-corrupt.jar";
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addJarEntry(XPI_PATH, jarName);
    addProvenanceMeta(XPI_PATH, jarName, sha256(JAR_BYTES));
    const target = path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName);
    fs.write(target, OTHER_BYTES);

    const out = await installOdlJar(jarName);

    expect([...fs.read(out)]).toEqual([...JAR_BYTES]);
  });

  it("精简版且镜像全部不可达：修复入口抛错并携带下载失败细节", async () => {
    const jarName = "repair-offline.jar";
    let httpCalls = 0;
    (globalThis as any).Zotero.HTTP = {
      request: async () => {
        httpCalls++;
        throw new Error("offline");
      },
    };
    extEntries.push(makeExtEntry(ADDON_ID + ".xpi", "file"));
    addProvenanceMeta(XPI_PATH, jarName, sha256(JAR_BYTES));

    await expect(installOdlJar(jarName)).rejects.toThrow(
      /ODL jar provision failed/,
    );
    expect(httpCalls).toBeGreaterThan(0); // 修复确实发起过下载尝试
    expect(
      fs.exists(path.win32.join(DATA_DIR, "wenxianyidu", "lib", jarName)),
    ).toBe(false);
  });
});

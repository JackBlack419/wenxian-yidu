/**
 * classifyJarError — 组件错误的两类签名（src/core/pdf/jarErrorKind.ts）。
 *
 * 背景：friendlyOdlError 曾用裸 `includes("jar")` 判定，任何提到 jar 的
 * 错误都被改写成「解析组件缺失，请重新安装插件」。本套件锁定新的两类
 * 签名（缺失 / 不可读），并锁定「运行中 JVM 的堆栈等一律不判为组件错误」。
 */
import { describe, it, expect } from "vitest";
import { classifyJarError } from "../../../../src/core/pdf/jarErrorKind";

describe("classifyJarError — 缺失（missing）", () => {
  const missing = [
    // runOpenDataLoader 的原始报告
    "JAR file not found at C:\\ext\\wenxianyidu@wenxianyidu.local\\core\\pdf\\lib\\opendataloader-pdf-cli.jar. Please ensure opendataloader-pdf-cli.jar is present.",
    // PdfParseError("jar-missing") 的英文提示
    "OpenDataLoader JAR is missing. Reinstall 文献译读 to restore opendataloader-pdf-cli.jar.",
    // zh-CN 文案被外层错误重新包装后再进入分类
    "翻译失败：OpenDataLoader 解析组件缺失（未找到 jar 文件），请重新安装插件。",
  ];
  it.each(missing)("识别为缺失：%s", (msg) => {
    expect(classifyJarError(msg)).toBe("missing");
  });
});

describe("classifyJarError — 不可读（unreadable）", () => {
  const unreadable = [
    // JVM 启动器的标准报错：文件在，Java 打不开
    "Error: Unable to access jarfile C:\\ext\\core\\pdf\\lib\\opendataloader-pdf-cli.jar",
    // err-jar-load（en-US / zh-CN）
    "Could not read the parsing component jar file (invalid path): C:\\x",
    "无法读取解析组件 jar 文件（路径非法）：C:\\x",
  ];
  it.each(unreadable)("识别为不可读：%s", (msg) => {
    expect(classifyJarError(msg)).toBe("unreadable");
  });
});

describe("classifyJarError — 非组件错误返回 null", () => {
  const others = [
    // 运行中 JVM 的堆栈恰好带着 jar 字样
    'Exception in thread "main" java.lang.IllegalStateException while reading entry',
    // URL / 文本中的 jar 子串
    "GET https://example.com/downloads/jar-list failed: network unreachable",
    "Parse timed out (300s)",
    // 与组件无关的普通解析失败
    "No .json output found in C:\\Users\\ADMINI~1\\Temp\\wenxianyidu-odl-1",
    "",
  ];
  it.each(others)("不误判：%s", (msg) => {
    expect(classifyJarError(msg)).toBeNull();
  });
});

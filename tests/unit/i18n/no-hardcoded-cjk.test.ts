/**
 * 中文首版的语言边界守卫：继承的多语言阅读界面继续使用 FTL。
 * （自 z-search 的 no-hardcoded-cjk 测试移植）。
 *
 * 本版目标是中文产品，新增配置指引、任务界面和服务错误允许中文直写；
 * 不据此放弃继承界面的 Fluent 约束。允许范围逐文件登记，品牌和调试
 * 日志独立排除。no-dead-keys 同时检查中英键集一致和动态键引用。
 *
 * 用 TypeScript 扫描器而非正则：源码注释里大量出现中文与引号样例，朴素的
 * 注释剥离或整行正则会制造大量误报；扫描器只看字符串字面量与模板串文本，
 * 注释天然不在扫描范围。
 *
 * 白名单（file -> 理由）：
 *  - src/core/pdf/platform.ts：macOS 字体文件路径（ヒラギノ角ゴシック W3.ttc
 *    等）是文件系统数据，不是界面文案。
 *  - src/core/pdf/splitViewFactory.ts：Java 缺失与网络错误的跨平台签名判定
 *    （匹配 Java 报错原文与简体/繁体系统文案），是分类用的数据，不是展示。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

const ALLOWLIST: Readonly<Record<string, string>> = {
  "src/core/pdf/platform.ts": "font file paths on macOS (filesystem data)",
  "src/core/pdf/splitview/splitViewFactory.ts":
    "cross-platform error-signature match patterns (simplified/traditional system messages), not UI text",
  "addon/content/preferences.js": "Chinese-first onboarding, official-account setup cards and diagnostic guidance in this release",
  "src/core/translation/providerAdapters.ts": "Chinese-first provider validation and actionable service errors",
  "src/core/translation/requestCoordinator.ts": "Chinese-first cancellation and request-budget errors",
  "src/core/translation/translationService.ts": "Chinese-first segment validation errors shared by all modes",
  "src/core/translation/translationEngines.ts": "Chinese-first configured-engine diagnostics; inherited reader UI stays Fluent",
  "src/core/ai/openaiCompat.ts": "Chinese-first endpoint validation and incomplete-response diagnostics",
  "src/utils/credentials.ts": "Chinese-first secure storage errors, with no credentials in their messages",
  "src/core/pdf/JavaRuntimeManager.ts": "Chinese-first native ZIP validation and offline runtime installation errors",
  "src/core/pdf/translation/documentJobs.ts": "Chinese-first durable task stages and source-file diagnostics",
  "src/core/pdf/translation/opendataloaderSplitAdapter.ts": "Chinese-first task progress and explicitly marked incomplete output",
  "src/modules/registerDocumentTasks.ts": "Chinese-first standalone document-task management UI",
  "src/core/pdf/OpenDataLoaderPdfClient.ts": "Chinese-first offline JAR provenance and checksum validation errors",
  "src/modules/registerItemTreeMenu.ts": "Chinese-first cancellation and resume guidance for document tasks",
};

/** CJK 统一表意符号基本区（简体/繁体/日本汉字都在内）。 */
const CJK = /[一-鿿]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (["node_modules", ".git", ".scaffold", "locale"].includes(entry)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js)$/.test(entry)) out.push(p);
  }
  return out;
}

interface Offender {
  file: string;
  line: number;
  kind: string;
  text: string;
}

/** 用 TS 扫描器收集「字符串字面量 / 模板串文本」里的 CJK。 */
function scan(file: string, src: string): Offender[] {
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: Offender[] = [];
  const check = (text: string, kind: string, node: ts.Node) => {
    if (!CJK.test(text)) return;
    if (!CJK.test(text.replaceAll("文献译读", "")) || text === "已取消翻译") return;
    if (text === "文献译读" || /^\[文献译读(?:\]|\s)/.test(text) || /^文献译读:/.test(text)) return;
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({
      file,
      line: pos.line + 1,
      kind,
      text: text.trim().slice(0, 60),
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) check(node.text, "string", node);
    else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      check(node.text, "template", node);
    } else if (ts.isTemplateExpression(node)) {
      check(node.head.text, "template", node);
      for (const span of node.templateSpans)
        check(span.literal.text, "template", span);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("i18n：中文首版保留继承阅读界面的 Fluent 约束", () => {
  it("中文产品模块和品牌日志之外，界面文案仍来自 FTL", () => {
    const roots = [join(REPO, "src"), join(REPO, "addon")];
    const offenders: Offender[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const rel = relative(REPO, file).split("\\").join("/");
        if (ALLOWLIST[rel]) continue;
        offenders.push(...scan(rel, readFileSync(file, "utf-8")));
      }
    }
    expect(
      offenders.map(
        (o) => `${o.file}:${o.line} [${o.kind}] ${JSON.stringify(o.text)}`,
      ),
      "界面文案必须移入 FTL（zh-CN / en-US）——见本文件头注",
    ).toEqual([]);
  });

  it("白名单条目必须附理由且文件真实存在", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `${file} 需要登记理由`).toBeGreaterThan(10);
      expect(statSync(join(REPO, file)).isFile(), `${file} 仍应存在`).toBe(
        true,
      );
    }
  });
});

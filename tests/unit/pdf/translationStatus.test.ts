import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_TRANSLATION_STATUS,
  getTranslationStatus,
  isResumableStatus,
  resetTranslationStatus,
  subscribeTranslationStatus,
  toolbarButtonText,
  toolbarFailureSuffix,
  updateTranslationStatus,
  releaseTranslationSession,
  type TranslationStatus,
} from "../../../src/core/pdf/splitview/translationStatus";

describe("reading-session lifetime", () => {
  it("reopening after a terminal failure starts idle while an active task stays running", () => {
    resetTranslationStatus();
    updateTranslationStatus({ sourceItemID: 1, phase: "partial", failed: 5 });
    releaseTranslationSession(1);
    expect(getTranslationStatus(1).phase).toBe("idle");
    updateTranslationStatus({ sourceItemID: 2, phase: "running", done: 3, total: 10 });
    releaseTranslationSession(2);
    expect(getTranslationStatus(2).phase).toBe("running");
    resetTranslationStatus();
  });
});

/** 一个只认这几个键的假翻译函数：断言「用哪个 FTL 键 + 什么参数」。 */
function fakeT(): {
  t: (id: string, args?: Record<string, unknown>) => string;
  calls: Array<[string, Record<string, unknown> | undefined]>;
} {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  return {
    calls,
    t: (id, args) => {
      calls.push([id, args]);
      if (id === "toolbar-progress-running") return `翻译中 ${args?.done}/${args?.total}`;
      if (id === "toolbar-progress-starting") return "翻译中…";
      if (id === "toolbar-progress-failed") return `失败 ${args?.failed} 段`;
      if (id === "toolbar-resume") return "继续翻译";
      return "翻译";
    },
  };
}

function status(patch: Partial<TranslationStatus>): TranslationStatus {
  return { ...INITIAL_TRANSLATION_STATUS, ...patch };
}

describe("工具栏可见状态（translationStatus）", () => {
  beforeEach(() => {
    resetTranslationStatus();
  });

  it("默认是 idle，且按钮显示「翻译」", () => {
    expect(getTranslationStatus().phase).toBe("idle");
    const { t } = fakeT();
    expect(toolbarButtonText(getTranslationStatus(), t)).toBe("翻译");
    expect(toolbarFailureSuffix(getTranslationStatus(), t)).toBe("");
  });

  it("运行中显示「翻译中 7/18」，有失败段落再缀「 · 失败 5 段」", () => {
    const { t } = fakeT();
    const s = status({ phase: "running", done: 7, total: 18, failed: 0 });
    expect(toolbarButtonText(s, t)).toBe("翻译中 7/18");
    expect(toolbarFailureSuffix(s, t)).toBe("");
    expect(toolbarFailureSuffix({ ...s, failed: 5 }, t)).toBe(" · 失败 5 段");
  });

  it("解析阶段还不知道总段数时显示「翻译中…」，不显示 0/0", () => {
    const { t } = fakeT();
    expect(toolbarButtonText(status({ phase: "running" }), t)).toBe("翻译中…");
  });

  it("取消 / 失败后按钮恢复「翻译」，菜单仍可继续", () => {
    const { t } = fakeT();
    for (const phase of ["cancelled", "failed"] as const) {
      const s = status({ phase, done: 7, total: 18, failed: 0 });
      expect(toolbarButtonText(s, t)).toBe("翻译");
      expect(isResumableStatus(s)).toBe(true);
    }
  });

  it("部分完成按钮恢复翻译，菜单仍可补译", () => {
    const { t } = fakeT();
    const s = status({ phase: "partial", done: 13, total: 18, failed: 5 });
    expect(toolbarButtonText(s, t)).toBe("翻译");
    // 主文案已经是失败数，后缀不重复
    expect(toolbarFailureSuffix(s, t)).toBe("");
    expect(isResumableStatus(s)).toBe(true);
  });

  it("全部完成 / 空闲不可继续", () => {
    expect(isResumableStatus(status({ phase: "complete", done: 18, total: 18 }))).toBe(false);
    expect(isResumableStatus(status({ phase: "running" }))).toBe(false);
    expect(isResumableStatus(status({ phase: "idle" }))).toBe(false);
  });

  it("订阅者收到合并后的快照，退订后不再收到", () => {
    const seen: TranslationStatus[] = [];
    const off = subscribeTranslationStatus((s) => seen.push(s));
    updateTranslationStatus({ phase: "running", done: 1, total: 18, sourceItemID: 42 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ phase: "running", done: 1, total: 18, sourceItemID: 42 });
    off();
    updateTranslationStatus({ phase: "cancelled" });
    expect(seen).toHaveLength(1);
    expect(getTranslationStatus().phase).toBe("cancelled");
  });

  it("getTranslationStatus 返回副本，外部改不动内部状态", () => {
    const snapshot = getTranslationStatus();
    snapshot.done = 999;
    expect(getTranslationStatus().done).toBe(0);
  });

  it("按文档保留各自进度，重置时一起清除", () => {
    updateTranslationStatus({ sourceItemID: 11, phase: "cancelled", done: 3 });
    updateTranslationStatus({ sourceItemID: 22, phase: "running", done: 1 });
    expect(getTranslationStatus(11)).toMatchObject({ phase: "cancelled", done: 3 });
    expect(getTranslationStatus(22)).toMatchObject({ phase: "running", done: 1 });
    expect(getTranslationStatus(33).phase).toBe("idle");
    const snapshot = getTranslationStatus(11);
    snapshot.done = 999;
    expect(getTranslationStatus(11).done).toBe(3);
    resetTranslationStatus();
    expect(getTranslationStatus(11).phase).toBe("idle");
  });

  it("一个订阅者抛错不影响其他订阅者", () => {
    const spy = vi.fn();
    const offBad = subscribeTranslationStatus(() => {
      throw new Error("boom");
    });
    const offGood = subscribeTranslationStatus(spy);
    expect(() => updateTranslationStatus({ phase: "running" })).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});

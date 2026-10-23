/**
 * 菜单对勾的两个状态查询函数：
 *   - getActiveBilingualModeForItem（bilingualLauncher，真实实现，宿主依赖打桩：
 *     通过 startBilingualSession 驱动真实会话状态，再查询模式）；
 *   - findSplitTabForItem（splitViewCleanup，纯 stateMap 查询，直接填充状态）。
 *
 * 对勾语义在这里钉死：会话只在条目 id 完全相等时可见（-1 哨兵与会话外的
 * 条目一律不可见）；分屏查询按左右任一窗格的条目 id 匹配，窗格未完成挂载
 * （适配器无 item）时不命中也不抛错。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { enterBilingualSessionMock, exitBilingualSessionMock, buildInterleaveMock } =
  vi.hoisted(() => ({
    enterBilingualSessionMock: vi.fn(),
    exitBilingualSessionMock: vi.fn(),
    buildInterleaveMock: vi.fn(),
  }));

vi.mock("../../../../../src/core/pdf/sdt/sdtBridge", () => ({
  enterBilingualSession: enterBilingualSessionMock,
  exitBilingualSession: exitBilingualSessionMock,
}));

vi.mock("../../../../../src/core/pdf/sdt/interleaveView", () => ({
  buildInterleave: buildInterleaveMock,
}));

vi.mock("../../../../../src/core/translation/translationEngines", () => ({
  supportsBatching: () => false,
  createTranslator: () => async () => "x",
  createAIBatchTranslator: vi.fn(),
  engineCacheIdentity: () => "test-identity",
}));

import {
  getActiveBilingualModeForItem,
  startBilingualSession,
  stopBilingualSession,
  cancelBilingualTranslation,
} from "../../../../../src/core/pdf/sdt/bilingualLauncher";
import { getTranslationStatus } from "../../../../../src/core/pdf/splitview/translationStatus";
import { findSplitTabForItem } from "../../../../../src/core/pdf/splitview/splitViewCleanup";
import { stateMap } from "../../../../../src/core/pdf/splitview/splitViewSync";

/** 造一个可切换/查询模式的 InterleaveHandle 桩。 */
function makeHandleStub() {
  let currentMode: "interleave" | "transOnly" = "interleave";
  return {
    setMode: vi.fn((mode: "interleave" | "transOnly") => {
      currentMode = mode;
    }),
    getMode: vi.fn(() => currentMode),
    dispose: vi.fn(async () => {}),
  };
}

async function startSession(itemID: number, mode: "interleave" | "transOnly") {
  const handle = makeHandleStub();
  buildInterleaveMock.mockResolvedValue(handle);
  await startBilingualSession({
    reader: {},
    itemID,
    mode,
    targetLanguage: "zh-CN",
    cacheIdentity: "test-identity",
  });
  return handle;
}

beforeEach(() => {
  enterBilingualSessionMock.mockReset().mockResolvedValue({});
  exitBilingualSessionMock.mockReset().mockResolvedValue(undefined);
  buildInterleaveMock.mockReset();
  stateMap.clear();
});

afterEach(async () => {
  await stopBilingualSession();
  stateMap.clear();
});

describe("getActiveBilingualModeForItem — 菜单对勾的会话查询", () => {
  it("publishes contrast progress and retains cancellation against late progress", async () => {
    const handle = makeHandleStub(); buildInterleaveMock.mockResolvedValue(handle);
    await startBilingualSession({ reader: { _setReadingMode() {}, _loadSDT() {} }, itemID: 7, mode: "interleave", cacheIdentity: "test-identity" });
    const opts = buildInterleaveMock.mock.calls.at(-1)![1];
    opts.onProgress({ loading: 1, queued: 2, total: 4, done: 1, failed: 0 });
    expect(getTranslationStatus(7).phase).toBe("running");
    opts.onProgress({ loading: 0, queued: 0, total: 4, done: 4, failed: 0 });
    expect(getTranslationStatus(7).phase).toBe("complete");
    expect(cancelBilingualTranslation(7)).toBe(true);
    opts.onProgress({ loading: 0, queued: 0, total: 4, done: 4, failed: 0 });
    expect(getTranslationStatus(7).phase).toBe("cancelled");
    await stopBilingualSession(); expect(getTranslationStatus(7).phase).toBe("idle");
    opts.onProgress({ loading: 0, queued: 0, total: 4, done: 4, failed: 0 });
    expect(getTranslationStatus(7).phase).toBe("idle");
  });
  it("会话进行中按条目 id 返回当前模式，其他条目返回 null", async () => {
    await startSession(7, "interleave");
    expect(getActiveBilingualModeForItem(7)).toBe("interleave");
    expect(getActiveBilingualModeForItem(8)).toBeNull();
  });

  it("同条目切换模式后查询跟随新模式，且不重建会话", async () => {
    await startSession(7, "interleave");
    await startSession(7, "transOnly");
    expect(getActiveBilingualModeForItem(7)).toBe("transOnly");
    expect(enterBilingualSessionMock).toHaveBeenCalledTimes(1);
  });

  it("停止会话后返回 null；-1 哨兵与 undefined 输入恒为 null", async () => {
    await startSession(7, "interleave");
    await stopBilingualSession();
    expect(getActiveBilingualModeForItem(7)).toBeNull();
    expect(getActiveBilingualModeForItem(-1)).toBeNull();
    expect(getActiveBilingualModeForItem(undefined)).toBeNull();
    expect(getActiveBilingualModeForItem(null)).toBeNull();
  });

  it("会话在另一条目上启动时旧的查询随之失效", async () => {
    await startSession(7, "interleave");
    await startSession(9, "transOnly");
    expect(getActiveBilingualModeForItem(7)).toBeNull();
    expect(getActiveBilingualModeForItem(9)).toBe("transOnly");
  });
});

describe("findSplitTabForItem — 菜单对勾的分屏查询", () => {
  const setState = (tabID: string, leftID: number | undefined, rightID: number | undefined) => {
    stateMap.set(tabID, {
      tabID,
      ...(leftID !== undefined ? { leftAdapter: { item: { id: leftID } } } : {}),
      ...(rightID !== undefined
        ? { rightAdapter: { item: { id: rightID } } }
        : {}),
    } as any);
  };

  it("左窗格或右窗格持有该条目即命中", () => {
    setState("tab-a", 11, 12);
    expect(findSplitTabForItem(11)?.tabID).toBe("tab-a");
    expect(findSplitTabForItem(12)?.tabID).toBe("tab-a");
    expect(findSplitTabForItem(13)).toBeUndefined();
  });

  it("窗格未完成挂载（适配器无 item）时不命中也不抛错", () => {
    setState("tab-b", undefined, 12);
    expect(findSplitTabForItem(12)?.tabID).toBe("tab-b");
    expect(findSplitTabForItem(11)).toBeUndefined();
  });

  it("undefined / null 输入直接返回 undefined", () => {
    setState("tab-c", 11, 12);
    expect(findSplitTabForItem(undefined)).toBeUndefined();
    expect(findSplitTabForItem(null)).toBeUndefined();
  });
});

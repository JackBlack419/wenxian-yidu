import { describe, expect, it } from "vitest";
import {
  resolveMenuKey,
  reuseChoiceForIndex,
} from "../../../src/modules/registerReaderToolbar";

describe("阅读器工具栏：复用/重译对话框的返回值映射", () => {
  it("0 → 复用，1 → 重新翻译，其余（含关闭对话框）→ 取消", () => {
    expect(reuseChoiceForIndex(0)).toBe("reuse");
    expect(reuseChoiceForIndex(1)).toBe("retranslate");
    expect(reuseChoiceForIndex(2)).toBe("cancel");
    // confirmEx 在用户按 Esc/关闭时可能返回 -1
    expect(reuseChoiceForIndex(-1)).toBe("cancel");
    expect(reuseChoiceForIndex(99)).toBe("cancel");
  });
});

describe("阅读器工具栏：菜单键盘导航", () => {
  it("↓/↑ 在菜单内循环移动，首尾相接", () => {
    expect(resolveMenuKey("ArrowDown", 0, 3)).toEqual({ focus: 1 });
    expect(resolveMenuKey("ArrowDown", 2, 3)).toEqual({ focus: 0 });
    expect(resolveMenuKey("ArrowUp", 0, 3)).toEqual({ focus: 2 });
    expect(resolveMenuKey("ArrowUp", 1, 3)).toEqual({ focus: 0 });
  });

  it("焦点还不在菜单项上时，↓ 进第一项、↑ 进最后一项", () => {
    expect(resolveMenuKey("ArrowDown", -1, 4)).toEqual({ focus: 0 });
    expect(resolveMenuKey("ArrowUp", -1, 4)).toEqual({ focus: 3 });
  });

  it("Home/End 跳到首尾", () => {
    expect(resolveMenuKey("Home", 2, 5)).toEqual({ focus: 0 });
    expect(resolveMenuKey("End", 0, 5)).toEqual({ focus: 4 });
  });

  it("Esc 关闭菜单（并归还焦点给按钮）", () => {
    expect(resolveMenuKey("Escape", 1, 5)).toEqual({ close: true });
    // Tab 由面板自己处理（关闭但不 preventDefault），不在这里拦
    expect(resolveMenuKey("Tab", 1, 5)).toBeNull();
  });

  it("其他键不拦（字母键、Tab 之外的键交给宿主）", () => {
    expect(resolveMenuKey("a", 1, 5)).toBeNull();
    expect(resolveMenuKey("PageDown", 1, 5)).toBeNull();
  });
});

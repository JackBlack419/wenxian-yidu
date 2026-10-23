// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { mountTranslationWorkspace } from "../../../src/ui/translationWorkspace";
import { createZoteroMock } from "../../qa/harness/zotero-mock";

const components = vi.hoisted(() => ({ selection: vi.fn(), input: vi.fn(), bilingual: vi.fn(), reader: { itemID: 1 } as any }));
vi.mock("../../../src/ui/translatePane", () => ({ mountTranslatePane: components.selection, resolveCurrentReader: () => components.reader }));
vi.mock("../../../src/ui/inputTranslation", () => ({ mountInputTranslation: components.input }));
vi.mock("../../../src/ui/bilingualControl", () => ({ mountBilingualControl: components.bilingual }));
vi.mock("../../../src/core/pdf/sdt/bilingualLauncher", () => ({ getActiveSession: () => null, stopBilingualSession: async () => {} }));
vi.mock("../../../src/core/pdf/sdt/sdtBridge", () => ({ returnToOriginalPdf: async () => {} }));

let dom: JSDOM, z: ReturnType<typeof createZoteroMock>;
let mounted: Array<{ destroy(): void }>;
const handle = () => ({ refresh: vi.fn(), destroy: vi.fn(), focus: vi.fn(), invalidate: vi.fn() });
function mount(inputOnly = false) {
  const body = dom.window.document.createElement("div"); dom.window.document.body.appendChild(body);
  const workspace = mountTranslationWorkspace({ doc: dom.window.document, body, inputOnly, itemID: 1 }); mounted.push(workspace);
  return { body, workspace };
}
beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  z = createZoteroMock({ prefs: { "translate.enabled": true, "translate.auto": true, "translate.engineType": "youdao", "ui.translation.mode": "selection" } }); z.install();
  mounted = []; components.reader = { itemID: 1 };
  components.selection.mockReset().mockImplementation(handle); components.input.mockReset().mockImplementation(handle); components.bilingual.mockReset().mockImplementation(handle);
});
afterEach(() => { for (const workspace of mounted) workspace.destroy(); z.uninstall(); dom.window.close(); });

describe("四功能工作区", () => {
  it("独立输入页不挂载隐藏划词面板，开启自动划词也不会产生后台请求", () => {
    const { body } = mount(true);
    expect(components.selection).not.toHaveBeenCalled(); expect(components.input).toHaveBeenCalledTimes(1);
    expect(body.querySelector(".wenxianyidu-mode-input")!.hasAttribute("hidden")).toBe(false);
  });
  it("离开划词模式释放选区监听，回到划词模式读取当前选区", () => {
    const { body } = mount();
    expect(components.selection).toHaveBeenCalledTimes(1);
    const first = components.selection.mock.results[0].value;
    (body.querySelector('[data-mode="input"]') as HTMLButtonElement).click(); expect(first.destroy).toHaveBeenCalledTimes(1);
    (body.querySelector('[data-mode="selection"]') as HTMLButtonElement).click();
    expect(components.selection).toHaveBeenCalledTimes(2); expect(components.input).toHaveBeenCalledTimes(1);
  });
  it("一个窗口切换引擎后，其余工作区同步服务名并使旧输入结果失效", () => {
    const first = mount(true), second = mount(true);
    const selector = first.body.querySelector("select")!;
    selector.value = "bing-web"; selector.dispatchEvent(new dom.window.Event("change"));
    expect(second.body.querySelector("select")!.value).toBe("bing-web");
    expect(components.input.mock.results[0].value.invalidate).toHaveBeenCalledTimes(1);
    expect(components.input.mock.results[1].value.invalidate).toHaveBeenCalledTimes(1);
    z.prefs.set("extensions.zotero.wenxianyidu.translate.ai.model", "different-model");
    dom.window.dispatchEvent(new dom.window.Event("focus"));
    expect(components.input.mock.results[0].value.invalidate).toHaveBeenCalledTimes(2);
    expect(components.input.mock.results[1].value.invalidate).toHaveBeenCalledTimes(2);
  });
});

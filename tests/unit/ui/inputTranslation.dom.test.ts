// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { mountInputTranslation, splitInputParagraphs } from "../../../src/ui/inputTranslation";
import { createZoteroMock } from "../../qa/harness/zotero-mock";

const service = vi.hoisted(() => ({ translate: vi.fn(), copy: vi.fn() }));
vi.mock("../../../src/core/translation/translationService", () => ({ translateSegments: service.translate }));
vi.mock("../../../src/utils/clipboard", () => ({ copyText: service.copy }));

let instance = 0;
let dom: JSDOM;
let z: ReturnType<typeof createZoteroMock>;
let mounts: Array<{ destroy(): void }>;
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount(key = `input-test-${++instance}`) {
  const body = dom.window.document.createElement("div"); dom.window.document.body.appendChild(body);
  const handle = mountInputTranslation({ doc: dom.window.document, body, draftKey: key }); mounts.push(handle);
  const source = body.querySelector("textarea")!;
  const action = (id: string) => body.querySelector(`[data-action=${id}]`) as HTMLButtonElement;
  const input = (value: string) => { source.value = value; source.dispatchEvent(new dom.window.Event("input")); };
  return { body, handle, source, action, input, result: () => body.querySelector(".wenxianyidu-input-result")!.textContent };
}
beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  z = createZoteroMock({ prefs: { "translate.enabled": true, "translate.engineType": "youdao" } }); z.install();
  mounts = []; service.translate.mockReset(); service.copy.mockReset().mockResolvedValue("");
});
afterEach(() => { for (const handle of mounts) handle.destroy(); z.uninstall(); dom.window.close(); });

describe("输入翻译", () => {
  it("段落切分保留 CRLF、空行和段落顺序", () => {
    const source = "First paragraph.\r\n \r\nSecond paragraph.\r\n\r\n\r\nThird.";
    const { parts, segments } = splitInputParagraphs(source);
    expect(parts.join("")).toBe(source);
    expect(segments).toEqual([{ id: "0", text: "First paragraph." }, { id: "2", text: "Second paragraph." }, { id: "4", text: "Third." }]);
  });
  it("无需阅读器即可翻译多段并复制，保持分隔空行", async () => {
    const view = mount(); service.translate.mockImplementation(async request => request.segments.map((s: any) => ({ id: s.id, status: "success", text: `中文${s.id}` })));
    view.input("First.\n\nSecond."); view.action("translate").click(); await settle();
    expect(service.translate).toHaveBeenCalledTimes(1);
    expect(view.result()).toBe("中文0\n\n中文2");
    expect(view.action("cancel").hidden).toBe(true);
    view.action("copy").click(); await settle();
    expect(service.copy.mock.calls[0][1]).toBe("中文0\n\n中文2");
  });
  it("输入编辑会取消旧请求，迟到的结果不会覆盖新文本", async () => {
    const old = deferred<any[]>(); service.translate.mockReturnValueOnce(old.promise);
    const view = mount(); view.input("Old text"); view.action("translate").click(); await settle();
    const signal = service.translate.mock.calls[0][0].signal;
    view.input("New text"); expect(signal.aborted).toBe(true);
    old.resolve([{ id: "0", status: "success", text: "过期结果" }]); await settle();
    expect(view.source.value).toBe("New text"); expect(view.result()).toBe("");
    service.translate.mockResolvedValueOnce([{ id: "0", status: "success", text: "新结果" }]);
    view.action("translate").click(); await settle(); expect(view.result()).toBe("新结果");
  });
  it("取消后即使服务仍返回，也不会显示已取消请求的结果", async () => {
    const pending = deferred<any[]>(); service.translate.mockReturnValueOnce(pending.promise);
    const view = mount(); view.input("Text"); view.action("translate").click(); await settle();
    view.action("cancel").click(); expect(service.translate.mock.calls[0][0].signal.aborted).toBe(true);
    pending.resolve([{ id: "0", status: "success", text: "迟到结果" }]); await settle();
    expect(view.result()).toBe(""); expect(view.action("translate").disabled).toBe(false);
  });
  it("中文输入法组合期间快捷键不提交，Ctrl+Enter 正常提交", async () => {
    const view = mount(); view.input("Text");
    service.translate.mockResolvedValue([{ id: "0", status: "success", text: "中文" }]);
    view.source.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true })); await settle();
    expect(service.translate).not.toHaveBeenCalled();
    view.source.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true })); await settle();
    expect(service.translate).toHaveBeenCalledTimes(1); expect(view.result()).toBe("中文");
  });
  it("两个输入面板的草稿和结果独立，关闭后恢复各自草稿", async () => {
    service.translate.mockImplementation(async request => request.segments.map((s: any) => ({ id: s.id, status: "success", text: `译文:${s.text}` })));
    const key = `draft-${++instance}`; const first = mount(key), second = mount();
    first.input("First"); second.input("Second"); first.action("translate").click(); second.action("translate").click(); await settle();
    await vi.waitFor(() => { expect(first.result()).toBe("译文:First"); expect(second.result()).toBe("译文:Second"); });
    first.handle.destroy(); const reopened = mount(key);
    expect(reopened.source.value).toBe("First"); expect(reopened.result()).toBe("译文:First");
  });
  it("切换引擎中止在途调用，保留草稿并清除旧引擎的结果", async () => {
    const pending = deferred<any[]>(); service.translate.mockReturnValueOnce(pending.promise);
    const view = mount(); view.input("Text"); view.action("translate").click(); await settle();
    view.handle.invalidate(); expect(service.translate.mock.calls[0][0].signal.aborted).toBe(true);
    pending.resolve([{ id: "0", status: "success", text: "旧引擎结果" }]); await settle();
    expect(view.result()).toBe(""); expect(view.source.value).toBe("Text"); expect(view.action("copy").disabled).toBe(true);
  });
  it("失败段落明确显示错误而不是当成译文成功", async () => {
    service.translate.mockResolvedValue([{ id: "0", status: "error", text: "", error: "quota" }]);
    const view = mount(); view.input("Text"); view.action("translate").click(); await settle();
    expect(view.result()).toContain("input-paragraph-error"); expect(view.result()).not.toBe("Text");
    expect(view.body.querySelector(".wenxianyidu-input-status")!.textContent).toContain("input-partial");
  });
});

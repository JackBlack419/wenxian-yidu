# 开发交接

当前版本 **0.2.5**，2026-10-23。这里只保留现状、入口和操作。变更见根目录 CHANGELOG，验证边界见 [verification.md](verification.md)。

## 当前状态

- Windows x64 / Zotero10；分屏、对照、划词、输入共用翻译引擎。必应免密钥，首次需确认；MTranServer主动准备，英中CPU离线，无隐式在线回退。
- 统一侧栏可调宽/关闭；原PDF、分屏、对照支持划词。SDT选区优先于隐藏PDF旧选区。
- 全文批次检查点、一轮失败段自动补译、手动补译和取消可用；跨视图复用同配置/同文本句段，不是整篇成品互换。
- 分屏与对照均可返回原文，译文PDF为独立附件。插件右键菜单只能尾部追加，禁止打乱宿主固定下标。
- 工具栏与设置同步离线准备进度，窄窗进度环；试译成功才就绪。未实现OCR、分屏边译边显、自由分页或其他平台验收。

## 关键代码

| 范围 | 入口 |
| --- | --- |
| 生命周期、菜单 | src/hooks.ts、src/modules/registerReaderToolbar.ts、registerItemTreeMenu.ts |
| 统一侧栏 | src/ui/translationPanel.ts、translationWorkspace.ts、translatePane.ts、inputTranslation.ts |
| 对照与选区 | src/core/pdf/sdt/bilingualLauncher.ts、sdtBridge.ts、selectionBridge.ts、interleaveView.ts |
| 全文与补译 | src/core/pdf/translation/opendataloaderSplitAdapter.ts、documentJobs.ts、documentSegments.ts |
| 分屏 | src/core/pdf/splitview/、translation/croppingReader.ts |
| 服务与离线 | src/core/translation/translationEngines.ts、offlineManager.ts、offlinePreparationStatus.ts |
| 设置、来源 | addon/content/preferences.*、addon/content/offline/、src/core/pdf/lib/PROVENANCE*.json |

## 操作与约束

构建、检查与发布命令见 [开发说明](development.md)。实机只用 .qa/profile、.qa/data；boot启动，shoot结束。QA_KEEP_DATA=1保留隔离资产，命令通道串行。故障注入只进QA副本，不能进XPI；不要改真实文库或读取用户凭据。

不要重新挂载zotero-pane-stack；不要把Reader.open返回非空当成新标签所有权证明；不要在内容iframe启动特权定时器；只清理自己的窗口、进程和监听。

## 文件与发布

- 主文档：README、用户手册、接口配置、开发、限制、验证、第三方说明；一份修改记录。
- 仓库：https://github.com/JackBlack419/wenxian-yidu；网页：https://jackblack419.github.io/wenxian-yidu/。
- dist由打包脚本生成XPI、单文件HTML、网页ZIP、更新清单与SHA-256，通过Releases分发；源码和产物分开。
- 旧报告、重复截图、原型及旧包移入本地.local-archive，不公开；Git历史、许可与溯源保留。
- 请求成功不等于语义准确；没有真实凭据的服务不声称完成联网验收。

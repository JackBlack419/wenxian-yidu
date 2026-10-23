# 文献译读

[简体中文](README.md) | [English](README.en.md)

在 Zotero 里直接翻译论文：左右分屏通读、逐段中英对照、划词翻译，也能自己输入文字翻译。

**[下载安装包](https://github.com/JackBlack419/wenxian-yidu/releases/latest) · [图文用户手册](docs/user-guide.md) · [交互式快速上手](https://jackblack419.github.io/wenxian-yidu/)**

适用于 **Windows x64、Zotero 10、有文字层的 PDF**。插件免费开源，采用 AGPL-3.0。基础安装包约 5.2 MB；全文组件和可选离线模型按需下载。

![左右对照阅读英文原文与中文译文](docs/images/split.png)

## 先完成一次翻译

1. 从 [Releases](https://github.com/JackBlack419/wenxian-yidu/releases/latest) 下载 `.xpi` 文件；Source code 是源码，不是安装包。
2. Zotero 中打开 **工具 → 插件 → 齿轮 → 从文件安装插件**，选中 XPI，安装后重启。
3. 打开 PDF，点击 **翻译 ▾**。首次会打开设置，请选择引擎并点击 **使用当前引擎**。想先体验，可选免密钥的必应网页翻译。
4. 返回论文，选择下面的翻译方式。

| 想做什么 | 选择什么 | 你会看到 |
| --- | --- | --- |
| 通读全文 | **分屏翻译** | 左侧原 PDF，右侧中文译文；可同步滚动，也可独立阅读。 |
| 逐段细读 | **对照翻译** | 每段英文下面逐步显示中文，可先读已完成的部分。 |
| 理解单词或句子 | **划词翻译** | 选中文字，右侧面板自动显示译文；支持原 PDF、分屏和对照页面。 |
| 翻译自己输入的内容 | **输入翻译** | 输入或粘贴后翻译，点击“复制译文”取走结果；不用选中文献。 |

原 PDF 和批注保留，译文 PDF 另存为同一条目下的附件。分屏与对照顶部均可 **关闭译文，返回原文**。

## 想进一步了解

- [图文手册](docs/user-guide.md)：安装、四种阅读方式、补译、离线准备和常见问题。
- [HTML 演示](https://jackblack419.github.io/wenxian-yidu/)：点击切换功能截图；也可从 Releases 下载单文件 HTML 离线打开，或下载网页 ZIP 上传到自己的网站。
- [接口配置](docs/engine-setup.md)：自己的 AI API、获取模型列表及连接测试。
- [已知限制](docs/known-limitations.md) · [开发说明](docs/development.md) · [验证记录](docs/verification.md) · [修改记录](CHANGELOG.md)。

免费在线接口可能限流或失效；使用自己的付费接口，费用由服务商收取。离线需在设置中主动点击“准备离线翻译”，完成后可用本机 CPU 翻译英语到简体中文。文本只交给你选择的引擎，失败后不会自动切换服务商。重要术语、否定、数字和公式请对照原文核查。

## 反馈与贡献

请在 [Issues](https://github.com/JackBlack419/wenxian-yidu/issues) 提供版本、复现步骤和去除隐私的截图。欢迎修复、完善文档和改善翻译体验，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

本项目基于 [Z-Transplit](https://github.com/Liozhang/z-transplit)，接口适配参考 [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate)。感谢上游作者及贡献者。来源、固定提交和许可见 [UPSTREAM.md](UPSTREAM.md)、[第三方说明](docs/third-party.md) 与 [LICENSE](LICENSE)。

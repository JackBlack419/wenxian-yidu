# 开发与构建

使用Node.js 24与npm，依赖以根目录package-lock.json为准。插件运行在Zotero特权脚本环境，界面使用原生DOM；只有可选离线服务使用插件托管的便携Node。

```bash
git clone https://github.com/JackBlack419/wenxian-yidu.git
cd wenxian-yidu
npm ci
npm run typecheck
npm run test:unit
npm run build
npm run check:structure
npm run check:jar
node scripts/check-offline-provenance.mjs
npm run check:docs
node scripts/package-release.mjs
```

构建输出.scaffold/build/文献译读.xpi；打包后dist包含版本化XPI、单文件HTML手册、网页ZIP、更新清单与SHA-256。安装后重启。npm run dev热加载需自行配置独立测试实例，不要指向主文库。

## 目录

| 路径 | 用途 |
| --- | --- |
| src/core/translation/ | 引擎、缓存、调度、模型列表、托管离线 |
| src/core/pdf/ | PDF解析、布局、分屏、对照、检查点 |
| src/ui/、src/modules/ | 侧栏、工具栏、菜单、窗口生命周期 |
| addon/ | 元数据、设置、语言、离线适配器 |
| java/region-text-remover/ | PDF原文删除器源码与构建依赖 |
| tests/ | 单元/DOM、故障场景、固定科研语料、隔离桌面探针 |
| docs/ | 当前文档、截图与HTML上手页 |

## 组件与来源

源码携带运行期JAR及PROVENANCE；基础XPI仅携带较小的原文删除器，PDF解析器按需下载。完整包设置ZTRANSPLIT_FULL_XPI=1。修改Java后，用JDK17+运行node scripts/build-region-text-remover.cjs并复核来源校验。

离线锁定Node24.22.1、npm MTranServer5.0.1、Koffi2.15.1及英中模型，记录在addon/content/offline/。更换时同步核对许可、锁、来源、下载与退出清理；不将运行库/模型塞进基础XPI。

## 桌面验证与发布

Windows运行node scripts/qa/real-machine.mjs boot，结束用shoot；只操作自己的隔离实例。QA_KEEP_DATA=1保留资产，QA_NO_SYSTEM_NODE=1测试无系统Node路径。模拟不替代真实接口、版式、质量和下载验证，见 [交接](HANDOFF.md) 与 [验证记录](verification.md)。

1. 更新package.json、锁文件与CHANGELOG，完成检查并运行打包脚本。
2. 核对dist/SHA256SUMS.txt与更新清单的ID、版本和链接。
3. 提交对应源码，以v版本号建正式Release并上传dist五个文件，禁止上传QA数据。
4. GitHub Pages使用main的/docs；网页和下载HTML使用同一截图与内容。

项目不保存发布凭据。真实论文、profile、API密钥、本地归档、依赖及构建产物不进源码库。发布者使用自己的GitHub登录工具。

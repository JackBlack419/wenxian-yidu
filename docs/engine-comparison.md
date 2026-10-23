# 在线与离线：速度和译文比较

[English](#english) · [用户手册](user-guide.md) · [60 条原文、参考译文与实际输出](data/engine-comparison.json)

免费在线引擎可能因网络或限流而较慢。需要更快阅读、弱网或断网使用时，建议主动准备 MTranServer；本次实测不支持“离线译文一定更好”的说法。

## 同机速度

2026-10-23，文献译读 0.2.5、Windows x64、Zotero 10.0.6、Intel Core i5-14600KF。采用同一组 60 条自编 CC0 科研句段，英语→简体中文，覆盖术语、否定、数字单位、公式、逻辑和完整性各 10 条。使用产品自身队列：必应并发上限 4，MTranServer 上限 1。

| 测量项 | 必应免费在线 | MTranServer 5.0.1 本机 CPU |
| --- | ---: | ---: |
| 60 条无缓存翻译 | 21.367 秒 | 1.271 秒 |
| 60 条已有缓存命中 | 0.019 秒 | 0.032 秒 |
| 无缓存请求成功 | 60/60 | 60/60 |

在这一轮短句测试中，离线无缓存总耗时约为必应的 1/16.8。两者均先进行连接测试和首条请求预热；无缓存阶段同时关闭内存和持久译文缓存，缓存阶段复用已有记录。缓存命中耗时主要是插件读取开销，不能用来评价引擎速度。

这不是整篇 PDF 的速度测试，不含下载、首次模型准备、完整冷启动、解析和排版。离线服务和模型已准备好；本轮没有重新测量首次准备。只做一次同机测量，没有重复试验或置信区间；网络、CPU、段落长度和并发都会影响结果。

## 译文效果

逐条查看 60 条实际输出后，两者都发现了语义或术语问题。以下列出可以对照原文判断的例子，不用请求成功率代替准确率，也不把参考译文的字面匹配当成质量评分。

| 编号与原文要点 | 必应输出 | 离线输出 | 核对结论 |
| --- | --- | --- | --- |
| 7：blinded evaluator / inter-rater agreement | 盲法评估者 / 评分者之间的一致性 | 失明的评估员 / 利率区间协议 | 离线误解盲法和评估者一致性。 |
| 13：absence of evidence is not evidence of absence | 缺乏证据并不等于证据的缺失 | 缺乏证据并不能证明其缺失 | 必应未清楚保留“没有证据证明存在，不等于证明不存在”的关系。 |
| 14：not insensitive to measurement noise | 并不对测量噪声不敏感 | 对测量噪声不敏感 | 离线反转双重否定；必应虽生硬但保留否定。 |
| 22：5 K per minute | 每分钟 5 K | 每分钟 5 公里 | 离线把开尔文单位误成距离。 |
| 23：3.2 mW | 3.2 毫瓦 | 3.2 兆瓦 | 离线把毫瓦误成兆瓦，数量级错误。 |
| 37：parameter is fixed | 参数是固定的 | 参数已修复 | 离线把参数固定误成修复。 |
| 55：report successes and failures to avoid survivorship bias | 报告成功和失败，以避免幸存者偏差 | 报告了未能避免生存偏见的情况 | 离线改变失败与避免偏差的关系。 |

公式字符串在这组文本输出中保留，不代表复杂 PDF 的公式提取、上下标和渲染已经无误。此次查看不是独立盲评，不发布通用准确率排名；完整输出可供复核。

建议：免准备试用先用必应；追求响应速度、断网阅读和本机处理可选离线；关键结论、专业术语、否定与数量单位须对照原文。也可配置自己验证过的 AI 接口，本轮未对其作效果排名。

## English

Free online engines may be slower due to network delays or throttling. Consider MTranServer for faster reading, poor connectivity or offline use. **This test does not show that offline translation is always more accurate.**

On 23 October 2026, plugin 0.2.5 ran the same 60 synthetic CC0 scientific sentences through its normal queue on Windows x64, Zotero 10.0.6 and an Intel Core i5-14600KF. English → Simplified Chinese; MTranServer npm 5.0.1 and its prepared local model. Bing used its concurrency limit of 4; MTranServer used 1. Both engines were warmed by connection tests and an initial request.

| Measurement, 60 sentences | Bing free online | MTranServer CPU |
| --- | ---: | ---: |
| Translation with memory and persistent caches disabled | 21.367 s | 1.271 s |
| Existing translation cache hits | 0.019 s | 0.032 s |
| Successful uncached requests | 60/60 | 60/60 |

Offline took about 1/16.8 of Bing's uncached time in this single short-sentence run. This excludes downloads, initial model preparation, full cold startup and PDF parsing/layout. Cache-hit times measure plugin lookup overhead, not provider speed. Hardware, network conditions, workload and concurrency affect results; no repeated trials or confidence intervals were collected.

Reviewing all 60 outputs exposed errors in both engines. MTranServer translated “blinded evaluator” as a physically blind evaluator, reversed “not insensitive,” rendered 5 K/min as 5 kilometres/min, and changed 3.2 mW to 3.2 megawatts. Bing's “absence of evidence” sentence also failed to clearly preserve the original distinction. Request success is not translation accuracy. Formula strings survived this text test; complex PDF formula extraction and rendering remain separate limitations.

Use Bing for an easy start; consider offline for responsiveness and local processing. Check scientific terms, negation, units and conclusions against the original. The [complete inputs and outputs](data/engine-comparison.json) allow inspection; this is a limited internal comparison, not an independent blinded quality ranking.

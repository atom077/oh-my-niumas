# Phase 0 数据样例

这些文件是日志格式核验与未来计算测试的依据，尚不是应用可导入的完整原始 JSONL。

| 文件 | 类型 | 内容与限制 |
| --- | --- | --- |
| [observed/s01-multiturn.json](observed/s01-multiturn.json) | 真实日志的匿名白名单投影 | 一个完整三轮样本的边界、输入观测与 Token 记录；只选取必要事件，保留匿名源行号 |
| [observed/s08-anomalies.json](observed/s08-anomalies.json) | 真实日志的匿名摘录 | 中止、重复累计、上下文压缩后两条计数路径分歧；不是完整事件流 |
| [synthetic/acceptance-vectors.json](synthetic/acceptance-vectors.json) | 完全合成 | 100 min / 50 min / 2.0× 并发样例、裁切、跨日和 Token 子集验收向量 |
| [import-smoke/sessions/synthetic.jsonl](import-smoke/sessions/synthetic.jsonl) | 完全合成的原始格式 | 浏览器测试专用的隔离导入根，10 分钟 / 100 Token；不读取用户真实日志 |

## 脱敏方式

- 删除真实 session/turn/item/response 标识、机器路径、用户名、模型请求内容、会话标题、Prompt、工具调用及结果。
- 真实观察样例只用 S01/S08 与 turn-A/B/C 等别名；时间改为相对首个开始事件的秒数，不保留真实日期。
- Token 数字与轮次相对间隔保留，便于检查计算关系；这些用量元数据仍可能具有可关联性，对外发布前应复核是否改为等价合成数值。
- 合成跨日样例日期是任意测试日期，不是本机日志日期。
- 匿名源行号只在本次核验中有意义；仓库不保存行号到真实文件路径的映射。

## 可验证的结论

S01 三轮长度分别为 48.760、106.910、7.237 秒。九条 `token_usage_record` 的单次 usage 累加为 391822，三轮分别为 105259、229963、56600；配套 `token_count` 不能再加一次。输入记录时间比对应任务开始晚，因此这些输入时间不能宣称是真实点击时间。

S08 的压缩用量为 327480，对应 `token_count` 累计却没有增长，末尾两路累计仍相差 327480。该摘录用于防止“全部 token_count 相加”与“总是只用其最后累计值”这两种未经限定的实现。

它们证明本次样本中的行为，不证明所有版本、归档或父子 Agent 采用同一语义。完整解释见 [日志发现](../docs/log-format-findings.md) 与 [指标规格](../docs/metrics-spec.md)。

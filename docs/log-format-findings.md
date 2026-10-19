# 本机 Codex 日志核验

核验日期：2026-10-19（Asia/Shanghai）。本报告是本机抽样证据，不是跨版本协议保证。

**结论：已有可恢复多轮时间区间及验证 Token 去重路径的样本，最小可行性依据成立。** 压缩、fork、输入记录延迟均有真实反例，首版必须显示作用域与覆盖边界。未完成桌面 UI 逐项对照，不能把本报告称为整个 Phase 0 已全部验收，更不表示本机导入或 Demo 已实现。

## 1. 范围与方法

只读发现 `~/.codex/sessions`、`~/.codex/archived_sessions` 与 `~/.codex/session_index.jsonl`。源文件以只读方式打开；未写回、重命名或清理源日志。分析过程只输出白名单字段、匿名别名和汇总，仓库只保存匿名投影与合成验收向量。

首次枚举快照：

| 来源 | 数量 | 字节 | 日期含义 |
| --- | ---: | ---: | --- |
| sessions | 107 个 JSONL | 621611304 | 目录编码日期 2026-09-30 至 2026-10-19，不代表全文活动范围 |
| archived_sessions | 0 个 JSONL | 0 | 目录存在，无可验证归档样本 |
| session_index.jsonl | 180 条有效行 | 23366 | 行数不是去重后的 Session 数 |

Index 实际键为 `id`、`thread_name`、`updated_at`，均为字符串。标题和真实 ID 不纳入本报告/Fixture。

抽样从最早/最新、最小、大小分位和最大可完整读取文件中选择，最终主表固定为首批八个样本。11 个已枚举文件超过 16 MiB，较大样本只读前缀。期间动态重选曾因活跃文件增长额外触及第九个文件，已恢复原始主表，不能声称总共只读取八个文件。初次探索逐行读取后检查上限，可能越过上限一行；最终复核使用有界读取，S07 精确读取 16777216 字节并丢弃末尾不完整行。

这是目的性抽样，不能从 8/107 推导全库支持率。活跃文件也不是原子快照。

| 样本 | 文件字节（快照） | 读取范围 | start | complete | aborted | 未闭合 | usage 记录 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| S01 | 358932 | 完整 | 3 | 3 | 0 | 0 | 9 |
| S02 | 601801 | 当时 EOF，活跃/fork | 2 | 0 | 0 | 2 | 12 |
| S03 | 26716 | 完整 | 0 | 0 | 0 | 0 | 0 |
| S04 | 198911 | 完整 | 1 | 1 | 0 | 0 | 4 |
| S05 | 487906 | 完整 | 1 | 1 | 0 | 0 | 9 |
| S06 | 1765591 | 完整 | 7 | 7 | 0 | 0 | 43 |
| S07 | 20149908 | 16 MiB 前缀 | 2 | 1 | 0 | 1 | 18 |
| S08 | 11342065 | 完整 | 15 | 14 | 1 | 0 | 199 |

额外第九个样本不在主表，快照为 507642 字节、10 个闭合轮次（7 complete、3 aborted），不另计入主表覆盖率。

样本中见到版本 `0.158.0-alpha.2.1`、`0.162.0-alpha.17.2`、`0.163.0-alpha.10.2`。已解析外层时间戳都可解析且以 `Z` 结尾，样本事件日期涵盖 2026-09-30 至 2026-10-19。S01 的任务边界在一个日期，而其他后续事件跨至另一日期；不能用目录日期或 session metadata 日期代替最后活动时间。

## 2. 实际包装格式

```text
时间戳：$.timestamp
事件：  $.type = event_msg
        $.payload.type = task_started | task_complete | turn_aborted
轮次：  $.payload.turn_id

输入：  $.type = event_msg
        $.payload.type = item_completed
        $.payload.item.type = UserMessage
        $.payload.item.id
        $.payload.turn_id
```

样本实际正常终止名为 **task_complete**，未见候选 `task_completed`；实际用户输入不是直接以 `user_message` 表示。未观察到的候选事件不能凭名称补进“已支持”清单。一个失败工具调用也不证明整轮失败。

`session_meta.payload` 见到 `id`、`timestamp`、`cwd`、`originator`、`cli_version`、`source`、`model_provider`，可选 `forked_from_id`、`parent_thread_id`。`source` 既可能是字符串，也可能是对象，不能固定成字符串 schema。

## 3. 多轮边界与输入时间

S01 的所有开始/结束均有非空字符串 turn_id，三对 ID 匹配，无重复 start 或孤儿 end。S06 的七轮与 S08 的十五轮也通过同样配对检查。

| 匿名轮次 | start 行 | end 行 | 相对首个 start 的区间（秒） | 执行秒数 |
| --- | ---: | ---: | --- | ---: |
| A | 2 | 34 | [0, 48.760) | 48.760 |
| B | 36 | 78 | [131.977, 238.887) | 106.910 |
| C | 80 | 90 | [298.154, 305.391) | 7.237 |

S08 首轮以 `turn_aborted` 在第 196 行结束，执行区间为 863.009 秒；不能记成正常完成。S07 只读前缀里的未闭合不证明原文件缺少结束事件，S02 的未闭合也不构成现在仍运行的证据。

**输入时间限制：** S01 的三条 UserMessage 记录分别比 start 晚 3.094、0.268、0.223 秒。这是输入被记录的时刻，未证明是用户点击发送时间。A 完成至 B 输入记录间隔为 83.485 秒，但完成至 B start 为 83.217 秒；如果直接按记录时间画精确等待，就会与 AI 执行重叠。需保留两种时间证据，真实等待缺少精确截止时标 N/A 或明示推断，不归成人工投入。

S01 三个、S08 十五个 UserMessage 的 item.id 均非空且样本内唯一；S08 十五条输入落在十四个轮次，说明按 turn_id 去重输入会漏计。跨文件 ID 稳定性未验证。

## 4. 两套 Token 路径

```text
$.type = event_msg
$.payload.type = token_count
$.payload.info.total_token_usage
$.payload.info.last_token_usage

$.type = token_usage_record
$.payload.thread_id / turn_id / session_id / root_turn_id / response_id
$.payload.usage
$.payload.turn_token_usage
$.payload.thread_token_usage
```

三个 usage 对象直接包含数值字段，不嵌套 `{id, usage}`：`input_tokens`、`cached_input_tokens`、`cache_write_input_tokens`、`output_tokens`、`reasoning_output_tokens`、`total_tokens`。未验证 cache_write 的计费语义。

### S01：可对照的单次与累计

- 九条 usage 分别等于后续 token_count 的 last，九条 thread 累计分别等于后续 token_count 的 total。
- 同线程八次后续累计差值全等于 usage；三个 Turn 各自首条累计等于 usage，六次后续 Turn 累计差值也全等于 usage。
- 首条 Token 在首个 start 之后，且 thread/turn 首累计等于当次 usage，支持该样本的零基线与轮次归属。
- A/B/C 记录用量分别 105259 / 229963 / 56600，总计 391822；同时相加两套通道会重复计数。
- 本样本数值满足 total=input+output，cached≤input、reasoning≤output。这支持将后两者作为分项而不再加进 total；不构成所有版本或计费语义的证明。

### S08：压缩与重复上报反例

| 行 | 事件 | 数值证据 |
| ---: | --- | --- |
| 652 | token_count | 累计 17036059 |
| 655 | token_usage_record | 单次 327480，thread 累计 17363539 |
| 656 | compacted | 明确的压缩事件 |
| 660 | token_count | 累计仍 17036059；last 的 input/output 为 0，但 total 为 35160 |

之后两条累计路径持续相差 327480，末尾分别是 38684885 和 39012365。不能默认 token_count 最新累计就覆盖所有已记录 usage，也不能默认所有 last 都是可加消耗。

S08 的 198 次后续 thread 差值都等于 usage；十五轮首条累计等于 usage，184 次后续 Turn 差值也等于 usage。它支持按 `token_usage_record` 独立作用域建立已知用量账本，同时保留 token_count 的差异证据；不证明 ChatGPT 实际计费。

另有九次相同 token_count 累计重报。例如行 189 与 194 都为 2530733，第二条不贡献新增用量。未见累计下降，但不能据此删掉重置处理。

S01 的九个与 S08 的 199 个 response_id 均非空且样本内唯一，是候选去重键；尚未验证跨文件/归档重复。来源偏移用于扫描幂等，跨文件复制还需逻辑作用域去重，不能把相同数值本身当事件 ID。

## 5. Fork 与子 Agent

普通样本 source 为 `vscode`。S03 的 source 含 subagent 对象及 parent_thread_id，但没有任务边界或 Token，无法当成可计时普通会话。

S02 有两条不同 ID 的 session_meta；第二条带 forked_from_id 和 parent_thread_id，两者值相同，但不等于前一条 metadata ID。Token 的 thread scope 也不匹配最新 metadata ID。这直接证明文件内存在 fork 标记与作用域不一致，尚未证明完整继承关系。

因此不能将整文件历史累计自动归给最后一个 session_meta，也不能递归叠加父子会话用量。首版对无法隔离作用域的记录标未知/排除，并报告排除原因和数量。

## 6. 产物、通过范围与剩余核验

已保存 [S01 匿名多轮投影](../fixtures/observed/s01-multiturn.json)、[S08 匿名异常摘录](../fixtures/observed/s08-anomalies.json)、[合成验收向量](../fixtures/synthetic/acceptance-vectors.json)。真实时间改为相对秒，ID 全部别名化；没有真实路径、对话或工具内容。它们不是原始 JSONL；未知字段及未选事件未复制。

可进入 Fixture 驱动规格设计：至少一个独立多轮样本可恢复执行边界，重复上报与双通道 Token 的去重规则已有数值证据，并有压缩反例约束算法。计算规则见 [metrics-spec.md](metrics-spec.md)。

仍需验证：

- 与桌面可见会话的时间、状态、用量逐项对照；当前只有源日志内部交叉验证。
- 归档真实样本、跨文件重复、完整 fork 继承链与其他版本。
- 明确失败、崩溃、无任务边界历史日志及计数重置。
- 真实发送时间或足够可靠的等待截止证据；只有输入记录时间时不输出精确等待。
- 增量扫描的追加、重命名、截断和归档幂等行为；本次一次性核验不构成这些能力的运行证明。

未来本机接入验收应保留上述缺口，不能用合成数据通过测试来宣称真实覆盖已验证。

# 真实会话对照记录

核验日期：2026-10-20（Asia/Shanghai）。四个目的性抽样会话，31 个轮次：单轮、多轮、跨日、中止。只保存匿名编号、版本与数值；原始标题、路径、会话和轮次 ID 不入库。

## 已证实与未证实

- 通过 Codex 的 `list_threads` / `read_thread` 受支持接口取得应用记录，按哈希后的会话/轮次 ID 匹配只读日志投影，31/31 匹配。
- 30 个 completed 与日志 completed 一致；1 个 interrupted 与日志 aborted 对应。所有日志起止时间均落在接口对应的秒内（接口 startedAt/completedAt 只有秒精度）。
- 27 轮的日志经过时间与接口 durationMs 相差最多 231 ms。另 4 轮存在明显差异，尤其跨日记录。因此不能宣称日志经过时间等于应用内部执行计时。
- **界面字段不可对照**：Computer Use 明确禁止读取 Codex 原生窗口；用户于 2026-10-20 确认代表样本 R1 的桌面界面不显示耗时和 Token，因此两项记为“不显示 / 不可核对”，关闭待补充事项，不称数值一致。其他样本未逐项检查可见 UI。read_thread 未提供 Token 字段，Token 只能核对日志内部通道。

产品继续使用第 5 节定义的日志开始至终止经过时间，可能含工具、内部等待及暂停间隔；不擅自换成未核实语义的 durationMs。会话详情已说明两者不同。跨日的长区间应如实显示与裁切，不把 durationMs 平摊回墙钟区间。

## 逐轮结果

T 编号沿用接口最新优先顺序，下表按旧到新展示。单位 ms；最后一列是日志时间减去接口秒精度时间。

| 样本/轮次 | 应用状态 → 日志状态 | 应用 durationMs | 日志边界经过时间 | 起点 / 终点差 |
| --- | --- | ---: | ---: | ---: |
| R1/T1 | completed → completed | 26134 | 25903 | 240 / 143 |
| R2/T5 | completed → completed | 18984 | 18974 | 572 / 546 |
| R2/T4 | completed → completed | 26193 | 26184 | 752 / 936 |
| R2/T3 | completed → completed | 8014 | 8005 | 198 / 203 |
| R2/T2 | completed → completed | 60235 | 60234 | 825 / 59 |
| R2/T1 | completed → completed | 27985 | 27987 | 97 / 84 |
| R3/T10 | completed → completed | 16835 | 16836 | 214 / 50 |
| R3/T9 | completed → completed | 115321 | 4250174 | 324 / 498 |
| R3/T8 | completed → completed | 208579 | 5031287 | 45 / 332 |
| R3/T7 | completed → completed | 24400 | 707428 | 637 / 65 |
| R3/T6 | completed → completed | 7155215 | 178719707 | 596 / 303 |
| R3/T5 | completed → completed | 7230 | 7207 | 715 / 922 |
| R3/T4 | completed → completed | 5005 | 5002 | 614 / 616 |
| R3/T3 | completed → completed | 31464 | 31450 | 639 / 89 |
| R3/T2 | completed → completed | 3820 | 3819 | 751 / 570 |
| R3/T1 | completed → completed | 4319 | 4319 | 472 / 791 |
| R4/T15 | interrupted → aborted | 863001 | 863009 | 918 / 927 |
| R4/T14 | completed → completed | 925410 | 925422 | 677 / 99 |
| R4/T13 | completed → completed | 584036 | 584019 | 863 / 882 |
| R4/T12 | completed → completed | 527555 | 527553 | 234 / 787 |
| R4/T11 | completed → completed | 119671 | 119615 | 373 / 988 |
| R4/T10 | completed → completed | 690662 | 690652 | 459 / 111 |
| R4/T9 | completed → completed | 18122 | 18109 | 955 / 64 |
| R4/T8 | completed → completed | 46518 | 46503 | 494 / 997 |
| R4/T7 | completed → completed | 34296 | 34289 | 271 / 560 |
| R4/T6 | completed → completed | 383056 | 383050 | 796 / 846 |
| R4/T5 | completed → completed | 272882 | 272877 | 11 / 888 |
| R4/T4 | completed → completed | 744332 | 744337 | 642 / 979 |
| R4/T3 | completed → completed | 696259 | 696249 | 855 / 104 |
| R4/T2 | completed → completed | 32802 | 32797 | 893 / 690 |
| R4/T1 | completed → completed | 5998 | 5997 | 513 / 510 |

## Token 与覆盖

| 样本 | 轮次 | 日志已知 Token | 版本 | 界面 Token 对照 |
| --- | ---: | ---: | --- | --- |
| R1 | 1 | 182547 | 0.163.0-alpha.10.2 | 用户确认界面不显示 |
| R2 | 5 | 972256 | 0.163.0-alpha.10.2 | 无接口字段，未核对 |
| R3 | 10 | 1010274 | 0.162.0-alpha.17.2 | 无接口字段，未核对 |
| R4 | 15 | 39012365 | 0.162.0-alpha.17.2 | 无接口字段，未核对 |

R4 为原 Phase 0 的压缩反例：record 总计 39012365，counter 38684885，差 327480。当前继续采用有作用域的 record 路径，不将两通道相加。未知计费语义与父子归属均未推导。

## 刷新性能快照

初次新建白名单缓存扫描：114 个文件、68 个归一化会话，约 4468 ms；紧接着 114 个缓存复用、0 个重读，约 75 ms。一次后续快照为 115 文件、3 个重读约 370 ms；其后的 1 个活跃文件重读约 166 ms。文件数和重读数量会随活跃日志变化；这些是单机快照，不是性能保证。

已知仍有 1 个前缀截断文件、148 行跳过；本次抽样不代表全库或所有版本覆盖。准实时刷新采用完成后计时、隐藏页面暂停、服务端同批请求合并。保留签名缓存与变化文件重读，界面展示每次扫描耗时；若日常出现扫描接近所选间隔，再评估字节偏移追尾。

匿名数值原件：[application-comparison.json](../fixtures/observed/application-comparison.json)。早期核验：[log-format-findings.md](log-format-findings.md)。

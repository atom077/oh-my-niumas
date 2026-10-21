# Cursor 本机会话接入与可观测性

核验日期：2026-10-20。本机 Cursor `3.25.9`。这是已安装版本的存储适配，不能视为 Cursor 对外承诺的稳定协议。[官方历史说明](https://docs.cursor.com/en/agent/chat/history)确认桌面对话使用本机 SQLite；字段含义另经本机数据库和安装包源码核查。

## 来源和覆盖

默认读取 macOS 的 `~/Library/Application Support/Cursor/User`：

- `globalStorage/state.vscdb`：`cursorDiskKV` 中 `composerData:<id>` 保存会话和有序消息引用；`bubbleId:<composer>:<bubble>` 保存消息；`composerHeaders` 提供名称、工作区和子 Agent 标记。
- `workspaceStorage/*/state.vscdb`：发现相同结构时一并读取，按带 `cursor:` 命名空间的会话标识去重。不是把 workspace 副本重复相加。
- `workspaceStorage/*/workspace.json`：仅单目录 `folder` 用于关联工作区。多根工作区不猜测目录，而是按 `.code-workspace` 文件（会话 `workspaceIdentifier.configPath` 或 `workspace.json` 的 `workspace`）单独分组，显示为「<工作区名>（多目录）」，不归属到其中任一仓库；会话自带的 `workspaceIdentifier.uri` 优先。目录匿名方式与 Codex 相同，因此同目录可自然归为一个项目，但这只是工作区证据，不能声称已验证为会话起始 cwd。

实测：12 个数据库、65 个可展示会话、204 次输入驱动轮次；排除 7 个子 Agent/分支会话，194 轮包含可展示的记录时长。存在部分不可用消息，覆盖不完整。这些数字是本次快照，不是跨版本保证。空草稿、无用户输入的记录不当作已使用会话。支持本机桌面会话，不宣称覆盖旧版 `aiService` 聊天、云端 Agent 或所有 CLI 格式。

## 指标证据

- 用户消息类型为 `1`，助手为 `2`。按有序消息引用，以真实用户消息划分轮次；`isSimulatedMsg` 不计为人工输入。`createdAt` 只是活动时间证据，不等于 AI 执行开始。
- `startedAtMs` / `completedAtMs` 出现在消息上。安装包 `bubbleTiming.js` 表明它们用于消息计时，无法证明整个多工具轮次的终止边界。
- 终段消息可能有 `turnDurationMs`，安装包 `turnCollapsing.js` 使用这类值作为显示时长的候选。抽样中带该值的消息缺少 `completedAtMs`，因此不能用“最后消息创建时间”当整轮完成时刻，也不能从用户输入加该时长推算绝对终点。
- 页面在会话列表及详情把 `turnDurationMs` 累计显示为“Cursor 记录时长”，多次出现取最大值作为该轮候选，与安装包折叠显示策略一致。列表标注记录覆盖轮数，缺少记录的轮次不补零；按该轮用户输入时间整笔归属，不能精确拆分跨日时长。该值未经桌面逐轮数值比对，与可定位的 `workloadMs` 保持独立，不参与活跃覆盖、等待或并发；混合来源主卡和项目累计按用户确认合计两类时长，并注明来源。轮次保留 `unknown` 和独立的活动时间戳；小时与分钟时间轴仅画已观测活动点，不补造执行条。
- 所有抽样消息的 `tokenCount.inputTokens/outputTokens` 均为 `0`。未证明是计费用量，不能当作零消耗；当前 Cursor Token 一律 N/A。合并总览中 Codex 的已知计数不受影响，覆盖分母包含 Cursor。

仅 Cursor 时，首张卡显示“AI 累计时长 · Cursor 记录”、记录覆盖轮数及按输入时间归属说明；项目汇总也显示独立记录值。活跃覆盖和并发缺少绝对边界仍为 N/A。混合来源主数值为可定位工作量加 Cursor 记录累计，备注给出拆分；平均并行倍数仍使用可定位工作量除以其覆盖。数值接口的 workloadMs=0 表示已知执行区间的空集，不是 Cursor 记录时长为零；独立 reportedWorkloadMs 与覆盖计数提供记录值。

## 只读、缓存与限制

SQLite 使用 `readOnly: true`、`query_only` 和只读事务；不以 immutable 模式绕过 WAL，活跃 Cursor 的已提交 WAL 数据也可见。每个数据库使用自己的读取快照，不保证多个数据库之间全局一致。仅读指定表和键，SQL JSON 投影只把白名单元数据带入应用，不查询凭据或把原始 JSON/正文装载到应用。索引中的 `textPreview` 也排除。

会话标题按刷新载入内存并使用现有路径脱敏；本地缓存只存匿名关联、目录末级名、消息类型/时间、来源和记录时长。源主数据库、WAL、SHM 或根目录遇到符号链接时跳过或报告；原始对话、工具输出、完整路径与标题不进入缓存。不会把真实标题写入仓库 Fixture 或截图。

Cursor 缓存位于现有 `.local/niumas.sqlite` 的独立表，按配置的根目录隔离。重复扫描和重启不会重复计轮；刷新失败保留上次成功快照并提示，成功发现删除则清除失效会话。Cursor 每次刷新重查有界元数据，不复用 Codex 的文件签名缓存或声称按字节追尾。

资源上限：100 个工作区候选目录、1000 个会话、20000 条消息；每个原始 JSON 值最多 64 MiB，累计元数据所属原始记录预算 128 MiB。截断、无效消息、缺失和版本不支持均提示。标题来自 `composerHeaders.name`；不从消息正文取摘要。只验证本机版本，老结构会提示无法解析。

可配置 `NIUMAS_CURSOR_ROOT` 指向 Cursor `User` 目录，由进程配置，浏览器不能传路径。设置 `NIUMAS_LOG_ROOT` 时，默认隔离到该 Codex 测试源；需要同时接入 Cursor 时显式设置两者。


2026-10-20 展示修正：此前导入保留了记录时长，但列表仅显示可定位执行区间的累计，导致有记录的 Cursor 会话也全部为 N/A。现在 `reportedWorkloadMs/reportedTurns/reportedTurnTotal` 单独报告当前窗口按输入时间归属的记录值和覆盖，列表与详情直接显示；`workloadMs`、执行区间与 confidence 语义保持不变。按项目聚合绘图不会把记录值转成执行条。


2026-10-20 总览修正：记录累计由 Session 进一步汇总到 Metrics 和 Project；只选择 Cursor 时首卡直接展示记录累计，不再因绝对边界未知而隐藏已有记录。平均并行倍数未知时提示缺少可定位执行区间，不展示 0÷0。记录累计仍不参与覆盖和并发公式。

## 2026-10-20 执行区间推算（取代上文“不补造执行条”）

官方核验：Cursor 没有可读取历史桌面会话每轮结束时间或时长的公开接口。[Hooks](https://cursor.com/docs/hooks) 的 `stop` 只有 `status/loop_count` 与 Token，公共字段无时间戳；官方论坛[答复](https://forum.cursor.com/t/how-to-obtain-token-usage-per-request/168317)建议在 `beforeSubmitPrompt` 与 `stop` 自行打点并按 `generation_id` 相减，只对安装 Hook 之后的新轮次有效，且被打断的轮次存在[已知错配](https://forum.cursor.com/t/stop-hook-reports-the-wrong-generation-id-when-a-follow-up-prompt-aborts-an-in-progress-agent-turn/166471)。CLI `--print` 的 `duration_ms` 只覆盖无界面运行；企业 OpenTelemetry 导出无轮次区间；本机 `agent-transcripts` 无时间字段。项目保持只读，不安装 Hook。

本机数据核验：`turnDurationMs`（桌面 “Worked for”）从用户消息 `createdAt` 开始计时。全部本机会话 208 轮带该值，其中 193 轮（约 93%）“输入 + 时长”与携带该值的结尾消息 `createdAt` 相差不超过 20 秒，中位 1.5 秒；首条助手 `startedAtMs` 一般晚于输入 2–25 秒，说明计时起点是提交而非模型响应。11 轮时长明显短于消息跨度（推测排除了批准等待，未验证），4 轮偏长。

推算规则：轮次起点取用户消息 `createdAt`，终点取起点 + 最大 `turnDurationMs`；仅当终点与结尾消息相差不超过 `INFERENCE_TOLERANCE_MS`（20 秒）且不晚于下一次输入时采用，状态按 completed 推算（无法区分中止）。其余轮次保留 unknown 与活动点，不画执行条。推算区间带 `confidence: "inferred"`，参与工作量、活跃覆盖、并发与闭合等待（终点至下一次输入），对应 `confidence.timing/waiting` 为 inferred；页面执行条统一为斜纹虚线、按来源着色（Cursor 深色、Codex 蓝色），推算口径靠图例“Cursor 推算执行”、悬停文案与项目标注区分。Cursor 输入作为执行起点视为精确输入时间。

记录值保持不变：`reportedWorkloadMs` 仍为窗口内按输入时间归属的全部记录时长；新增 `inferredWorkloadMs`（`workloadMs` 中的推算部分）与 `unlocatedReportedMs`（未通过校验轮次的记录时长）。混合主数值改为 `workloadMs + unlocatedReportedMs`，避免推算轮次被重复累计。重新扫描后本机 214 个输入驱动轮次中 190 轮获得推算区间。

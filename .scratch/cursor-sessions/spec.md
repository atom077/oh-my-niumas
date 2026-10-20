# Cursor 本机会话接入

2026-10-20。用户日常同时使用 Codex 与 Cursor，要求把 Cursor 会话采集并展示在同一工具。

- 先只读核验本机 Cursor 3.25.9：globalStorage/state.vscdb 的 cursorDiskKV、composerHeaders；workspaceStorage/*/workspace.json 提供工作区归属证据。
- 保留 Codex 接入和匿名标识，Cursor ID 加来源命名空间；相同目录可归到同一项目。工作区证据不等于起始 cwd；多根工作区或归属缺失单独标识，不猜测项目。
- 只读 SQLite 快照查询；只投影会话/消息标识、类型、时间、工作区元数据和已记录时长。标题仅在内存；不读取到应用或保存提示词、工具输出、正文、凭据。
- Cursor 消息 startedAtMs/completedAtMs 是消息边界，不能直接充当整轮边界。每个真实用户输入对应一个待核验轮次；以输入时间保留活动点，AI 起止不确定时状态 unknown，不贡献执行/并发/等待。
- turnDurationMs 仅显示为 Cursor 记录时长，无绝对终点时不补造时间轴。零值 tokenCount 语义未经验证，一律 N/A。
- 总览/项目/会话/时间轴共享来源筛选；会话与时间轴标示 Codex/Cursor。扫描报告分来源覆盖，缺失、不支持、过大、子 Agent 和读取失败均提示。现有扫描与自动刷新同时更新两个来源。
- 隔离合成 SQLite 测试覆盖 HTTP、重复刷新/重启、更新/删除、来源筛选、未知指标、子 Agent 排除、正文不落库及源库不变；浏览器验证来源筛选与详情。

Status: ready-for-agent
Execution: completed
Type: task

# 总览直接展示 Cursor 记录累计

依照 ../spec.md 实施，保留现有项目聚合与接入改动。

## Comments

- 用户再次标注总览 N/A；前次仅修正了会话列表，尚未传递记录值到总览 KPI。

- 复现命令：npm run test:e2e -- tests/browser/cursor.spec.ts。两轮各40秒的会话记录累计存在，首卡期望1.3min、实际N/A，确认是总览未使用独立记录汇总。
- 已向 Metrics/Project 汇总记录值及覆盖计数；Cursor 单来源首卡直接展示记录累计，混合来源保留边界计时并另列记录值。并发未知时不显示0÷0。
- 23项计算/HTTP、15项浏览器测试、类型检查与构建通过；实际4317服务已更新并显示“Cursor/今天：111.3min，记录覆盖34/34轮”。真实截图只存临时目录，仓库新增截图为合成来源。

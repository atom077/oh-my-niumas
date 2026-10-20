Status: ready-for-agent
Execution: completed
Type: task

# 混合来源主数值包含 Cursor

## Comments

- 回归命令 npm run test:e2e -- tests/browser/cursor.spec.ts 已复现：期望11.3min，实际10min。已有记录正确，问题在UI选择了单一字段。
- 修复主卡/项目累计取值；保留拆分说明，并给区间指标增加口径标签。
- 回归已通过：15项浏览器测试、类型检查和生产构建；git diff --check通过。实际4317页面已刷新，主数值3.6h，来源拆分Codex105.4min + Cursor111.3min，合计约216.7min；并行倍数仍为1.2×且标明仅含可定位区间。

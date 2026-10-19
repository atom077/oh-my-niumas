# oh-my-牛马s

项目背景、产品边界、指标定义与设计方向以 [PROJECT.md](oh-my-niumas-project/PROJECT.md) 为准。开始产品设计、日志解析或 Demo 开发前先阅读对应章节；设计冲突按文档规定处理：前部最新品牌与精简 UI 策略优先，统计定义以第 5 节为准。

按 Phase 0 日志核验 → 精简 UX → Fixture 驱动 Demo → 本机只读日志接入推进。真实日志的读取、脱敏和存储遵循 PROJECT.md 的隐私要求；指标缺失或推断必须标注。

## Agent skills

### Issue tracker

任务与规格使用本地 Markdown，位于 `.scratch/<feature>/`；创建、读取或更新任务前查看 [事项跟踪约定](docs/agents/issue-tracker.md)。

### Triage labels

使用五个默认分诊标签；分诊时查看 [标签映射](docs/agents/triage-labels.md)。

### Domain docs

采用 single-context：根目录 `GLOSSARY.md` 与 `docs/adr/`；探索领域概念或设计方案前查看 [领域文档规则](docs/agents/domain.md)。

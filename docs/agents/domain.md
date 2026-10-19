# Domain Docs

## 布局

本项目采用 single-context，路径相对于项目根目录：

- `GLOSSARY.md`：统一领域术语。
- `docs/adr/`：架构决策记录。

## 探索前的读取规则

先读取根目录的 `GLOSSARY.md`，以及 `docs/adr/` 中涉及当前工作范围的决策。

文件不存在时静默继续，不要求提前补齐。术语与决策实际明确后，由 `domain-modeling` 按需创建；本次初始化只记录布局与读取规则。

当前产品背景与统计口径见 [PROJECT.md](../../oh-my-niumas-project/PROJECT.md)，其中第 5 节定义 Project、Session、Turn、AI 执行时长、等待与并发指标。待决策建议保留其待决策属性。

## 使用统一术语

在事项标题、设计方案、假设与测试名称中使用 GLOSSARY.md 已定义的术语。需要的概念尚未收录时，先核对项目文档；确有缺口时记录为 domain-modeling 的输入。

## 决策冲突

方案与现有 ADR 冲突时，明确引用 ADR 编号、说明冲突和重新讨论的理由，不静默覆盖。

## 后续扩展

若未来确有多个独立领域上下文，可再引入根目录 GLOSSARY-MAP.md 指向各上下文的 GLOSSARY.md，并补充对应读取规则。

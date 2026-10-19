# Issue tracker: Local Markdown

本项目的事项与规格保存为本地 Markdown 文件。

## 文件约定

- 每项功能使用一个目录：`.scratch/<feature-slug>/`。
- 规格文件：`.scratch/<feature-slug>/spec.md`。
- 实施事项：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 编号，每个事项一个文件。
- 分诊状态写在事项顶部的 `Status:` 行，取值见 [triage-labels.md](triage-labels.md)。
- 评论与讨论历史追加在文件底部的 `## Comments` 下。

## 技能中的操作映射

- “发布到 issue tracker”：按上述结构创建本地文件。
- “获取相关 ticket”：读取用户提供的路径或对应编号的事项文件。

## Wayfinder 操作

使用 `/wayfinder` 时：

- 地图文件：`.scratch/<effort>/map.md`，记录 Notes、Decisions-so-far 与 Fog。
- 子事项：`.scratch/<effort>/issues/NN-<slug>.md`；正文记录问题，`Type:` 为 `research` / `prototype` / `grilling` / `task`。
- 该工作流使用 `Status: claimed` / `Status: resolved` 记录执行状态，与分诊标签区分。
- 依赖写在顶部 `Blocked by: NN, NN` 行；列出的事项全部 resolved 后才解除阻塞。
- 按编号选取最早的开放、未阻塞且未认领事项；开始前写入 `Status: claimed` 并保存。
- 解决后追加 `## Answer`，设为 `Status: resolved`，并将摘要与链接追加到地图的 Decisions-so-far。

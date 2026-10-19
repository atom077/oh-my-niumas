# oh-my-牛马s

以前我是牛马，现在我是牛马的项目经理。**Stop coding. Start herding.**

本地优先、只读的 AI 会话协作分析工具，关注多个独立会话的执行、等待与并行关系。

已具备 **四页合成数据 Demo + 本机只读日志接入**：总览、项目、会话与时间轴共用日期/项目/搜索筛选，支持闭合等待、异常轮次、Token 去重、项目折叠与并发曲线。

使用 Node 24（本项目 `.nvmrc`），首次运行 `npm install`。之后一条命令启动：

```sh
nvm use
npm start
```

打开终端打印的本机地址。开发模式使用 `npm run dev`，默认地址是 `http://127.0.0.1:4317`；HTTP 与开发热更新仅绑定 loopback。

验证命令：`npm test`、`npm run typecheck`、`npm run test:e2e`。浏览器测试默认使用 macOS Google Chrome，使用仓库内的隔离合成日志，生成四页截图。其他系统可修改 Playwright 的浏览器 executablePath。

![总览演示截图](docs/screenshots/overview.png)

本机数据：在“数据来源”中选“本机只读数据”，点击“扫描 / 刷新”。默认从 `~/.codex/sessions` 和 `archived_sessions` 发现日志；不读取会话标题或展示真实目录。项目/会话使用匿名名称，首版手动命名与合并延后。

SQLite 缓存位于 `.local/niumas.sqlite`（Git 忽略），只含白名单事件、匿名标识与扫描签名。没有原始提示词、工具输出或绝对路径。启动后主动刷新才加载本机数据；未变文件复用缓存，变化或截断文件重新解析。**当前不是按字节偏移追尾**，大文件更新会重读预算内前缀。

可选启动环境变量：`PORT`、`NIUMAS_LOG_ROOT`（默认 `~/.codex`）、`NIUMAS_DB_PATH`。它们只由本机进程配置，不接受浏览器传入任意文件路径。

为限制资源使用，单文件最多读 64 MiB，单次新读最多 1 GiB，最多发现 1000 个文件；大于 1 MiB 的行跳过。所有截断、跳过与排除会提示。历史未闭合不等于仍在运行，真实用户输入通常只有记录时间，因此精确等待可能是 N/A。Fork/子 Agent 作用域尚未验证时排除，不做父子累计。

- [项目与品牌方向](oh-my-niumas-project/PROJECT.md)
- [真实日志格式与可观测性边界](docs/log-format-findings.md)
- [指标公式与异常处理](docs/metrics-spec.md)
- [四页 UX 线框与交互](docs/ux-flows.md)
- [匿名观察样例与合成验收向量](fixtures/README.md)
- [领域术语](GLOSSARY.md)
- [实现规格与任务](.scratch/core-demo/spec.md)
- [验证记录与已知限制](docs/verification.md)

推进顺序：Phase 0 核验 → 四页合成数据 Demo → 本机只读日志接入。AI 等待时间不代表人工投入；会话跨度不代表执行时间；未知数据明确标注。

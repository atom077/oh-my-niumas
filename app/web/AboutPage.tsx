import type { Analysis } from "../core/types";
import type { ImportStatus } from "../importer";
import { ProjectLabels, type OriginalProject, type SaveLabel } from "./LocalLabels";

type Source = "demo" | "local";

/** Metric definitions that used to sit under every card and chart; wording follows PROJECT.md §5. */
const definitions: [string, string][] = [
  [
    "AI 总工作量",
    "各轮 AI 执行区间时长之和，多个会话重叠时分别累计；Cursor 轮次按记录时长计入（含无法定位绝对时间的记录）。",
  ],
  [
    "AI 活跃覆盖",
    "至少有一个 AI 在执行的现实时间，重叠部分只算一次；只使用能定位到绝对时间的区间。",
  ],
  [
    "平均并行倍数",
    "可定位区间的工作量 ÷ 活跃覆盖。悬停指标卡的 ⓘ 可查看本次的分子与分母。",
  ],
  [
    "峰值并行数",
    "同一时刻同时执行的独立轮次数。",
  ],
  [
    "已知 Token",
    "仅统计 Codex 会话有计数的部分，按上报事件时间整笔归属，不按执行时长分摊；Cursor 本机不记录 Token。",
  ],
  [
    "已知闭合等待",
    "AI 答完到你下一次发消息之间的间隔，只统计已闭合的等待。等待不是人工投入时间。",
  ],
  [
    "会话跨度",
    "会话首尾的时间差，包含轮次之间的间隔，不等于 AI 实际执行时长。",
  ],
  [
    "执行时长（日志边界）",
    "日志开始至终止的经过时间，包含工具、内部等待及可能的暂停，不等同应用内部执行计时。",
  ],
];

const legend: string[] = [
  "全天概览：格子颜色表示输入活动密度，不代表持续执行；空白格表示无输入，蓝色描边表示无输入但有已知执行。",
  "小时分段：输入点位于执行条上方，密集输入按分钟合并，悬停可查看原始时间；越过右边界的执行条带有继续标记。",
  "执行条为蓝色，闭合等待为黄色；“推算”标记表示该数值或执行条来自 Cursor 记录时长推算。",
  "列表与指标中的 N/A 表示数据缺失，缺失部分不补零；排序时 N/A 始终排在最后。",
];

/** Explanations, coverage evidence and low-frequency settings, kept off the analysis pages. */
export function AboutPage({
  data,
  source,
  scenario,
  importStatus,
  originalProjects,
  onSource,
  onScenario,
  save,
}: {
  data: Analysis | null;
  source: Source | null;
  scenario: string;
  importStatus: ImportStatus | null | undefined;
  originalProjects: OriginalProject[] | undefined;
  onSource: (next: Source) => void;
  onScenario: (next: string) => void;
  save: SaveLabel;
}) {
  const metrics = data?.metrics;
  return (
    <div className="about">
      <section className="panel about-section">
        <h2>数据来源</h2>
        <div className="about-controls">
          <label>
            数据来源
            <select
              aria-label="数据来源"
              className={"source-select " + (source ?? "")}
              value={source ?? "local"}
              disabled={!source}
              onChange={(e) => onSource(e.target.value as Source)}
            >
              <option value="local">本机数据</option>
              <option value="demo">演示数据</option>
            </select>
          </label>
          {source === "demo" && (
            <label>
              演示场景
              <select
                aria-label="演示场景"
                value={scenario}
                onChange={(e) => onScenario(e.target.value)}
              >
                <option value="parallel">三会话并行</option>
                <option value="boundaries">异常与跨日</option>
              </select>
            </label>
          )}
        </div>
        {source === "demo" ? (
          <p>演示数据是合成样例，并非你的真实使用记录。</p>
        ) : (
          <div className="import-summary">
            <p>
              {importStatus?.updatedAt
                ? `${importStatus.files} 个日志（重读 ${importStatus.readFiles} · 缓存 ${importStatus.cachedFiles} · 截断 ${importStatus.cappedFiles}）· 跳过 ${importStatus.skippedLines} 行 · 耗时 ${importStatus.durationMs} ms`
                : "尚未扫描，点击顶部“扫描 / 刷新”开始。"}
            </p>
            {importStatus?.providers && (
              <p>
                Codex {importStatus.providers.codex} 个会话 · Cursor{" "}
                {importStatus.providers.cursor} 个会话（只读{" "}
                {importStatus.cursor?.databases ?? 0} 个数据库）
              </p>
            )}
            {importStatus?.updatedAt && (
              <p>
                本次新增 {importStatus.addedFiles} 个、更新{" "}
                {importStatus.changedFiles} 个、移除{" "}
                {importStatus.removedFiles} 个日志；新增{" "}
                {importStatus.newSessions} 个会话。
              </p>
            )}
          </div>
        )}
        {source === "local" && originalProjects && (
          <ProjectLabels projects={originalProjects} save={save} />
        )}
      </section>
      {data && metrics && (
        <section className="panel about-section coverage">
          <h2>
            数据覆盖 · 边界 {metrics.closedTurns}/{metrics.observedTurns} 轮 ·{" "}
            {data.issues.length + (importStatus?.issues.length ?? 0)} 项提示
          </h2>
          <p>
            以下提示随当前筛选变化。工作量、覆盖与 Token
            都是可恢复的已知值；缺失部分未补零。最后开放等待只标状态，人工投入与真实账单不提供。
          </p>
          <ul>
            {data.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
            {importStatus?.issues.map((i, index) => (
              <li key={index}>{i}</li>
            ))}
          </ul>
          <p>
            本机抽样已对照应用记录接口 31 轮；桌面显示的耗时与 Token
            尚待核验，归档、跨版本与父子归属仍可能不完整。
          </p>
        </section>
      )}
      <section className="panel about-section">
        <h2>指标口径</h2>
        <dl className="definitions">
          {definitions.map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel about-section">
        <h2>时间轴图例</h2>
        <ul>
          {legend.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section className="panel about-section cursor-coverage">
        <h2>Cursor 口径</h2>
        <ul>
          <li>
            Cursor 执行区间按输入时间 + 记录时长推算（深色执行条），与结尾消息相差超过
            20 秒的轮次不绘制，只计记录时长；Cursor 未提供官方轮次边界。
          </li>
          <li>Cursor 项目按工作区目录归属，不能证明是会话起始目录。</li>
          <li>Cursor 本机不记录 Token，Token 指标只统计 Codex。</li>
          <li>
            混合来源的工作量合计 Codex 区间时长与 Cursor 记录累计；无法定位绝对时间的记录不参与覆盖与并发。
          </li>
        </ul>
      </section>
      <section className="panel about-section">
        <h2>隐私</h2>
        <p>
          只读本机日志、本地计算。页面只显示会话标题、项目目录名和手动标记，原始对话与完整路径不进入浏览器。真实发送时间及父子归属仍有覆盖限制。
        </p>
      </section>
    </div>
  );
}

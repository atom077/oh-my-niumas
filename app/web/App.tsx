import { useCallback, useEffect, useState } from "react";
import type { Analysis, Session } from "../core/types";
import { Timeline, Concurrency, duration, time, tokens } from "./Timeline";
import {
  ProjectLabels,
  SessionNote,
  type OriginalProject,
  type SaveLabel,
} from "./LocalLabels";
import { useLocalRefresh } from "./useLocalRefresh";
import type { ImportStatus } from "../importer";

type Page = "overview" | "projects" | "sessions" | "timeline";
type Response = Analysis & {
  source: "demo" | "local";
  importStatus: ImportStatus | null;
  projectOptions: Analysis["projects"];
  originalProjects: OriginalProject[];
};
const pages: { id: Page; icon: string; name: string }[] = [
  { id: "overview", icon: "◫", name: "工地总览" },
  { id: "projects", icon: "▧", name: "我的工地" },
  { id: "sessions", icon: "☷", name: "牛马花名册" },
  { id: "timeline", icon: "≋", name: "牛马考勤" },
];
const statusText: Record<string, string> = {
  completed: "已完成",
  aborted: "已中止",
  failed: "失败",
  unknown: "未知 / 未闭合",
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Date.now());
const midnight = (day: string) => Date.parse(day + "T00:00:00+08:00");

export function App() {
  const [page, setPage] = useState<Page>("overview"),
    [data, setData] = useState<Response | null>(null);
  const [project, setProject] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  const [source, setSource] = useState("demo"),
    [scenario, setScenario] = useState("parallel"),
    [range, setRange] = useState("all"),
    [status, setStatus] = useState("");
  const [from, setFrom] = useState(today() + "T00:00"),
    [to, setTo] = useState(today() + "T23:59");
  const [reload, setReload] = useState(0),
    [loading, setLoading] = useState(false);
  const onUpdated = useCallback(() => setReload((n) => n + 1), []);
  const live = useLocalRefresh(
    source === "local",
    Boolean(data?.source === "local" && data.importStatus?.updatedAt),
    onUpdated,
  );
  const [showWait, setShowWait] = useState(true),
    [zoom, setZoom] = useState(false),
    [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      source,
      scenario,
      project,
      search,
      status,
    });
    if (range === "middle") {
      params.set("from", String(Date.UTC(2026, 9, 19, 1, 20)));
      params.set("to", String(Date.UTC(2026, 9, 19, 1, 30)));
    }
    if (["today", "7", "30"].includes(range)) {
      const end = midnight(today()) + 86_400_000;
      params.set(
        "from",
        String(end - (range === "today" ? 1 : Number(range)) * 86_400_000),
      );
      params.set("to", String(end));
    }
    if (range === "custom") {
      const start = Date.parse(from + "+08:00"),
        end = Date.parse(to + "+08:00");
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        setError("请选择有效的开始与结束时间");
        return;
      }
      params.set("from", String(start));
      params.set("to", String(end));
    }
    setLoading(true);
    fetch("/api/analysis?" + params, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error("暂时无法读取分析数据，请重试");
        return r.json();
      })
      .then((v: Response) => {
        setData(v);
        setError("");
        setLoading(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [source, scenario, project, search, status, range, from, to, reload]);
  const openSession = useCallback((id: string) => {
    setSelected(id);
    setPage("sessions");
  }, []);
  const nav = (p: Page) => {
    setPage(p);
    setSelected("");
  };
  const reset = () => {
    setProject("");
    setSearch("");
    setStatus("");
    setRange("all");
    setSelected("");
    setCollapsed([]);
  };
  const saveLabel: SaveLabel = async (value) => {
    const response = await fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!response.ok) {
      const value = await response.json();
      throw Error(value.error || "保存失败");
    }
    if (value.action === "mergeProjects" || value.action === "restoreProject")
      setProject("");
    setReload((n) => n + 1);
  };
  const session = data?.sessions.find((s) => s.id === selected),
    metrics = data?.metrics;
  const title = pages.find((p) => p.id === page)!;
  const visibleData = data
    ? {
        ...data,
        sessions: data.sessions.filter((s) => !collapsed.includes(s.projectId)),
        intervals: data.intervals.filter(
          (i) =>
            !collapsed.includes(
              data.sessions.find((s) => s.id === i.sessionId)?.projectId ?? "",
            ),
        ),
      }
    : null;
  const date = new Date(data?.window.from ?? Date.now());
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            nav("overview");
          }}
        >
          <div className="brand-mark">
            牛<span>↗</span>
          </div>
          <div>
            oh-my-牛马s<small>THE AI AGENT HERDING DASHBOARD</small>
          </div>
        </a>
        <div className="workspace-label">
          MY WORKSPACE <span>LOCAL</span>
        </div>
        <nav>
          {pages.map((p) => (
            <button
              className={page === p.id ? "nav active" : "nav"}
              key={p.id}
              onClick={() => nav(p.id)}
              aria-current={page === p.id ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                {p.icon}
              </span>
              {p.name}
              <span className="nav-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="herd-sketch" aria-hidden="true">
            🐂 <span>🐎</span>
          </div>
          <strong>
            代码不一定我写，
            <br />
            进度一定我催。
          </strong>
          <p>一人带队，百马奔腾。</p>
          <div className="local-dot">本地优先 · 只读观测</div>
          <small>v0.1 / STOP CODING. START HERDING.</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            我的工作台 <span>/</span> {title.name}
          </div>
          <div className="top-right">
            <span className="status-dot" />
            本机运行<span className="avatar">牧</span>
          </div>
        </header>
        <div className="content" aria-busy={loading}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">HUMAN × AI / COLLABORATION</div>
              <h1>
                {page === "overview"
                  ? "我的赛博牛马们，今天干了多少活？"
                  : title.name}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {page === "overview"
                  ? "从一次派活，到多线并行。把每一段协作，看得清清楚楚。"
                  : page === "timeline"
                    ? "在同一条真实时间轴上，看看大家何时开工、何时收工。"
                    : page === "projects"
                      ? "把每个工地的工作量、会话与协作节奏放在一起。"
                      : "一次会话，多轮协作。执行多久，跨度多久，分别说清楚。"}
              </p>
            </div>
            <div className="date-stamp">
              <b>
                {new Intl.DateTimeFormat("en", {
                  timeZone: "Asia/Shanghai",
                  day: "2-digit",
                }).format(date)}
              </b>
              <span>
                {new Intl.DateTimeFormat("en", {
                  timeZone: "Asia/Shanghai",
                  month: "short",
                  year: "numeric",
                })
                  .format(date)
                  .toUpperCase()}
                <br />
                {range === "all" ? "ACTIVITY RANGE" : "SELECTED RANGE"}
              </span>
            </div>
          </div>
          <div className="filterbar">
            <select
              aria-label="数据来源"
              className="source-select"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                reset();
                if (e.target.value === "local") setRange("today");
                setData(null);
              }}
            >
              <option value="demo">● 合成演示数据</option>
              <option value="local">● 本机只读数据</option>
            </select>
            {source === "demo" && (
              <select
                aria-label="演示场景"
                value={scenario}
                onChange={(e) => {
                  setScenario(e.target.value);
                  reset();
                }}
              >
                <option value="parallel">三会话并行</option>
                <option value="boundaries">异常与跨日</option>
              </select>
            )}
            <span className="filter-divider" />
            <select
              aria-label="日期范围"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              <option value="all">全部活动</option>
              <option value="today">今天</option>
              <option value="7">最近 7 天</option>
              <option value="30">最近 30 天</option>
              {source === "demo" && scenario === "parallel" && (
                <option value="middle">09:20 — 09:30</option>
              )}
              <option value="custom">自定义时间</option>
            </select>
            <select
              aria-label="项目筛选"
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setSelected("");
              }}
            >
              <option value="">全部工地</option>
              {(data?.projectOptions ?? data?.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              aria-label="搜索会话"
              value={search}
              placeholder="⌕ 搜索会话"
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="timezone">UTC+08:00 · 上海</span>
            {source === "local" && (
              <>
                <button
                  className="refresh-button"
                  disabled={live.busy}
                  onClick={() => void live.refresh()}
                >
                  {live.busy ? "只读扫描中…" : "扫描 / 刷新"}
                </button>
                <select
                  aria-label="自动刷新"
                  value={live.period}
                  disabled={!data?.importStatus?.updatedAt}
                  onChange={(e) => live.changePeriod(e.target.value)}
                >
                  <option value="off">自动刷新：关闭</option>
                  <option value="15">每 15 秒</option>
                  <option value="30">每 30 秒</option>
                  <option value="60">每 60 秒</option>
                </select>
              </>
            )}
          </div>
          {range === "custom" && (
            <div className="date-controls">
              <label>
                开始时间{" "}
                <input
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <span>→</span>
              <label>
                结束时间{" "}
                <input
                  type="datetime-local"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <span>Asia/Shanghai · 结束边界不包含</span>
            </div>
          )}
          {error && (
            <div role="alert" className="notice error">
              {error}{" "}
              <button onClick={() => setReload((n) => n + 1)}>重试</button>
            </div>
          )}
          {source === "local" && live.error && (
            <div role="alert" className="notice error">
              {live.error}{" "}
              <button disabled={live.busy} onClick={() => void live.refresh()}>
                重试刷新
              </button>
            </div>
          )}
          {!data ? (
            <div className="empty">正在查看工地…</div>
          ) : (
            <>
              <div className="demo-note">
                {source === "demo" ? "DEMO" : "LOCAL"}
                <span>
                  {source === "demo"
                    ? "这些数字来自可复现的合成 Fixture，并非你的真实使用记录。"
                    : "仅必要元数据与手动标记；原始对话和目录不进入浏览器。"}
                </span>
                <button className="note-right" onClick={reset}>
                  清除筛选 ↺
                </button>
              </div>
              {source === "local" && (
                <div className="import-summary">
                  <div className="refresh-status" role="status">
                    {data.importStatus?.updatedAt
                      ? `最近刷新 ${time(Date.parse(data.importStatus.updatedAt))} · 耗时 ${data.importStatus.durationMs} ms · 新增 ${data.importStatus.addedFiles} 日志 / 更新 ${data.importStatus.changedFiles} 日志 / 移除 ${data.importStatus.removedFiles} 日志 · 新增 ${data.importStatus.newSessions} 会话 / 新增 ${data.importStatus.newTurns} 轮`
                      : "先手动扫描，再选择自动刷新频率"}
                    {live.period !== "off" &&
                      (live.hidden
                        ? " · 页面隐藏，自动刷新暂停"
                        : live.busy
                          ? " · 正在只读扫描"
                          : ` · 完成后间隔 ${live.period} 秒刷新`)}
                  </div>
                  {data.importStatus?.updatedAt
                    ? `${data.importStatus.files} 个日志 · ${data.importStatus.readFiles} 个重读 · ${data.importStatus.cachedFiles} 个缓存 · 截断 ${data.importStatus.cappedFiles} 个 · 跳过 ${data.importStatus.skippedLines} 行`
                    : "尚未导入本机日志，点击“扫描 / 刷新”开始。"}
                  <span>真实发送时间及父子归属仍有覆盖限制。</span>
                </div>
              )}
              {(page === "overview" || page === "timeline") && (
                <div className="metrics">
                  <Metric
                    label="AI 总工作量"
                    value={duration(metrics!.workloadMs)}
                    note={`已知执行 · 闭合 ${metrics!.closedTurns}/${metrics!.startedTurns} 轮`}
                  />
                  <Metric
                    label="AI 活跃覆盖"
                    value={duration(metrics!.coverageMs)}
                    note="去重后的现实时间"
                  />
                  <Metric
                    label="平均并行倍数"
                    value={
                      metrics!.averageParallelism === null
                        ? "N/A"
                        : metrics!.averageParallelism.toFixed(1) + "×"
                    }
                    note={`${duration(metrics!.workloadMs)} ÷ ${duration(metrics!.coverageMs)}`}
                  />
                  {page === "overview" ? (
                    <Metric
                      label="已知 Token"
                      value={tokens(metrics!.tokens)}
                      note={`${metrics!.tokenSessions}/${data.sessions.length} 会话有计数 · 按上报时间归属`}
                    />
                  ) : (
                    <Metric
                      label="峰值并行数"
                      value={String(metrics!.peakParallelism)}
                      note="同一时刻的独立执行轮次"
                    />
                  )}
                </div>
              )}
              {page === "overview" && (
                <>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <span className="section-kicker">
                          01 / LIVE FROM THE SITE
                        </span>
                        <h2>今天的协作节奏</h2>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => nav("timeline")}
                      >
                        展开完整时间轴 ↗
                      </button>
                    </div>
                    <Legend />
                    <Timeline data={data} onSession={openSession} compact />
                  </section>
                  <div className="recent-heading">
                    <h2>最近收工</h2>
                    <span>每一次完成，都有迹可循</span>
                  </div>
                  <div className="activity-grid">
                    {data.sessions
                      .filter((s) =>
                        s.turns.some((t) => t.status === "completed"),
                      )
                      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
                      .slice(0, 3)
                      .map((s) => (
                        <button
                          key={s.id}
                          className="activity"
                          onClick={() => openSession(s.id)}
                        >
                          <span className="activity-icon">✓</span>
                          <div>
                            <small>{s.projectName}</small>
                            <strong>{s.name}</strong>
                            <span>
                              {s.lastAt !== null ? time(s.lastAt) : "—"} ·
                              查看会话 →
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                </>
              )}
              {page === "projects" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">
                        PROJECTS / {data.projects.length} SITES
                      </span>
                      <h2>每个工地，都有自己的节奏</h2>
                    </div>
                  </div>
                  {source === "local" && (
                    <ProjectLabels
                      projects={data.originalProjects}
                      save={saveLabel}
                    />
                  )}
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>工地名称</th>
                          <th>会话</th>
                          <th>AI 工作量</th>
                          <th>已知闭合等待</th>
                          <th>已知 Token</th>
                          <th>去看施工 ↗</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.projects.map((p, i) => (
                          <tr key={p.id}>
                            <td>
                              <span className={"project-icon p" + i}>▧</span>
                              <b>{p.name}</b>
                            </td>
                            <td>{p.sessionCount}</td>
                            <td>{duration(p.workloadMs)}</td>
                            <td>{duration(p.waitingMs)}</td>
                            <td>{tokens(p.tokens)}</td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => {
                                  setProject(p.id);
                                  nav("sessions");
                                }}
                              >
                                查看会话 →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!data.projects.length && <Empty />}
                  <p className="table-note">
                    等待不是人工投入。Token
                    仅计已知路径，分项与异常在会话详情中展开。
                  </p>
                </section>
              )}
              {page === "sessions" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">
                        SESSIONS / A CLOSER LOOK
                      </span>
                      <h2>{session ? session.name : "牛马花名册"}</h2>
                    </div>
                    {session && (
                      <button
                        className="text-button"
                        onClick={() => setSelected("")}
                      >
                        ← 返回会话列表
                      </button>
                    )}
                  </div>
                  {session ? (
                    <>
                      {source === "local" && (
                        <SessionNote
                          key={session.id}
                          session={session}
                          save={saveLabel}
                        />
                      )}
                      <SessionDetail session={session} data={data} />
                    </>
                  ) : (
                    <>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>会话</th>
                              <th>工地</th>
                              <th>AI 执行累计</th>
                              <th>会话跨度</th>
                              <th>已知 Token</th>
                              <th>轮次</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.sessions.map((s) => (
                              <tr key={s.id}>
                                <td>
                                  <button
                                    className="session-button"
                                    onClick={() => openSession(s.id)}
                                  >
                                    {s.name} ↗
                                  </button>
                                  {s.note && (
                                    <small className="session-note-preview">
                                      {s.note}
                                    </small>
                                  )}
                                </td>
                                <td>{s.projectName}</td>
                                <td>{duration(s.workloadMs)}</td>
                                <td>{duration(s.spanMs)}</td>
                                <td>{tokens(s.tokens)}</td>
                                <td>
                                  {
                                    s.turns.filter(
                                      (t) =>
                                        (t.start ?? t.end ?? Infinity) <
                                          data.window.to &&
                                        (t.end ?? t.start ?? -Infinity) >=
                                          data.window.from,
                                    ).length
                                  }
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!data.sessions.length && <Empty />}
                    </>
                  )}
                </section>
              )}
              {page === "timeline" && (
                <section className="panel timeline-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">
                        TIMELINE / PARALLEL IS NORMAL
                      </span>
                      <h2>一人带队，百马奔腾。</h2>
                    </div>
                    <span className="mini-label">
                      峰值 {metrics!.peakParallelism} 路并行
                    </span>
                  </div>
                  <div className="timeline-controls">
                    <select
                      aria-label="包含轮次状态"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">全部状态</option>
                      {Object.entries(statusText).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <label>
                      <input
                        type="checkbox"
                        checked={showWait}
                        onChange={(e) => setShowWait(e.target.checked)}
                      />
                      显示闭合等待
                    </label>
                    <button onClick={() => setZoom((v) => !v)}>
                      {zoom ? "全窗口" : "放大 2×"}
                    </button>
                    {data.projects.map((p) => (
                      <button
                        key={p.id}
                        aria-expanded={!collapsed.includes(p.id)}
                        onClick={() =>
                          setCollapsed((v) =>
                            v.includes(p.id)
                              ? v.filter((i) => i !== p.id)
                              : [...v, p.id],
                          )
                        }
                      >
                        {collapsed.includes(p.id) ? "▸" : "▾"} {p.name}
                      </button>
                    ))}
                  </div>
                  <Legend />
                  <Timeline
                    data={visibleData!}
                    onSession={openSession}
                    showWait={showWait}
                    zoom={zoom}
                  />
                  <details
                    onToggle={(e) => {
                      if (e.currentTarget.open)
                        window.dispatchEvent(new Event("resize"));
                    }}
                  >
                    <summary>
                      查看同轴并发曲线 · 平均倍数只针对活跃覆盖时段
                    </summary>
                    <Concurrency data={data} />
                  </details>
                </section>
              )}
              <details className="coverage">
                <summary>
                  数据覆盖与口径 · 边界 {metrics!.closedTurns}/
                  {metrics!.startedTurns} 轮 · {data.issues.length} 项提示
                </summary>
                <p>
                  工作量、覆盖与 Token 都是可恢复的已知值；缺失部分未补零。Token
                  按上报事件时间整笔归属，不按执行时长分摊。最后开放等待只标状态，人工投入与真实账单不提供。
                </p>
                <ul>
                  {data.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                  {data.importStatus?.issues.map((i, index) => (
                    <li key={index}>{i}</li>
                  ))}
                </ul>
                <p>
                  本机抽样已对照应用记录接口 31 轮；桌面显示的耗时与 Token
                  尚待核验，归档、跨版本与父子归属仍可能不完整。
                </p>
              </details>
              <footer>
                <span>🐮 以前我是牛马，现在我是牛马的项目经理。</span>
                <span>等待 ≠ 人工投入 · 跨度 ≠ 执行</span>
              </footer>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        <span title={note} aria-hidden="true">
          ↗
        </span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function Empty() {
  return (
    <div className="empty">
      <h3>没有符合筛选的记录</h3>
      <p>试试清除搜索或切换项目。</p>
    </div>
  );
}
function Legend() {
  return (
    <div className="chart-legend">
      <span className="legend-dot" />
      AI 执行
      <span className="legend-dot waiting" />
      闭合等待<span className="input-diamond">◆</span>输入
      <span className="unknown-mark">?</span>未知
      <span className="legend-caption">重叠，是并行协作的正常状态</span>
    </div>
  );
}
function SessionDetail({
  session: s,
  data,
}: {
  session: Session;
  data: Response;
}) {
  const selected = s.turns.filter(
    (t) =>
      (t.start ?? t.end ?? Infinity) < data.window.to &&
      (t.end ?? t.start ?? -Infinity) >= data.window.from,
  );
  const usage = s.usage.filter(
    (u) => u.at >= data.window.from && u.at < data.window.to,
  );
  return (
    <>
      <div className="detail-metrics">
        <Metric
          label="AI 执行累计"
          value={duration(s.workloadMs)}
          note="日志开始至终止的经过时间，包含工具、内部等待及可能的暂停"
        />
        <Metric
          label="会话跨度"
          value={duration(s.spanMs)}
          note="包含轮次之间的间隔"
        />
      </div>
      <div className="session-notes">
        {data.source === "local" && (
          <span>日志边界经过时间不等同应用内部执行计时</span>
        )}
        <span>已知闭合等待 {duration(s.waitingMs)}</span>
        <span>
          {s.openWaiting ? "待下次输入（开放等待不累计）" : "无开放等待"}
        </span>
        <span>
          已知 Token {tokens(s.tokens)} ·{" "}
          {s.tokenComplete ? "记录路径基线完整" : "覆盖不完整或未知"}
        </span>
      </div>
      <div className="turns">
        {selected.map((t, i) => {
          const interval = data.intervals.find(
            (v) => v.turnId === t.id && v.kind === "ai_active",
          );
          return (
            <div className="turn" key={t.id}>
              <span className="turn-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>第 {s.turns.indexOf(t) + 1} 轮</strong>
                <p>
                  {t.start === null ? "起点未知" : time(t.start)} →{" "}
                  {t.end === null ? "终点未知" : time(t.end)} · 窗口内执行{" "}
                  {t.status === "unknown"
                    ? "N/A"
                    : duration(
                        interval ? interval.end - interval.start : 0,
                      )}{" "}
                  · Token {tokens(t.tokens)}
                </p>
              </div>
              <span className={"turn-status " + t.status}>
                {t.status === "unknown"
                  ? t.end === null
                    ? "缺少结束"
                    : t.start === null
                      ? "缺少开始"
                      : "边界冲突"
                  : statusText[t.status]}
              </span>
            </div>
          );
        })}
      </div>
      <details open={s.issues.length > 0}>
        <summary>数据证据与统计口径</summary>
        <p>
          来源 {data.source === "demo" ? "合成 Fixture" : "本机只读白名单"}；
          {s.turns.reduce((a, t) => a + t.evidence.length, 0)} 条边界证据。Token
          路径：{s.tokenMode}。日志版本：{s.versions.join(" / ") || "未记录"}。
        </p>
        <p>
          {s.tokenMode === "record"
            ? `Input ${tokens(usage.reduce((a, u) => a + u.input, 0))} / Cached ${tokens(usage.every((u) => u.cached !== null) ? usage.reduce((a, u) => a + (u.cached ?? 0), 0) : null)}（Input 子集）/ Output ${tokens(usage.reduce((a, u) => a + u.output, 0))} / Reasoning ${tokens(usage.every((u) => u.reasoning !== null) ? usage.reduce((a, u) => a + (u.reasoning ?? 0), 0) : null)}（Output 子集）`
            : "分项或轮次 Token 不足以确定，显示 N/A。"}
        </p>
        <ul>
          {s.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <p>
          匿名来源：
          {selected
            .flatMap((t) => t.evidence)
            .slice(0, 8)
            .map((e) => `${e.source.slice(0, 6)}:${e.line}`)
            .join(" · ")}
        </p>
      </details>
    </>
  );
}

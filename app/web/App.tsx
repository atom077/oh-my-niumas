import { useCallback, useEffect, useRef, useState } from "react";
import type { Analysis, Session } from "../core/types";
import { duration, time, tokens } from "./Timeline";
import {
  SessionNote,
  type OriginalProject,
  type SaveLabel,
} from "./LocalLabels";
import {
  CollaborationTimeline,
  type TimelineState,
} from "./CollaborationTimeline";
import { AdvancedTimeline } from "./AdvancedTimeline";
import { AboutPage } from "./AboutPage";
import { useLocalRefresh } from "./useLocalRefresh";
import {
  nextSort,
  projectTokens,
  projectWorkMs,
  sessionWorkMs,
  sortRows,
  windowTurns,
  type SortState,
} from "./table-sort";
import type { ImportStatus } from "../importer";

type Page = "overview" | "projects" | "sessions" | "about";
type ProjectSortKey = "work" | "sessions" | "waiting" | "tokens";
type SessionSortKey = "work" | "span" | "tokens" | "turns";
type Source = "demo" | "local";
type Response = Analysis & {
  source: Source;
  importStatus: ImportStatus | null;
  projectOptions: Analysis["projects"];
  originalProjects: OriginalProject[];
};
/** Mirrors `availability()` in the importer. */
interface LocalAvailability {
  ready: boolean;
  cached: boolean;
  sessions: number;
  lastAt: number | null;
}
/** The overview hosts the layered timeline, so analysis needs only three pages. */
const pages: { id: Page; icon: string; name: string }[] = [
  { id: "overview", icon: "◫", name: "总览" },
  { id: "projects", icon: "▧", name: "项目" },
  { id: "sessions", icon: "☷", name: "会话" },
];
/** Definitions, coverage evidence and rarely used settings live apart from the analysis pages. */
const aboutPage = { id: "about" as const, icon: "ⓘ", name: "说明与设置" };
const headings: Record<Page, string> = {
  overview: "AI 会话协作总览",
  projects: "项目",
  sessions: "会话",
  about: "说明与设置",
};
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
const shortDate = (at: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(at);

/** Narrowest preset that still contains the latest local activity, so the first screen is never empty. */
function rangeFor(lastAt: number | null): string {
  if (lastAt === null) return "all";
  const start = midnight(today());
  if (lastAt >= start) return "today";
  if (lastAt >= start - 6 * 86_400_000) return "7";
  if (lastAt >= start - 29 * 86_400_000) return "30";
  return "all";
}
const getAvailability = async (): Promise<LocalAvailability> => {
  const r = await fetch("/api/sources");
  if (!r.ok) throw Error("无法检测本机数据");
  return (await r.json()).local;
};
/** `?source=demo|local` pins the source, e.g. for bookmarks and reproducible screenshots. */
const pinnedSource = (): Source | null => {
  const v = new URLSearchParams(location.search).get("source");
  return v === "demo" || v === "local" ? v : null;
};

export function App() {
  const [page, setPage] = useState<Page>("overview"),
    [data, setData] = useState<Response | null>(null);
  const [project, setProject] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  // Null until local availability is known, so the demo never flashes before local data.
  const [source, setSource] = useState<Source | null>(() =>
    pinnedSource() === "demo" ? "demo" : null,
  );
  const [provider, setProvider] = useState("");
  const [scenario, setScenario] = useState("parallel"),
    [range, setRange] = useState("all"),
    [status, setStatus] = useState("");
  const [from, setFrom] = useState(today() + "T00:00"),
    [to, setTo] = useState(today() + "T23:59");
  const [reload, setReload] = useState(0),
    [loading, setLoading] = useState(false),
    [preparing, setPreparing] = useState(false);
  const lastLocalAt = useRef<number | null>(null);
  const onUpdated = useCallback(() => setReload((n) => n + 1), []);
  const analysisRequest = useRef<AbortController | null>(null);
  const cancelAnalysis = useCallback(() => {
    analysisRequest.current?.abort();
    analysisRequest.current = null;
    setLoading(false);
  }, []);
  const live = useLocalRefresh(
    source === "local",
    Boolean(data?.source === "local" && data.importStatus?.updatedAt),
    loading,
    onUpdated,
    cancelAnalysis,
  );
  const [timelineState, setTimelineState] = useState<TimelineState>({
    mode: "daily",
  });
  const [projectSort, setProjectSort] = useState<SortState<ProjectSortKey>>({
      key: "work",
      direction: "desc",
    }),
    [sessionSort, setSessionSort] = useState<SortState<SessionSortKey>>({
      key: "work",
      direction: "desc",
    });
  useEffect(() => {
    if (source !== null) return;
    let cancelled = false;
    const pinned = pinnedSource();
    (async () => {
      let local = await getAvailability();
      // A cache from an earlier scan survives restarts; rebuild it once (mostly cache hits) before showing.
      if (!local.ready && local.cached) {
        setPreparing(true);
        await fetch("/api/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        local = await getAvailability();
      }
      if (cancelled) return;
      lastLocalAt.current = local.lastAt;
      if (local.ready || pinned === "local") {
        setRange(local.ready ? rangeFor(local.lastAt) : "today");
        setSource("local");
      } else setSource("demo");
    })()
      .catch(() => !cancelled && setSource(pinned ?? "demo"))
      .finally(() => !cancelled && setPreparing(false));
    return () => {
      cancelled = true;
    };
  }, [source]);
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    analysisRequest.current = controller;
    const params = new URLSearchParams({
      source,
      scenario,
      provider,
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
        if (controller.signal.aborted || analysisRequest.current !== controller)
          return;
        setData(v);
        setError("");
        setLoading(false);
      })
      .catch((e) => {
        if (
          !controller.signal.aborted &&
          analysisRequest.current === controller &&
          e.name !== "AbortError"
        ) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      if (analysisRequest.current === controller)
        analysisRequest.current = null;
    };
  }, [
    source,
    scenario,
    provider,
    project,
    search,
    status,
    range,
    from,
    to,
    reload,
  ]);
  const openSession = useCallback((id: string) => {
    setSelected(id);
    setPage("sessions");
    window.scrollTo({ top: 0 });
  }, []);
  const nav = (p: Page) => {
    setPage(p);
    setSelected("");
    window.scrollTo({ top: 0 });
  };
  const reset = () => {
    setProject("");
    setProvider("");
    setSearch("");
    setStatus("");
    setRange("all");
    setSelected("");
    setTimelineState({ mode: "daily" });
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
  const cursorOnly =
    data?.source === "local" &&
    (provider === "cursor" ||
      (data.sessions.length > 0 &&
        data.sessions.every((s) => s.provider === "cursor")));
  /** Cursor exposes no usable token accounting locally, so token figures only describe Codex sessions. */
  const codexSessions =
    data?.sessions.filter((s) => s.provider !== "cursor").length ?? 0;
  const changeSource = (next: Source) => {
    setSource(next);
    reset();
    if (next === "local") setRange(rangeFor(lastLocalAt.current));
    setData(null);
  };
  const projectRows = data
    ? sortRows(
        data.projects,
        (p) =>
          ({
            work: () => projectWorkMs(data, p),
            sessions: () => p.sessionCount,
            waiting: () => p.waitingMs,
            tokens: () => projectTokens(data, p),
          })[projectSort.key](),
        projectSort.direction,
      )
    : [];
  const sessionRows = data
    ? sortRows(
        data.sessions,
        (s) =>
          ({
            work: () => sessionWorkMs(s),
            span: () => s.spanMs,
            tokens: () => (s.provider === "cursor" ? null : s.tokens),
            turns: () => windowTurns(data, s).length,
          })[sessionSort.key](),
        sessionSort.direction,
      )
    : [];
  const issueCount = data
    ? data.issues.length + (data.importStatus?.issues.length ?? 0)
    : 0;
  const viewScope = JSON.stringify([
    source,
    scenario,
    provider,
    range,
    from,
    to,
    project,
    search,
    status,
  ]);
  useEffect(() => {
    setTimelineState({ mode: "daily" });
  }, [viewScope]);
  const importStatus = data?.importStatus;
  // Window end is exclusive, so the last covered day is one millisecond earlier.
  const dateLabel = data
    ? shortDate(data.window.from) === shortDate(data.window.to - 1)
      ? shortDate(data.window.from)
      : `${shortDate(data.window.from)} — ${shortDate(data.window.to - 1)}`
    : "";
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
          <div className="brand-mark">牛</div>
          <div>
            oh-my-牛马s<small>AI 会话协作看板</small>
          </div>
        </a>
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
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={page === aboutPage.id ? "nav active" : "nav"}
            onClick={() => nav(aboutPage.id)}
            aria-current={page === aboutPage.id ? "page" : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
              {aboutPage.icon}
            </span>
            {aboutPage.name}
          </button>
          <strong>
            代码不一定我写，
            <br />
            进度一定我催。
          </strong>
        </div>
      </aside>
      <main>
        <div className="content" aria-busy={loading || preparing}>
          <div className="page-heading">
            <h1>
              {headings[page]}
              <span className="title-dot">.</span>
            </h1>
            {data && <span className="date-chip">{dateLabel}</span>}
          </div>
          <div className="filterbar">
            {source === "local" && (
              <select
                aria-label="会话来源"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setProject("");
                  setSelected("");
                  setTimelineState({ mode: "daily" });
                }}
              >
                <option value="">Codex + Cursor</option>
                <option value="codex">Codex</option>
                <option value="cursor">Cursor</option>
              </select>
            )}
            {source === "local" && <span className="filter-divider" />}
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
              <option value="">全部项目</option>
              {(data?.projectOptions ?? data?.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              aria-label="搜索会话"
              value={search}
              placeholder="搜索会话"
              onChange={(e) => setSearch(e.target.value)}
            />
            {source === "local" && (
              <div className="refresh-group">
                <button
                  className="refresh-button"
                  disabled={live.busy || loading}
                  onClick={() => void live.refresh()}
                >
                  {live.busy ? "只读扫描中…" : "扫描 / 刷新"}
                </button>
                <select
                  aria-label="自动刷新"
                  value={live.period}
                  disabled={!importStatus?.updatedAt}
                  onChange={(e) => live.changePeriod(e.target.value)}
                >
                  <option value="off">自动刷新：关</option>
                  <option value="15">每 15 秒</option>
                  <option value="30">每 30 秒</option>
                  <option value="60">每 60 秒</option>
                </select>
              </div>
            )}
          </div>
          {range === "custom" && (
            <div className="date-controls">
              <label>
                开始时间
                <input
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <span aria-hidden="true">→</span>
              <label>
                结束时间
                <input
                  type="datetime-local"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <small>北京时间 · 不含结束时刻</small>
            </div>
          )}
          {error && (
            <div role="alert" className="notice error">
              {error}
              <button onClick={() => setReload((n) => n + 1)}>重试</button>
            </div>
          )}
          {source === "local" && live.error && (
            <div role="alert" className="notice error">
              {live.error}
              <button disabled={live.busy} onClick={() => void live.refresh()}>
                重试刷新
              </button>
            </div>
          )}
          {page === "about" ? (
            <AboutPage
              data={data}
              source={source}
              scenario={scenario}
              importStatus={importStatus}
              originalProjects={data?.originalProjects}
              onSource={changeSource}
              onScenario={(next) => {
                setScenario(next);
                reset();
              }}
              save={saveLabel}
            />
          ) : !data ? (
            <div className="empty loading">
              {preparing ? "正在读取本机数据…" : "正在加载数据…"}
            </div>
          ) : (
            <>
              <div className="source-strip">
                <span
                  className={"source-pill " + data.source}
                  title={
                    data.source === "demo"
                      ? "合成样例，并非你的真实使用记录；可在“说明与设置”切换"
                      : "只读本机日志，原始对话不进入浏览器"
                  }
                >
                  {data.source === "demo" ? "演示数据" : "本机只读"}
                </span>
                {data.source === "local" && (
                  <span className="refresh-status" role="status">
                    {importStatus?.updatedAt
                      ? `最近刷新 ${time(
                          Date.parse(importStatus.updatedAt),
                        )} · ${importStatus.sessions} 个会话 · 新增 ${
                          importStatus.newTurns
                        } 轮`
                      : "尚未导入本机日志，点击“扫描 / 刷新”开始"}
                    {live.period !== "off" &&
                      (live.hidden
                        ? " · 页面隐藏，自动刷新暂停"
                        : live.busy
                        ? " · 正在只读扫描"
                        : ` · 每 ${live.period} 秒刷新`)}
                  </span>
                )}
                {issueCount > 0 && (
                  <button
                    className="issue-badge"
                    title="数据覆盖与推算说明"
                    onClick={() => nav("about")}
                  >
                    {issueCount} 项提示 →
                  </button>
                )}
                <button className="ghost-button note-right" onClick={reset}>
                  清除筛选 ↺
                </button>
              </div>
              {page === "overview" && (
                <div className="metrics">
                  <Metric
                    label={
                      cursorOnly ? "AI 累计时长 · Cursor 记录" : "AI 总工作量"
                    }
                    value={duration(
                      cursorOnly
                        ? metrics!.reportedWorkloadMs
                        : data.sessions.some((s) => s.turns.length > 0) &&
                          metrics!.closedTurns === 0 &&
                          metrics!.reportedWorkloadMs === null
                        ? null
                        : metrics!.workloadMs +
                          (metrics!.unlocatedReportedMs ?? 0),
                    )}
                    tag={
                      metrics!.inferredWorkloadMs > 0
                        ? "含推算"
                        : metrics!.reportedWorkloadMs !== null && !cursorOnly
                        ? "含 Cursor 记录"
                        : undefined
                    }
                    note={
                      cursorOnly
                        ? `记录覆盖 ${metrics!.reportedTurns}/${
                            metrics!.reportedTurnTotal
                          } 轮 · 推算区间 ${metrics!.closedTurns} 轮`
                        : `已知执行 · 闭合 ${metrics!.closedTurns}/${
                            metrics!.observedTurns
                          } 轮${
                            metrics!.reportedWorkloadMs !== null
                              ? ` · Codex ${duration(
                                  metrics!.workloadMs -
                                    metrics!.inferredWorkloadMs,
                                )} + Cursor 推算 ${duration(
                                  metrics!.inferredWorkloadMs,
                                )}${
                                  metrics!.unlocatedReportedMs
                                    ? ` + 未定位记录 ${duration(
                                        metrics!.unlocatedReportedMs,
                                      )}`
                                    : ""
                                }`
                              : ""
                          }`
                    }
                  />
                  <Metric
                    label="AI 活跃覆盖"
                    value={duration(
                      data.sessions.some((s) => s.turns.length > 0) &&
                        metrics!.closedTurns === 0
                        ? null
                        : metrics!.coverageMs,
                    )}
                    tag={
                      metrics!.inferredWorkloadMs > 0
                        ? "含推算"
                        : metrics!.reportedWorkloadMs !== null
                        ? "仅可定位"
                        : undefined
                    }
                    note={
                      metrics!.inferredWorkloadMs > 0
                        ? "含 Cursor 推算区间 · 去重后的现实时间"
                        : metrics!.reportedWorkloadMs !== null
                        ? "仅含可定位区间 · 去重后的现实时间"
                        : "去重后的现实时间"
                    }
                  />
                  <Metric
                    label="平均并行倍数"
                    value={
                      metrics!.averageParallelism === null
                        ? "N/A"
                        : metrics!.averageParallelism.toFixed(1) + "×"
                    }
                    tag={
                      metrics!.inferredWorkloadMs > 0
                        ? "含推算"
                        : metrics!.reportedWorkloadMs !== null
                        ? "仅可定位"
                        : undefined
                    }
                    note={
                      metrics!.coverageMs > 0
                        ? `${
                            metrics!.inferredWorkloadMs > 0
                              ? "含 Cursor 推算 · "
                              : metrics!.reportedWorkloadMs !== null
                              ? "仅含可定位区间 · "
                              : ""
                          }${duration(metrics!.workloadMs)} ÷ ${duration(
                            metrics!.coverageMs,
                          )}`
                        : "缺少可定位的执行区间"
                    }
                  />
                  {page === "overview" && !cursorOnly ? (
                    <Metric
                      label="已知 Token"
                      value={tokens(metrics!.tokens)}
                      tag={
                        metrics!.tokenSessions < codexSessions
                          ? `${metrics!.tokenSessions}/${codexSessions} 会话`
                          : undefined
                      }
                      note={`${metrics!.tokenSessions}/${codexSessions} 个 Codex 会话有计数 · 按上报时间归属`}
                    />
                  ) : (
                    <Metric
                      label="峰值并行数"
                      value={
                        metrics!.closedTurns === 0 &&
                        data.sessions.some((s) => s.provider === "cursor")
                          ? "N/A"
                          : String(metrics!.peakParallelism)
                      }
                      note="同一时刻的独立执行轮次"
                    />
                  )}
                </div>
              )}
              {page === "overview" && (
                <section className="overview-timeline">
                  <CollaborationTimeline
                    data={data}
                    state={timelineState}
                    onChange={setTimelineState}
                    onSession={openSession}
                    compact
                  />
                  <AdvancedTimeline
                    data={data}
                    scope={viewScope}
                    onSession={openSession}
                    status={status}
                    onStatus={setStatus}
                  />
                </section>
              )}
              {page === "projects" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>项目分析</h2>
                    <span className="mini-label">
                      {data.projects.length} 个项目
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>项目名称</th>
                          <SortHeader
                            label="会话数"
                            column="sessions"
                            sort={projectSort}
                            onSort={(k) => setProjectSort(nextSort(projectSort, k))}
                          />
                          <SortHeader
                            label="AI 工作量"
                            column="work"
                            sort={projectSort}
                            onSort={(k) => setProjectSort(nextSort(projectSort, k))}
                          />
                          <SortHeader
                            label="已知闭合等待"
                            column="waiting"
                            sort={projectSort}
                            onSort={(k) => setProjectSort(nextSort(projectSort, k))}
                          />
                          {!cursorOnly && (
                            <SortHeader
                              label="已知 Token"
                              column="tokens"
                              sort={projectSort}
                              onSort={(k) =>
                                setProjectSort(nextSort(projectSort, k))
                              }
                            />
                          )}
                          <th>会话详情</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectRows.map((p, i) => (
                          <tr key={p.id}>
                            <td>
                              <span className={"project-icon p" + (i % 2)}>
                                ▧
                              </span>
                              <b>{p.name}</b>
                            </td>
                            <td>{p.sessionCount}</td>
                            <td>
                              <span className="session-duration">
                                {duration(projectWorkMs(data, p))}
                                {p.reportedWorkloadMs !== null && (
                                  <small>
                                    {p.inferredWorkloadMs > 0
                                      ? "含 Cursor 推算"
                                      : "含 Cursor 记录"}
                                    {p.reportedTurns < p.reportedTurnTotal &&
                                      ` · ${p.reportedTurns}/${p.reportedTurnTotal} 轮`}
                                  </small>
                                )}
                              </span>
                            </td>
                            <td>{duration(p.waitingMs)}</td>
                            {!cursorOnly && (
                              <td>
                                {data.sessions.some(
                                  (s) =>
                                    s.projectId === p.id &&
                                    s.provider !== "cursor",
                                )
                                  ? tokens(p.tokens)
                                  : null}
                              </td>
                            )}
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
                </section>
              )}
              {page === "sessions" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>{session ? session.name : "会话"}</h2>
                    {session ? (
                      <button
                        className="text-button"
                        onClick={() => setSelected("")}
                      >
                        ← 返回会话列表
                      </button>
                    ) : (
                      <span className="mini-label">
                        {data.sessions.length} 个会话
                      </span>
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
                              <th>来源</th>
                              <th>项目</th>
                              <SortHeader
                                label="AI 执行累计"
                                column="work"
                                sort={sessionSort}
                                onSort={(k) =>
                                  setSessionSort(nextSort(sessionSort, k))
                                }
                              />
                              <SortHeader
                                label="会话跨度"
                                column="span"
                                sort={sessionSort}
                                onSort={(k) =>
                                  setSessionSort(nextSort(sessionSort, k))
                                }
                              />
                              {!cursorOnly && (
                                <SortHeader
                                  label="已知 Token"
                                  column="tokens"
                                  sort={sessionSort}
                                  onSort={(k) =>
                                    setSessionSort(nextSort(sessionSort, k))
                                  }
                                />
                              )}
                              <SortHeader
                                label="轮次"
                                column="turns"
                                sort={sessionSort}
                                onSort={(k) =>
                                  setSessionSort(nextSort(sessionSort, k))
                                }
                              />
                            </tr>
                          </thead>
                          <tbody>
                            {sessionRows.map((s) => (
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
                                <td>
                                  <span className="provider-badge">
                                    {s.provider === "cursor"
                                      ? "Cursor"
                                      : "Codex"}
                                  </span>
                                </td>
                                <td>{s.projectName}</td>
                                <td>
                                  {s.provider === "cursor" ? (
                                    <span
                                      className="session-duration"
                                      title="按轮次输入时间归属的 Cursor 记录值；通过校验的轮次另按记录时长推算执行区间"
                                    >
                                      {duration(sessionWorkMs(s))}
                                      <small>
                                        Cursor 记录
                                        {(s.reportedTurns ?? 0) <
                                          (s.reportedTurnTotal ?? 0) &&
                                          ` · ${s.reportedTurns ?? 0}/${
                                            s.reportedTurnTotal ?? 0
                                          } 轮`}
                                      </small>
                                    </span>
                                  ) : (
                                    duration(sessionWorkMs(s))
                                  )}
                                </td>
                                <td>{duration(s.spanMs)}</td>
                                {!cursorOnly && (
                                  <td>
                                    {s.provider === "cursor"
                                      ? null
                                      : tokens(s.tokens)}
                                  </td>
                                )}
                                <td>{windowTurns(data, s).length}</td>
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
            </>
          )}
          <footer>
            <span>以前我是牛马，现在我是牛马的项目经理。</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

/**
 * KPI card. `tag` keeps inferred or partial values visibly marked; the full formula and coverage
 * breakdown move into the ⓘ tooltip so the card stays a single number.
 */
function Metric({
  label,
  value,
  note,
  tag,
}: {
  label: string;
  value: string;
  note: string;
  tag?: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        {tag && <span className="metric-tag">{tag}</span>}
        <span className="metric-info" title={note} aria-label={note} role="img">
          ⓘ
        </span>
      </div>
      <strong>{value}</strong>
    </div>
  );
}
/** Column header that sorts its table; aria-sort reports the active column to assistive tech. */
function SortHeader<K extends string>({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: K;
  sort: SortState<K>;
  onSort: (column: K) => void;
}) {
  const active = sort.key === column;
  return (
    <th
      scope="col"
      aria-sort={
        active
          ? sort.direction === "desc"
            ? "descending"
            : "ascending"
          : "none"
      }
    >
      <button
        className={active ? "sort-button active" : "sort-button"}
        onClick={() => onSort(column)}
      >
        {label}
        <span aria-hidden="true">
          {active ? (sort.direction === "desc" ? "↓" : "↑") : "↕"}
        </span>
      </button>
    </th>
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
function SessionDetail({
  session: s,
  data,
}: {
  session: Session;
  data: Response;
}) {
  const selected = windowTurns(data, s);
  const usage = s.usage.filter(
    (u) => u.at >= data.window.from && u.at < data.window.to,
  );
  return (
    <>
      <div className="detail-metrics">
        <Metric
          label={
            s.provider === "cursor"
              ? "AI 执行累计 · Cursor 记录"
              : "AI 执行累计"
          }
          value={duration(sessionWorkMs(s))}
          note={
            s.provider === "cursor"
              ? `记录覆盖 ${s.reportedTurns ?? 0}/${
                  s.reportedTurnTotal ?? 0
                } 轮 · 执行区间按记录时长推算`
              : "日志开始至终止的经过时间，包含工具、内部等待及可能的暂停"
          }
        />
        <Metric
          label="会话跨度"
          value={duration(s.spanMs)}
          note="包含轮次之间的间隔"
        />
      </div>
      <div className="session-notes">
        <span className="provider-badge">
          {s.provider === "cursor" ? "Cursor" : "Codex"}
        </span>
        <span>已知闭合等待 {duration(s.waitingMs)}</span>
        <span>
          {s.waitingMs === null
            ? "开放等待未知"
            : s.openWaiting
            ? "待下次输入（开放等待不累计）"
            : "无开放等待"}
        </span>
        {s.provider !== "cursor" && (
          <span>
            已知 Token {tokens(s.tokens)} ·{" "}
            {s.tokenComplete ? "记录路径基线完整" : "覆盖不完整或未知"}
          </span>
        )}
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
                  {t.timing === "inferred"
                    ? `输入 ${time(t.start!)}`
                    : t.observedAt != null
                    ? `输入 ${time(t.observedAt)} · 起点未知`
                    : t.start === null
                    ? "起点未知"
                    : time(t.start)}{" "}
                  → {t.end === null ? "终点未知" : time(t.end)} · 窗口内执行{" "}
                  {t.status === "unknown"
                    ? "N/A"
                    : duration(
                        interval ? interval.end - interval.start : 0,
                      )}
                  {s.provider !== "cursor" && ` · Token ${tokens(t.tokens)}`}
                  {t.reportedDurationMs !== undefined && (
                    <span className="reported-duration">
                      {" "}
                      · Cursor 记录时长 {duration(t.reportedDurationMs)}
                      {t.timing === "inferred"
                        ? "（终点按此推算）"
                        : "（与消息跨度不一致或缺少校验，未绘制执行区间）"}
                    </span>
                  )}
                </p>
              </div>
              <span className={"turn-status " + t.status}>
                {t.timing === "inferred"
                  ? "推算完成"
                  : t.status === "unknown"
                  ? t.observedAt != null
                    ? "边界未知"
                    : t.end === null
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
          {data.source === "local" &&
            (s.titleSource === "cursor"
              ? "会话标题来自 Cursor 会话索引。 "
              : s.titleSource === "index"
              ? "会话标题来自 Codex 会话索引。 "
              : "索引中暂无该会话标题，显示为未命名会话。 ")}
          来源 {data.source === "demo" ? "合成样例" : "本机只读白名单"}；
          {s.turns.reduce((a, t) => a + t.evidence.length, 0)} 条边界证据。
          {s.provider !== "cursor" && `Token 路径：${s.tokenMode}。`}
          日志版本：{s.versions.join(" / ") || "未记录"}。
        </p>
        {s.provider !== "cursor" && (
          <p>
            {s.tokenMode === "record"
              ? `输入 ${tokens(
                  usage.reduce((a, u) => a + u.input, 0),
                )} / 缓存 ${tokens(
                  usage.every((u) => u.cached !== null)
                    ? usage.reduce((a, u) => a + (u.cached ?? 0), 0)
                    : null,
                )}（输入子集）/ 输出 ${tokens(
                  usage.reduce((a, u) => a + u.output, 0),
                )} / 推理 ${tokens(
                  usage.every((u) => u.reasoning !== null)
                    ? usage.reduce((a, u) => a + (u.reasoning ?? 0), 0)
                    : null,
                )}（输出子集）`
              : "分项或轮次 Token 不足以确定，显示 N/A。"}
          </p>
        )}
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

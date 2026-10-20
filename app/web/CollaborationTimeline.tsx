import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Analysis, Interval, Session, Turn } from "../core/types";
import { duration } from "./Timeline";
import { limitWindow, type TimeWindow } from "./timeline-window";
import {
  activityOverview,
  chartBox,
  clock,
  dateKey,
  dayStart,
  defaultHour,
  hourStart,
  hourWindow,
  inputClusters,
  inside,
  minuteWindow,
  plotTicks,
  overlaps,
  sessionsInWindow,
  turnsInWindow,
  turnAt,
  DAY,
  HOUR,
  MINUTE,
} from "./activity-model";

export interface TimelineState {
  mode: "daily" | "hour" | "turns";
  day?: number;
  hour?: number;
  sessionId?: string;
  turnId?: string;
  detailView?: TimeWindow;
}
const providerName = (s: Session) =>
  s.provider === "cursor" ? "Cursor" : "Codex";
const statuses = {
  completed: "已完成",
  aborted: "已中止",
  failed: "失败",
  unknown: "边界未知",
};

function PlotAxis({ view }: { view: TimeWindow }) {
  const span = view.to - view.from;
  const ticks = plotTicks(view);
  return (
    <div className="time-plot-axis" aria-label="真实时间刻度">
      {ticks.map((at) => (
        <span key={at} style={{ left: `${(100 * (at - view.from)) / span}%` }}>
          {clock(at, span < 2 * MINUTE)}
        </span>
      ))}
    </div>
  );
}

function PlotGrid({ view }: { view: TimeWindow }) {
  return (
    <>
      {plotTicks(view).map((at) => (
        <i
          key={at}
          className="plot-grid-line"
          aria-hidden="true"
          style={{
            left: `${(100 * (at - view.from)) / (view.to - view.from)}%`,
          }}
        />
      ))}
    </>
  );
}

function Execution({
  interval,
  view,
  onClick,
}: {
  interval: Interval;
  view: TimeWindow;
  onClick: () => void;
}) {
  const box = chartBox(interval.start, interval.end, view);
  if (!box) return null;
  const label = `${
    interval.kind === "ai_active" ? "AI 执行" : "闭合等待"
  } ${clock(Math.max(interval.start, view.from), true)}–${clock(
    Math.min(interval.end, view.to),
    true,
  )} · ${duration(
    Math.min(interval.end, view.to) - Math.max(interval.start, view.from),
  )}`;
  return (
    <button
      type="button"
      className={`execution-mark ${
        interval.kind === "awaiting_user" ? "wait-mark" : "active-mark"
      }${box.continued ? " continues" : ""}${box.preceded ? " preceded" : ""}`}
      style={{ left: `${box.left}%`, width: `${box.width}%` }}
      title={`${label}${box.continued ? " · 继续至下一时段" : ""}`}
      aria-label={label}
      onClick={onClick}
    >
      {box.width > 9 && (
        <span>
          {duration(
            Math.min(interval.end, view.to) -
              Math.max(interval.start, view.from),
          )}
          {box.continued ? " →" : ""}
        </span>
      )}
    </button>
  );
}

function ChartLegend() {
  return (
    <div className="layered-legend">
      <span>
        <i className="key-execution" />
        AI 执行
      </span>
      <span>
        <i className="key-wait" />
        闭合等待
      </span>
      <span>
        <i className="key-input" />
        输入活动
      </span>
      <small>等待下一次输入 ≠ 人工投入时间</small>
    </div>
  );
}

export function CollaborationTimeline({
  data,
  state,
  onChange,
  onSession,
  compact = false,
}: {
  data: Analysis;
  state: TimelineState;
  onChange: (value: TimelineState) => void;
  onSession: (id: string) => void;
  compact?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previousMode = useRef(state.mode);
  useEffect(() => {
    if (previousMode.current !== state.mode) {
      if (compact) root.current?.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: 0 });
    }
    previousMode.current = state.mode;
  }, [state.mode, compact]);
  const [showWait, setShowWait] = useState(true);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const overview = useMemo(() => activityOverview(data), [data]);
  const selectedHour = hourWindow(data, state.hour ?? defaultHour(data));
  const hourly = sessionsInWindow(data, selectedHour);
  const session =
    data.sessions.find((s) => s.id === state.sessionId) ??
    hourly[0] ??
    data.sessions[0];
  const turns = session ? turnsInWindow(data, session, selectedHour) : [];
  const fit = session
    ? minuteWindow(data, session, selectedHour)
    : selectedHour;
  const view = state.detailView
    ? limitWindow(state.detailView, selectedHour)
    : fit;
  const visibleTurns = session ? turnsInWindow(data, session, view) : [];
  const chosen = turns.find((t) => t.id === state.turnId) ?? turns[0];
  const chosenInterval =
    chosen &&
    data.intervals.find(
      (i) =>
        i.sessionId === session?.id &&
        i.turnId === chosen.id &&
        i.kind === "ai_active",
    );
  const fragmentIntervals = session
    ? data.intervals.filter(
        (i) =>
          i.sessionId === session.id &&
          i.kind === "ai_active" &&
          overlaps(i.start, i.end, selectedHour),
      )
    : [];
  const fragmentWork = fragmentIntervals.reduce(
    (n, i) =>
      n +
      Math.min(i.end, selectedHour.to) -
      Math.max(i.start, selectedHour.from),
    0,
  );
  const fragmentTimes = turns
    .flatMap((t) => {
      const i = fragmentIntervals.find((i) => i.turnId === t.id);
      return i
        ? [
            Math.max(i.start, selectedHour.from),
            Math.min(i.end, selectedHour.to),
          ]
        : [turnAt(t)];
    })
    .filter(Number.isFinite);
  const fragmentSpan = fragmentTimes.length
    ? fragmentTimes.reduce((a, b) => Math.max(a, b), -Infinity) -
      fragmentTimes.reduce((a, b) => Math.min(a, b), Infinity)
    : null;
  const selectedDay = state.day ?? dayStart(selectedHour.from);
  const cumulative =
    data.metrics.reportedWorkloadMs === null &&
    data.metrics.closedTurns === 0 &&
    data.sessions.some((s) => s.turns.length > 0)
      ? null
      : data.metrics.workloadMs + (data.metrics.reportedWorkloadMs ?? 0);
  const openHour = (at: number) =>
    onChange({
      ...state,
      mode: "hour",
      hour: hourStart(at),
      day: dayStart(at),
      sessionId: undefined,
      turnId: undefined,
      detailView: undefined,
    });
  const openSession = (s: Session, t?: Turn) =>
    onChange({
      ...state,
      mode: "turns",
      hour: selectedHour.from,
      sessionId: s.id,
      turnId: t?.id,
      detailView: undefined,
    });
  const setMode = (mode: TimelineState["mode"]) =>
    onChange({
      ...state,
      mode,
      hour: selectedHour.from,
      detailView: undefined,
    });
  const dayHours = Array.from(
    { length: 24 },
    (_, i) => selectedDay + i * HOUR,
  ).filter((at) => overlaps(at, at + HOUR, data.window));
  const chooseHour = (at: number) =>
    onChange({
      ...state,
      mode: "hour",
      hour: at,
      day: dayStart(at),
      detailView: undefined,
      turnId: undefined,
    });
  const rangeLabel = (w: TimeWindow) =>
    `${dateKey(w.from).slice(5)} ${clock(w.from, w.to - w.from < 2 * MINUTE)}–${
      dayStart(w.from) !== dayStart(w.to - 1)
        ? dateKey(w.to).slice(5) + " "
        : ""
    }${clock(w.to, w.to - w.from < 2 * MINUTE)}`;
  const inputCount = hourly.reduce(
    (n, s) => n + s.inputs.filter((i) => inside(i.at, selectedHour)).length,
    0,
  );

  return (
    <div
      ref={root}
      className={`collaboration-timeline${compact ? " compact-timeline" : ""}`}
      data-mode={state.mode}
    >
      <div className="layered-navigation">
        <div className="segmented" role="group" aria-label="时间轴层级">
          {(
            [
              ["daily", "全天概览"],
              ["hour", "小时分段"],
              ["turns", "会话轮次"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              aria-pressed={state.mode === mode}
              onClick={() => setMode(mode)}
              disabled={mode === "turns" && !session}
            >
              {label}
            </button>
          ))}
        </div>
        {state.mode === "daily" ? (
          <div className="layered-summary">
            <span>
              <b>{data.projects.length}</b> 个项目
            </span>
            <span>
              <b>{data.sessions.length}</b> 个会话
            </span>
            <span>
              AI 累计 <b>{duration(cumulative)}</b>
            </span>
          </div>
        ) : (
          <button
            className="text-button"
            onClick={() => setMode(state.mode === "turns" ? "hour" : "daily")}
          >
            {state.mode === "turns" ? "← 返回小时视图" : "← 全天概览"}
          </button>
        )}
      </div>
      {!data.sessions.length ? (
        <div className="empty">
          <h3>没有符合筛选的会话</h3>
          <p>调整日期或清除筛选，查看会话活动记录。</p>
        </div>
      ) : state.mode === "daily" ? (
        <>
          <section
            className="activity-overview panel"
            aria-label="项目活动概览"
          >
            <div className="panel-heading">
              <div>
                <h2>项目活动分布</h2>
                <p>颜色表示输入活动密度，不代表持续执行。</p>
              </div>
              <div className="density-legend">
                <span>少</span>
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} className={`density-level-${i}`} />
                ))}
                <span>多</span>
              </div>
            </div>
            <div className="density-scroll">
              <div
                className="density-matrix"
                style={{
                  minWidth: Math.max(650, 240 + overview.bins.length * 9),
                }}
              >
                <div className="density-axis">
                  <span>项目（共 {data.projects.length} 个）</span>
                  <div>
                    {overview.bins.map((bin, i) => {
                      const label = overview.multiDay
                        ? dateKey(bin.from).slice(5)
                        : clock(bin.from);
                      return overview.multiDay || i % 4 === 0 ? (
                        <span
                          key={bin.from}
                          style={{
                            left: `${(100 * i) / overview.bins.length}%`,
                          }}
                        >
                          {label}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>
                {overview.rows.map(({ project, sessions, cells }) => (
                  <div
                    key={project.id}
                    className="density-row"
                    data-project={project.name}
                  >
                    <div className="density-project">
                      <div>
                        <strong title={project.name}>{project.name}</strong>
                        <small>
                          {sessions.length} 个会话 ·{" "}
                          {[...new Set(sessions.map(providerName))].join(" + ")}
                        </small>
                      </div>
                      <span>
                        {duration(
                          project.reportedWorkloadMs === null &&
                            !sessions.some((s) =>
                              s.turns.some((t) => t.status !== "unknown"),
                            )
                            ? null
                            : project.workloadMs +
                                (project.reportedWorkloadMs ?? 0),
                        )}
                        {project.reportedWorkloadMs !== null && (
                          <small>含 Cursor 记录</small>
                        )}
                      </span>
                    </div>
                    <div
                      className="density-cells"
                      style={{
                        gridTemplateColumns: `repeat(${cells.length},minmax(8px,1fr))`,
                      }}
                    >
                      {cells.map((cell) => {
                        const level = cell.inputs
                          ? Math.min(
                              4,
                              Math.max(
                                1,
                                Math.ceil((cell.inputs / overview.maximum) * 4),
                              ),
                            )
                          : 0;
                        const selected = overview.multiDay
                          ? inside(selectedDay, cell)
                          : overlaps(selectedHour.from, selectedHour.to, cell);
                        const label = `${project.name} · ${rangeLabel(
                          cell,
                        )} · ${cell.inputs} 次输入${
                          cell.knownExecution ? " · 有已知执行" : ""
                        }`;
                        return (
                          <button
                            key={cell.from}
                            className={`density-cell density-level-${level}${
                              cell.knownExecution && !cell.inputs
                                ? " known-only"
                                : ""
                            }${selected ? " selected" : ""}`}
                            aria-label={label}
                            title={label}
                            onClick={() => {
                              if (overview.multiDay)
                                onChange({
                                  ...state,
                                  day: dayStart(cell.from),
                                  hour: cell.from,
                                });
                              else openHour(cell.from);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="density-caption">
              空白格表示无输入；蓝色边框表示无输入但有已知执行。
              {overview.step > DAY &&
                `当前每格 ${overview.step / DAY} 天；可通过日期筛选细化。`}
            </div>
            {overview.multiDay && (
              <div className="day-hour-picker">
                <label>
                  选择日期{" "}
                  <input
                    type="date"
                    aria-label="概览日期"
                    value={dateKey(selectedDay)}
                    min={dateKey(data.window.from)}
                    max={dateKey(data.window.to - 1)}
                    onChange={(e) => {
                      const at = Date.parse(`${e.target.value}T00:00:00+08:00`);
                      if (Number.isFinite(at))
                        onChange({ ...state, day: at, hour: at });
                    }}
                  />
                </label>
                <div className="hour-tiles">
                  {dayHours.map((at) => (
                    <button
                      key={at}
                      aria-label={`查看 ${dateKey(at)} ${clock(at)} 这一小时`}
                      onClick={() => openHour(at)}
                    >
                      {clock(at)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="density-selection">
              <span>
                已选 <b>{rangeLabel(selectedHour)}</b>
              </span>
              <button
                className="primary-button"
                onClick={() => openHour(selectedHour.from)}
              >
                查看这一小时 →
              </button>
            </div>
          </section>
          <p className="layered-note">
            Cursor 记录时长按输入时间归属，不补造执行区间。
          </p>
        </>
      ) : (
        <>
          <div className="hour-navigation">
            <button
              aria-label="前一小时"
              disabled={selectedHour.from <= data.window.from}
              onClick={() => chooseHour(hourStart(selectedHour.from) - HOUR)}
            >
              ←
            </button>
            <label>
              时段{" "}
              <input
                type="datetime-local"
                aria-label="小时开始"
                step="3600"
                value={`${dateKey(selectedHour.from)}T${clock(
                  hourStart(selectedHour.from),
                )}`}
                min={`${dateKey(data.window.from)}T${clock(data.window.from)}`}
                max={`${dateKey(data.window.to - 1)}T${clock(
                  data.window.to - 1,
                )}`}
                onChange={(e) => {
                  const at = Date.parse(e.target.value + "+08:00");
                  if (
                    Number.isFinite(at) &&
                    at < data.window.to &&
                    at + HOUR > data.window.from
                  )
                    chooseHour(at);
                }}
              />
            </label>
            {[-1, 0, 1].map((delta) => {
              const at = hourStart(selectedHour.from) + delta * HOUR;
              return (
                <button
                  key={delta}
                  className="hour-choice"
                  aria-pressed={delta === 0}
                  disabled={!overlaps(at, at + HOUR, data.window)}
                  onClick={() => chooseHour(at)}
                >
                  {clock(at)}–{clock(at + HOUR)}
                </button>
              );
            })}
            <button
              aria-label="后一小时"
              disabled={selectedHour.to >= data.window.to}
              onClick={() => chooseHour(hourStart(selectedHour.from) + HOUR)}
            >
              →
            </button>
          </div>
          {state.mode === "hour" ? (
            <>
              <p className="hour-summary">
                {new Set(hourly.map((s) => s.projectId)).size} 个项目 ·{" "}
                {hourly.length} 个会话 · {inputCount} 次输入{" "}
                <span>仅显示此小时有输入或执行的会话</span>
              </p>
              <section
                className="panel hourly-panel"
                aria-label="小时协作时间轴"
              >
                <div className="panel-heading">
                  <h2>
                    {clock(selectedHour.from)}–{clock(selectedHour.to)}{" "}
                    协作时间轴
                  </h2>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={showWait}
                      onChange={(e) => setShowWait(e.target.checked)}
                    />
                    显示闭合等待
                  </label>
                </div>
                {!hourly.length ? (
                  <div className="empty">
                    <h3>这一小时没有活动</h3>
                    <p>切换小时，或返回全天概览选择有活动的时段。</p>
                  </div>
                ) : (
                  <div className="layered-chart-scroll">
                    <div className="layered-chart">
                      <div className="plot-header">
                        <span>项目 / 会话</span>
                        <PlotAxis view={selectedHour} />
                      </div>
                      {data.projects
                        .filter((p) => hourly.some((s) => s.projectId === p.id))
                        .map((p) => {
                          const ss = hourly.filter((s) => s.projectId === p.id),
                            closed = folded.has(p.id);
                          return (
                            <div className="hour-project-group" key={p.id}>
                              <div className="hour-project-heading">
                                <button
                                  title={p.name}
                                  aria-expanded={!closed}
                                  onClick={() =>
                                    setFolded((v) => {
                                      const next = new Set(v);
                                      if (!next.delete(p.id)) next.add(p.id);
                                      return next;
                                    })
                                  }
                                >
                                  {closed ? "›" : "⌄"} {p.name}
                                  <small>
                                    {ss.length} 个会话 ·{" "}
                                    {[...new Set(ss.map(providerName))].join(
                                      " + ",
                                    )}
                                  </small>
                                </button>
                                {ss.some((s) => s.provider === "cursor") && (
                                  <small>Cursor：执行起止未验证</small>
                                )}
                              </div>
                              {!closed &&
                                ss.map((s) => (
                                  <div className="hour-session-row" key={s.id}>
                                    <button
                                      className="hour-session-name"
                                      title={s.name}
                                      onClick={() => openSession(s)}
                                    >
                                      <strong>{s.name}</strong>
                                      <span className="provider-badge">
                                        {providerName(s)}
                                      </span>
                                      <small>查看会话轮次 →</small>
                                    </button>
                                    <div
                                      className="time-track"
                                      style={
                                        { "--grid-count": 6 } as CSSProperties
                                      }
                                    >
                                      <PlotGrid view={selectedHour} />
                                      {data.intervals
                                        .filter(
                                          (i) =>
                                            i.sessionId === s.id &&
                                            (showWait ||
                                              i.kind !== "awaiting_user") &&
                                            overlaps(
                                              i.start,
                                              i.end,
                                              selectedHour,
                                            ),
                                        )
                                        .map((i) => (
                                          <Execution
                                            key={i.id}
                                            interval={i}
                                            view={selectedHour}
                                            onClick={() =>
                                              openSession(
                                                s,
                                                s.turns.find(
                                                  (t) => t.id === i.turnId,
                                                ),
                                              )
                                            }
                                          />
                                        ))}
                                      {s.turns
                                        .filter(
                                          (t) =>
                                            t.status === "unknown" &&
                                            inside(turnAt(t), selectedHour) &&
                                            !s.inputs.some(
                                              (i) => i.turnId === t.id,
                                            ),
                                        )
                                        .map((t) => (
                                          <button
                                            key={t.id}
                                            className="unknown-input-mark"
                                            style={{
                                              left: `${
                                                chartBox(
                                                  turnAt(t),
                                                  turnAt(t),
                                                  selectedHour,
                                                )!.left
                                              }%`,
                                            }}
                                            aria-label={`${
                                              s.name
                                            } · 边界观测 ${clock(
                                              turnAt(t),
                                              true,
                                            )}`}
                                            title="边界未知"
                                            onClick={() => openSession(s, t)}
                                          >
                                            <i />
                                          </button>
                                        ))}
                                      {inputClusters(s, selectedHour).map(
                                        (group) => (
                                          <button
                                            key={group.at}
                                            className="input-mark"
                                            style={{
                                              left: `${
                                                chartBox(
                                                  group.at,
                                                  group.at,
                                                  selectedHour,
                                                )!.left
                                              }%`,
                                            }}
                                            title={group.inputs
                                              .map((i) => clock(i.at, true))
                                              .join("、")}
                                            aria-label={`${s.name} · ${
                                              group.inputs.length
                                            } 次输入 · ${clock(
                                              group.at,
                                              true,
                                            )}`}
                                            onClick={() =>
                                              openSession(
                                                s,
                                                s.turns.find(
                                                  (t) =>
                                                    t.id ===
                                                    group.inputs[0].turnId,
                                                ),
                                              )
                                            }
                                          >
                                            <i />
                                            {group.inputs.length > 1 && (
                                              <small>
                                                {group.inputs.length}
                                              </small>
                                            )}
                                          </button>
                                        ),
                                      )}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
                <ChartLegend />
                <p className="layered-note">
                  输入点位于执行条上方；密集输入按分钟合并，悬停可查看原始时间。越过右边界的执行条带有继续标记。
                </p>
              </section>
            </>
          ) : session ? (
            <>
              <div className="minute-session-summary">
                <label>
                  会话{" "}
                  <select
                    aria-label="轮次会话"
                    value={session.id}
                    onChange={(e) =>
                      onChange({
                        ...state,
                        sessionId: e.target.value,
                        turnId: undefined,
                        detailView: undefined,
                      })
                    }
                  >
                    {data.sessions.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.projectName} / {s.name} · {providerName(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="provider-badge">{providerName(session)}</span>
                <span>{turns.length} 轮（当前小时片段）</span>
                <span className="fragment-workload">
                  {session.provider === "cursor"
                    ? "记录累计（当前小时归属）"
                    : "片段执行"}{" "}
                  <b>
                    {duration(
                      session.provider === "cursor"
                        ? turns.some((t) => t.reportedDurationMs !== undefined)
                          ? turns.reduce(
                              (n, t) => n + (t.reportedDurationMs ?? 0),
                              0,
                            )
                          : null
                        : fragmentIntervals.length
                        ? fragmentWork
                        : null,
                    )}
                  </b>
                </span>
                <span>
                  片段跨度 <b>{duration(fragmentSpan)}</b>
                </span>
                <button
                  className="text-button"
                  onClick={() => onSession(session.id)}
                >
                  会话完整详情 →
                </button>
              </div>
              <section
                className="panel minute-panel"
                aria-label="分钟级轮次详情"
              >
                <div className="panel-heading">
                  <div>
                    <h2>分钟级执行时间轴</h2>
                    <output aria-label="轮次显示范围">
                      {rangeLabel(view)}
                    </output>
                  </div>
                  <div className="segmented" role="group" aria-label="轮次缩放">
                    <button
                      disabled={view.to - view.from <= 1000}
                      onClick={() => {
                        const span = Math.max(1000, (view.to - view.from) / 2),
                          center = (view.from + view.to) / 2;
                        onChange({
                          ...state,
                          detailView: limitWindow(
                            { from: center - span / 2, to: center + span / 2 },
                            selectedHour,
                          ),
                        });
                      }}
                    >
                      放大
                    </button>
                    <button
                      disabled={
                        view.to - view.from >=
                        selectedHour.to - selectedHour.from
                      }
                      onClick={() => {
                        const span = (view.to - view.from) * 2,
                          center = (view.from + view.to) / 2;
                        onChange({
                          ...state,
                          detailView: limitWindow(
                            { from: center - span / 2, to: center + span / 2 },
                            selectedHour,
                          ),
                        });
                      }}
                    >
                      缩小
                    </button>
                    <button
                      onClick={() =>
                        onChange({ ...state, detailView: undefined })
                      }
                    >
                      还原
                    </button>
                  </div>
                </div>
                {!visibleTurns.length ? (
                  <div className="empty">
                    <h3>
                      {turns.length
                        ? "当前缩放范围没有轮次"
                        : "此会话在当前小时没有轮次"}
                    </h3>
                    <p>
                      {turns.length
                        ? "点击还原，查看完整小时片段。"
                        : "切换小时或选择其他会话。"}
                    </p>
                  </div>
                ) : (
                  <div className="layered-chart-scroll">
                    <div className="layered-chart minute-chart">
                      <div className="plot-header">
                        <span>轮次 / 时间</span>
                        <PlotAxis view={view} />
                      </div>
                      {visibleTurns.map((t) => {
                        const interval = data.intervals.find(
                          (i) =>
                            i.sessionId === session.id &&
                            i.turnId === t.id &&
                            i.kind === "ai_active" &&
                            overlaps(i.start, i.end, view),
                        );
                        const at =
                            session.inputs.find((i) => i.turnId === t.id)?.at ??
                            turnAt(t),
                          point = chartBox(at, at, view),
                          number = session.turns.indexOf(t) + 1;
                        const known = data.intervals.find(
                          (i) =>
                            i.sessionId === session.id &&
                            i.turnId === t.id &&
                            i.kind === "ai_active",
                        );
                        const ms = known
                          ? Math.max(
                              0,
                              Math.min(known.end, selectedHour.to) -
                                Math.max(known.start, selectedHour.from),
                            )
                          : null;
                        return (
                          <div
                            className={`minute-turn-row${
                              chosen?.id === t.id ? " selected" : ""
                            }`}
                            key={t.id}
                          >
                            <button
                              className="minute-turn-name"
                              onClick={() =>
                                onChange({ ...state, turnId: t.id })
                              }
                            >
                              <strong>第 {number} 轮</strong>
                              <small>
                                {t.start === null
                                  ? `输入 ${
                                      Number.isFinite(at)
                                        ? clock(at, true)
                                        : "未知"
                                    }`
                                  : clock(t.start, true)}
                                –
                                {t.end === null
                                  ? "结束未知"
                                  : clock(t.end, true)}
                              </small>
                              <span>
                                {known
                                  ? duration(ms)
                                  : t.reportedDurationMs !== undefined
                                  ? `Cursor 记录 ${duration(
                                      t.reportedDurationMs,
                                    )}`
                                  : "执行时长 N/A"}
                              </span>
                            </button>
                            <div className="time-track">
                              <PlotGrid view={view} />
                              {data.intervals
                                .filter(
                                  (i) =>
                                    i.sessionId === session.id &&
                                    i.turnId === t.id &&
                                    i.kind === "awaiting_user" &&
                                    overlaps(i.start, i.end, view),
                                )
                                .map((i) => (
                                  <button
                                    key={i.id}
                                    className="minute-wait-line"
                                    style={{
                                      left: `${
                                        chartBox(i.start, i.end, view)!.left
                                      }%`,
                                      width: `${
                                        chartBox(i.start, i.end, view)!.width
                                      }%`,
                                    }}
                                    aria-label={`第 ${number} 轮后的闭合等待 ${duration(
                                      Math.min(i.end, view.to) -
                                        Math.max(i.start, view.from),
                                    )}`}
                                    title="闭合等待，不是人工投入"
                                    onClick={() =>
                                      onChange({ ...state, turnId: t.id })
                                    }
                                  />
                                ))}
                              {interval && (
                                <>
                                  <Execution
                                    interval={interval}
                                    view={view}
                                    onClick={() =>
                                      onChange({ ...state, turnId: t.id })
                                    }
                                  />
                                  {chartBox(interval.start, interval.end, view)!
                                    .left < 90 && (
                                    <span
                                      className="short-duration"
                                      style={{
                                        left: `${Math.min(
                                          90,
                                          chartBox(
                                            interval.start,
                                            interval.end,
                                            view,
                                          )!.left +
                                            chartBox(
                                              interval.start,
                                              interval.end,
                                              view,
                                            )!.width,
                                        )}%`,
                                      }}
                                    >
                                      {duration(ms)}
                                    </span>
                                  )}
                                </>
                              )}
                              {!known && point && (
                                <button
                                  className="unknown-input-mark"
                                  style={{ left: `${point.left}%` }}
                                  aria-label={`第 ${number} 轮输入，执行边界未知`}
                                  title="仅有活动时间点，未补造执行条"
                                  onClick={() =>
                                    onChange({ ...state, turnId: t.id })
                                  }
                                >
                                  <i />
                                </button>
                              )}
                              {known && point && (
                                <button
                                  className="input-mark"
                                  style={{ left: `${point.left}%` }}
                                  aria-label={`第 ${number} 轮输入 ${clock(
                                    at,
                                    true,
                                  )}`}
                                  onClick={() =>
                                    onChange({ ...state, turnId: t.id })
                                  }
                                >
                                  <i />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {chosen && (
                  <div className="chosen-turn">
                    <strong>第 {session.turns.indexOf(chosen) + 1} 轮</strong>
                    <span className={`turn-status ${chosen.status}`}>
                      {statuses[chosen.status]}
                    </span>
                    <span>
                      开始{" "}
                      <b>
                        {chosen.start === null
                          ? "未知"
                          : clock(chosen.start, true)}
                      </b>
                    </span>
                    <span>
                      结束{" "}
                      <b>
                        {chosen.end === null ? "未知" : clock(chosen.end, true)}
                      </b>
                    </span>
                    {chosenInterval && (
                      <span>
                        本小时执行{" "}
                        <b>
                          {duration(
                            Math.min(chosenInterval.end, selectedHour.to) -
                              Math.max(chosenInterval.start, selectedHour.from),
                          )}
                        </b>
                      </span>
                    )}
                    {chosen.reportedDurationMs !== undefined && (
                      <span className="reported-duration">
                        Cursor 记录 <b>{duration(chosen.reportedDurationMs)}</b>
                      </span>
                    )}
                    <button
                      className="primary-button"
                      onClick={() => {
                        const ii = data.intervals.find(
                          (i) =>
                            i.sessionId === session.id &&
                            i.turnId === chosen.id &&
                            i.kind === "ai_active",
                        );
                        const from = ii
                            ? Math.max(ii.start, selectedHour.from)
                            : turnAt(chosen),
                          to = ii ? Math.min(ii.end, selectedHour.to) : from;
                        const pad = Math.max(1000, (to - from) * 0.15);
                        onChange({
                          ...state,
                          detailView: limitWindow(
                            {
                              from: from - pad,
                              to: Math.max(from + 1000, to) + pad,
                            },
                            selectedHour,
                          ),
                        });
                      }}
                    >
                      放大这一轮 →
                    </button>
                  </div>
                )}
                <ChartLegend />
                {session.provider === "cursor" && (
                  <p className="layered-note">
                    记录时长不代表可定位执行区间；此处仅展示已观测输入。
                  </p>
                )}
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

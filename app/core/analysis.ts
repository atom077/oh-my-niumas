import { createHash } from "node:crypto";
import type {
  Analysis,
  Dataset,
  Interval,
  Query,
  Session,
  Source,
  Turn,
  Usage,
} from "./types.ts";

export const key = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 20);
const record = (x: unknown): Record<string, any> =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? x : {};
const validNumber = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const addIssue = (s: Session, text: string) => {
  if (!s.issues.includes(text)) s.issues.push(text);
};

function timeBounds(values: number[]) {
  let min: number | null = null;
  let max: number | null = null;
  for (const value of values) {
    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
  }
  return { min, max };
}

function sameUsage(a: Usage, b: Usage) {
  return (
    a.at === b.at &&
    a.turnId === b.turnId &&
    a.tokens === b.tokens &&
    a.input === b.input &&
    a.cached === b.cached &&
    a.output === b.output &&
    a.reasoning === b.reasoning &&
    a.threadTotal === b.threadTotal
  );
}

function tokenValues(raw: unknown) {
  const v = record(raw);
  if (
    !validNumber(v.input_tokens) ||
    !validNumber(v.output_tokens) ||
    !validNumber(v.total_tokens) ||
    v.input_tokens + v.output_tokens !== v.total_tokens
  )
    return null;
  if (
    v.cached_input_tokens !== undefined &&
    (!validNumber(v.cached_input_tokens) ||
      v.cached_input_tokens > v.input_tokens)
  )
    return null;
  if (
    v.reasoning_output_tokens !== undefined &&
    (!validNumber(v.reasoning_output_tokens) ||
      v.reasoning_output_tokens > v.output_tokens)
  )
    return null;
  return {
    tokens: v.total_tokens,
    input: v.input_tokens,
    cached: v.cached_input_tokens ?? null,
    output: v.output_tokens,
    reasoning: v.reasoning_output_tokens ?? null,
  };
}

export function normalizeSources(sources: Source[]): Dataset {
  const unique = new Map<string, Session>();
  const issues: string[] = [];
  for (const source of sources) {
    const rows: { value: Record<string, any>; line: number }[] = [];
    let invalid = 0;
    source.text.split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      try {
        rows.push({ value: record(JSON.parse(line)), line: i + 1 });
      } catch {
        invalid++;
      }
    });
    const metas = rows
      .filter((r) => r.value.type === "session_meta")
      .map((r) => record(r.value.payload));
    const meta = metas[0];
    if (!meta || typeof meta.id !== "string" || !meta.id) {
      issues.push("一个来源缺少可识别的会话元数据");
      continue;
    }
    if (
      new Set(metas.map((m) => m.id)).size > 1 ||
      metas.some((m) => m.forked_from_id)
    ) {
      issues.push("已排除 fork 或多会话元数据来源，继承作用域未验证");
      continue;
    }
    if (record(meta.source).subagent || meta.parent_thread_id) {
      issues.push("已排除子 Agent 来源，父子归属未验证");
      continue;
    }
    const id = key(meta.id),
      projectId = key(typeof meta.cwd === "string" ? meta.cwd : "unassigned");
    let s = unique.get(id);
    if (!s) {
      s = {
        id,
        name: source.demo?.session ?? `会话 ${id.slice(0, 6)}`,
        projectId,
        projectName: source.demo?.project ?? `工地 ${projectId.slice(0, 6)}`,
        versions: [],
        turns: [],
        firstAt: null,
        lastAt: null,
        issues: [],
        inputs: [],
        usage: [],
        counters: [],
        tokens: null,
        tokenMode: "unknown",
        tokenComplete: false,
        recordSeen: false,
        conflictedUsageIds: [],
        workloadMs: 0,
        spanMs: null,
        waitingMs: null,
        openWaiting: false,
      };
      unique.set(id, s);
    } else if (s.projectId !== projectId)
      addIssue(s, "来源起始目录冲突，保留首次归属");
    for (const m of metas)
      if (
        typeof m.cli_version === "string" &&
        /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(m.cli_version) &&
        !s.versions.includes(m.cli_version)
      )
        s.versions.push(m.cli_version);
    if (invalid) addIssue(s, `跳过 ${invalid} 条不完整或无效 JSON`);
    if (metas.some((m) => m.cwd !== meta.cwd))
      addIssue(s, "工作目录发生变化，保留起始目录归属");
    const turns = new Map(s.turns.map((t) => [t.id, t]));
    const usageById = new Map(s.usage.map((u) => [u.id, u]));
    const conflictedUsageIds = new Set(s.conflictedUsageIds);
    const inputIds = new Set(s.inputs.map((i) => i.id));
    const counterIds = new Set(s.counters.map((c) => `${c.at}:${c.total}`));
    for (const { value: v, line } of rows) {
      const p = record(v.payload),
        at = typeof v.timestamp === "string" ? Date.parse(v.timestamp) : NaN;
      if (!Number.isFinite(at)) continue;
      const tid =
        typeof p.turn_id === "string" && p.turn_id
          ? key(`${meta.id}:${p.turn_id}`)
          : null;
      const evidence = { source: key(source.alias), line };
      if (
        v.type === "turn_context" &&
        typeof p.cwd === "string" &&
        p.cwd !== meta.cwd
      )
        addIssue(s, "工作目录发生变化，保留起始目录归属");
      if (v.type === "token_usage_record") {
        s.recordSeen = true;
        if (p.thread_id !== meta.id) {
          addIssue(s, "Token 作用域不匹配，已排除");
          continue;
        }
        const values = tokenValues(p.usage);
        if (!values || typeof p.response_id !== "string" || !p.response_id) {
          addIssue(s, "Token usage 缺少可靠标识或分项不一致");
          continue;
        }
        const uid = key(`${meta.id}:${p.response_id}`);
        if (conflictedUsageIds.has(uid)) continue;
        const entry: Usage = {
          id: uid,
          at,
          turnId: tid,
          ...values,
          threadTotal: validNumber(record(p.thread_token_usage).total_tokens)
            ? p.thread_token_usage.total_tokens
            : null,
          evidence,
        };
        const previous = usageById.get(uid);
        if (previous) {
          if (!sameUsage(previous, entry)) {
            addIssue(s, "同一响应 Token 记录冲突，已排除");
            conflictedUsageIds.add(uid);
            s.conflictedUsageIds.push(uid);
          }
          continue;
        }
        usageById.set(uid, entry);
        s.usage.push(entry);
      }
      if (v.type !== "event_msg") continue;
      if (p.type === "token_count") {
        const total = record(record(p.info).total_token_usage).total_tokens;
        if (validNumber(total) && !counterIds.has(`${at}:${total}`)) {
          counterIds.add(`${at}:${total}`);
          s.counters.push({ at, total, evidence });
        }
      }
      if (
        p.type === "item_completed" &&
        record(p.item).type === "UserMessage"
      ) {
        const item = record(p.item);
        if (typeof item.id === "string" && item.id) {
          const iid = key(`${meta.id}:${item.id}`);
          if (!inputIds.has(iid)) {
            inputIds.add(iid);
            s.inputs.push({
              id: iid,
              at,
              turnId: tid,
              exact: source.demo?.exactInputs === true,
            });
          }
        } else addIssue(s, "输入记录缺少稳定标识，未计入交互次数");
      }
      const isFailure = p.type === "task_failed" && source.demo;
      if (
        !["task_started", "task_complete", "turn_aborted"].includes(p.type) &&
        !isFailure
      )
        continue;
      if (!tid) {
        addIssue(s, "轮次边界缺少 turn_id");
        continue;
      }
      const turn: Turn = turns.get(tid) ?? {
        id: tid,
        start: null,
        end: null,
        status: "unknown",
        evidence: [],
        tokens: null,
      };
      if (p.type === "task_started") {
        if (turn.start !== null && turn.start !== at) {
          addIssue(s, "重复开始冲突");
          turn.conflict = true;
        } else turn.start = at;
      } else {
        const status =
          p.type === "turn_aborted"
            ? "aborted"
            : isFailure
              ? "failed"
              : "completed";
        if (
          turn.end !== null &&
          (turn.end !== at ||
            (turn.status !== "unknown" && turn.status !== status))
        ) {
          addIssue(s, "重复终止冲突");
          turn.conflict = true;
        } else {
          turn.end = at;
          turn.status = status;
        }
      }
      if (
        !turn.evidence.some(
          (e) => e.source === evidence.source && e.line === line,
        )
      )
        turn.evidence.push(evidence);
      turns.set(tid, turn);
    }
    s.turns = [...turns.values()].sort(
      (a, b) => (a.start ?? a.end ?? 0) - (b.start ?? b.end ?? 0),
    );
  }
  for (const s of unique.values()) {
    const conflictedUsageIds = new Set(s.conflictedUsageIds);
    s.usage = s.usage.filter((u) => !conflictedUsageIds.has(u.id));
    for (const t of s.turns) {
      if (t.conflict) t.status = "unknown";
      if (t.start !== null && t.end !== null && t.end < t.start) {
        addIssue(s, "结束早于开始");
        t.end = null;
        t.status = "unknown";
      }
      if (t.start === null || t.end === null) {
        addIssue(s, "轮次边界缺失，执行时间不完整");
        t.status = "unknown";
      }
    }
    let previous: Turn | undefined;
    for (const t of s.turns) {
      if (t.start === null || t.end === null) continue;
      if (previous && previous.end !== null && t.start < previous.end) {
        previous.status = "unknown";
        t.status = "unknown";
        addIssue(s, "同会话轮次重叠，已排除冲突区间");
      }
      if (!previous || t.end > (previous.end ?? 0)) previous = t;
    }
    s.usage.sort((a, b) => a.at - b.at);
    s.counters.sort((a, b) => a.at - b.at);
    s.inputs.sort((a, b) => a.at - b.at);
    s.tokenMode = s.usage.length
      ? "record"
      : !s.recordSeen && s.counters.length > 1
        ? "counter"
        : "unknown";
    s.tokenComplete =
      s.usage.length > 0 &&
      s.usage[0].threadTotal === s.usage[0].tokens &&
      !s.issues.some((i) => i.includes("Token"));
    if (s.usage.length && !s.tokenComplete)
      addIssue(s, "首条 Token 累计缺少零基线，仅显示已知 usage");
    for (let i = 1; i < s.usage.length; i++) {
      const prev = s.usage[i - 1],
        curr = s.usage[i];
      if (
        prev.threadTotal !== null &&
        curr.threadTotal !== null &&
        curr.threadTotal - prev.threadTotal !== curr.tokens
      ) {
        addIssue(s, "usage 与线程累计增量不一致，覆盖不完整");
        s.tokenComplete = false;
      }
    }
    const last = s.usage.at(-1),
      counter = s.counters.at(-1);
    if (
      last &&
      counter &&
      last.threadTotal !== null &&
      counter.at >= last.at &&
      counter.total !== last.threadTotal
    )
      addIssue(s, "压缩或计数路径分歧：未混加 token_count");
    const times = s.turns
      .flatMap((t) => [t.start, t.end])
      .concat(
        s.inputs.map((i) => i.at),
        s.usage.map((u) => u.at),
        s.counters.map((c) => c.at),
      )
      .filter((v): v is number => v !== null);
    const bounds = timeBounds(times);
    s.firstAt = bounds.min;
    s.lastAt = bounds.max;
  }
  return {
    sessions: [...unique.values()],
    issues: [...new Set(issues)].map(
      (text) => `${issues.filter((i) => i === text).length} 个来源：${text}`,
    ),
  };
}

export function analyze(dataset: Dataset, query: Query = {}): Analysis {
  const times = dataset.sessions
    .flatMap((s) => [s.firstAt, s.lastAt])
    .filter((v): v is number => v !== null);
  const bounds = timeBounds(times);
  const extent = {
    from: bounds.min ?? Date.UTC(2026, 9, 19, 1),
    to: bounds.max === null ? Date.UTC(2026, 9, 19, 2) : bounds.max + 1,
  };
  if (extent.from === extent.to) extent.to += 60_000;
  const window = { from: query.from ?? extent.from, to: query.to ?? extent.to };
  const inWindow = (at: number | null) =>
    at !== null && at >= window.from && at < window.to;
  const overlaps = (start: number | null, end: number | null) =>
    start !== null && end !== null && start < window.to && end > window.from;
  const hasActivity = (s: Session) =>
    s.turns.some(
      (t) =>
        inWindow(t.start) ||
        inWindow(t.end) ||
        (t.status !== "unknown" && overlaps(t.start, t.end)),
    ) ||
    s.inputs.some((i) => inWindow(i.at)) ||
    s.usage.some((u) => inWindow(u.at)) ||
    s.counters.some((c) => inWindow(c.at)) ||
    s.turns.some(
      (t) =>
        t.status === "completed" &&
        t.end !== null &&
        s.inputs.find((i) => i.at >= t.end! && i.turnId !== t.id)?.exact &&
        overlaps(
          t.end,
          s.inputs.find((i) => i.at >= t.end! && i.turnId !== t.id)!.at,
        ),
    );
  const sessions = structuredClone(
    dataset.sessions.filter(
      (s) =>
        (!query.project || s.projectId === query.project) &&
        (!query.search ||
          s.name
            .toLocaleLowerCase()
            .includes(query.search.toLocaleLowerCase())) &&
        (!query.status || s.turns.some((t) => t.status === query.status)) &&
        hasActivity(s),
    ),
  );
  const intervals: Interval[] = [];
  const clip = (start: number, end: number) => ({
    start: Math.max(start, window.from),
    end: Math.min(end, window.to),
  });
  for (const s of sessions) {
    s.workloadMs = 0;
    s.waitingMs = 0;
    s.openWaiting = false;
    const activityPoints = s.turns
      .flatMap((t) => [t.start, t.end])
      .filter((at): at is number => inWindow(at))
      .concat(
        s.inputs.map((i) => i.at).filter(inWindow),
        s.usage.map((u) => u.at).filter(inWindow),
        s.counters.map((c) => c.at).filter(inWindow),
      );
    for (const t of s.turns)
      if (t.status !== "unknown" && overlaps(t.start, t.end))
        activityPoints.push(
          Math.max(t.start!, window.from),
          Math.min(t.end!, window.to),
        );
    const activityBounds = timeBounds(activityPoints);
    s.spanMs =
      activityBounds.min === null || activityBounds.max === null
        ? null
        : activityBounds.max - activityBounds.min;
    const usage = s.usage.filter(
      (u) => u.at >= window.from && u.at < window.to,
    );
    s.tokens =
      s.tokenMode === "record" ? usage.reduce((n, u) => n + u.tokens, 0) : null;
    if (s.tokenMode === "counter") {
      s.tokens = 0;
      s.tokenComplete = false;
      addIssue(s, "仅恢复相邻累计增量，首条基线之前用量未知");
      for (let i = 1; i < s.counters.length; i++) {
        const prev = s.counters[i - 1],
          curr = s.counters[i];
        if (curr.total < prev.total) {
          addIssue(s, "累计 Token 重置，缺口未知");
          continue;
        }
        if (curr.at >= window.from && curr.at < window.to)
          s.tokens += curr.total - prev.total;
      }
    }
    for (const t of s.turns) {
      const attributed = usage.filter((u) => u.turnId === t.id);
      t.tokens =
        s.tokenMode === "record" && s.usage.some((u) => u.turnId === t.id)
          ? attributed.reduce((n, u) => n + u.tokens, 0)
          : null;
      if (t.start !== null && t.end !== null && t.status !== "unknown") {
        const bounds = clip(t.start, t.end);
        if (bounds.end > bounds.start) {
          intervals.push({
            id: t.id,
            sessionId: s.id,
            turnId: t.id,
            ...bounds,
            status: t.status,
            kind: "ai_active",
          });
          s.workloadMs += bounds.end - bounds.start;
        }
      }
      if (t.status !== "completed" || t.end === null || t.end >= window.to)
        continue;
      const input = s.inputs.find((i) => i.at >= t.end! && i.turnId !== t.id);
      if (!input) {
        s.openWaiting = true;
        continue;
      }
      const next = s.turns.find((next) => next.id === input.turnId);
      if (
        !input.exact ||
        (next?.start !== null &&
          next?.start !== undefined &&
          input.at > next.start)
      ) {
        s.waitingMs = null;
        addIssue(
          s,
          next?.start !== null &&
            next?.start !== undefined &&
            input.at > next.start
            ? "输入记录晚于执行开始，精确等待未知"
            : "输入只有观测时间，精确等待未知",
        );
        continue;
      }
      const bounds = clip(t.end, input.at);
      if (bounds.end > bounds.start) {
        if (s.waitingMs !== null) s.waitingMs += bounds.end - bounds.start;
        intervals.push({
          id: `wait-${t.id}`,
          sessionId: s.id,
          turnId: t.id,
          ...bounds,
          status: "completed",
          kind: "awaiting_user",
        });
      }
    }
  }
  const activeIntervals = intervals.filter((i) => i.kind === "ai_active");
  let coverageMs = 0,
    peakParallelism = 0,
    active = 0,
    previous = window.from;
  const concurrency: Analysis["concurrency"] = [];
  const events = activeIntervals
    .flatMap((i) => [
      [i.start, 1],
      [i.end, -1],
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [at, delta] of events) {
    if (active > 0) coverageMs += at - previous;
    active += delta;
    peakParallelism = Math.max(peakParallelism, active);
    previous = at;
    concurrency.push({ at, count: active });
  }
  const sumTokens = (ss: Session[]) =>
    ss.some((s) => s.tokens !== null)
      ? ss.reduce((n, s) => n + (s.tokens ?? 0), 0)
      : null;
  const sumWait = (ss: Session[]) =>
    ss.some((s) => s.waitingMs !== null)
      ? ss.reduce((n, s) => n + (s.waitingMs ?? 0), 0)
      : null;
  const projects = [...new Set(sessions.map((s) => s.projectId))].map((id) => {
    const ss = sessions.filter((s) => s.projectId === id);
    return {
      id,
      name: ss[0].projectName,
      sessionCount: ss.length,
      workloadMs: ss.reduce((a, s) => a + s.workloadMs, 0),
      tokens: sumTokens(ss),
      waitingMs: sumWait(ss),
    };
  });
  const workloadMs = sessions.reduce((n, s) => n + s.workloadMs, 0);
  const turns = sessions
    .flatMap((s) => s.turns)
    .filter(
      (t) =>
        (t.start ?? t.end ?? Infinity) < window.to &&
        (t.end ?? t.start ?? -Infinity) >= window.from,
    );
  return {
    sessions,
    projects,
    intervals,
    metrics: {
      workloadMs,
      coverageMs,
      averageParallelism: coverageMs ? workloadMs / coverageMs : null,
      peakParallelism,
      tokens: sumTokens(sessions),
      waitingMs: sumWait(sessions),
      closedTurns: turns.filter(
        (t) => t.start !== null && t.end !== null && t.status !== "unknown",
      ).length,
      startedTurns: turns.filter((t) => t.start !== null).length,
      tokenSessions: sessions.filter((s) => s.tokens !== null).length,
      inputCount: sessions
        .flatMap((s) => s.inputs)
        .filter((i) => i.at >= window.from && i.at < window.to).length,
    },
    window,
    extent,
    concurrency,
    issues: [
      ...new Set([...dataset.issues, ...sessions.flatMap((s) => s.issues)]),
    ],
    confidence: {
      timing: activeIntervals.length ? "observed" : "unknown",
      tokens:
        sumTokens(sessions) === null
          ? "unknown"
          : sessions.some((s) => s.tokenMode === "counter")
            ? "inferred"
            : "observed",
      waiting: sumWait(sessions) === null ? "unknown" : "observed",
    },
    provenance: {
      executionTurnIds: activeIntervals.map((i) => i.turnId),
      tokenEventIds: sessions.flatMap((s) =>
        s.tokenMode === "record"
          ? s.usage.filter((u) => inWindow(u.at)).map((u) => u.id)
          : s.counters
              .filter((c) => inWindow(c.at))
              .map((c) => `${c.evidence.source}:${c.evidence.line}`),
      ),
      inputEventIds: sessions.flatMap((s) =>
        s.inputs.filter((i) => inWindow(i.at)).map((i) => i.id),
      ),
    },
  };
}

export function analyzeSources(sources: Source[], query: Query = {}) {
  return analyze(normalizeSources(sources), query);
}

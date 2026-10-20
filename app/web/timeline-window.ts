import type { Analysis, Session, Turn } from "../core/types";

export type TimeWindow = Analysis["window"];
export type ViewChoice =
  | { mode: "fit" | "full" | "morning" | "afternoon" }
  | { mode: "custom"; window: TimeWindow };
export interface TimelineItem {
  value: [number, number, number, number, number];
  sessionId: string;
  turnId: string | null;
}

export function timelineItems(data: Analysis, showWait = true): TimelineItem[] {
  const items: TimelineItem[] = data.intervals
    .filter((i) => showWait || i.kind !== "awaiting_user")
    .map((i) => ({
      value: [
        data.sessions.findIndex((s) => s.id === i.sessionId),
        i.start,
        i.end,
        i.kind === "awaiting_user" ? 1 : 0,
        i.status === "completed" ? 0 : 1,
      ],
      sessionId: i.sessionId,
      turnId: i.turnId,
    }));
  data.sessions.forEach((s, lane) => {
    for (const t of s.turns) {
      const at = t.start ?? t.end ?? t.observedAt ?? null;
      if (
        t.status === "unknown" &&
        at !== null &&
        at >= data.window.from &&
        at < data.window.to
      )
        items.push({
          value: [lane, at, at, 2, 0],
          sessionId: s.id,
          turnId: t.id,
        });
    }
    for (const input of s.inputs)
      if (input.at >= data.window.from && input.at < data.window.to)
        items.push({
          value: [lane, input.at, input.at, 3, 0],
          sessionId: s.id,
          turnId: input.turnId,
        });
  });
  return items;
}

/** Pixel heights of a session lane and of one expanded turn step. */
export const ROW_HEIGHT = { project: 64, session: 60, turn: 34 } as const;

export interface TimelineRow {
  kind: "project" | "session" | "turn";
  projectId: string;
  key: string;
  sessionId: string;
  /** Pixel offset of the row top inside the plot area. */
  top: number;
  height: number;
  /** Pixel center; the chart y axis uses the same pixel units. */
  y: number;
  /** Session rows only: turns that can be unfolded into steps. */
  turnCount?: number;
  turnId?: string;
  /** 1-based number of the turn within the whole session. */
  turnNumber?: number;
  /** 0-based position within the visible staircase. */
  step?: number;
}

/** Turns that leave a visible mark inside the current statistics window. */
export function stairTurns(data: Analysis, session: Session): Turn[] {
  const visible = new Set(
    data.intervals
      .filter((i) => i.sessionId === session.id)
      .map((i) => i.turnId),
  );
  return session.turns
    .filter((t) => {
      if (visible.has(t.id)) return true;
      const at = t.start ?? t.end ?? t.observedAt ?? null;
      return (
        t.status === "unknown" &&
        at !== null &&
        at >= data.window.from &&
        at < data.window.to
      );
    })
    .sort(
      (a, b) =>
        (a.start ?? a.end ?? a.observedAt ?? Infinity) -
        (b.start ?? b.end ?? b.observedAt ?? Infinity),
    );
}

/** Project summary -> optional session lanes -> optional turn stairs. */
export function timelineRows(
  data: Analysis,
  expanded: ReadonlySet<string>,
  expandedProjects: ReadonlySet<string> = new Set(),
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let top = 0;
  for (const project of data.projects) {
    const sessions = data.sessions.filter((s) => s.projectId === project.id);
    if (!sessions.length) continue;
    rows.push({
      key: `project:${project.id}`,
      kind: "project",
      projectId: project.id,
      sessionId: "",
      top,
      height: ROW_HEIGHT.project,
      y: top + ROW_HEIGHT.project / 2,
    });
    top += ROW_HEIGHT.project;
    if (!expandedProjects.has(project.id)) continue;
    for (const s of sessions) {
      const turns = stairTurns(data, s);
      rows.push({
        key: s.id,
        kind: "session",
        projectId: project.id,
        sessionId: s.id,
        top,
        height: ROW_HEIGHT.session,
        y: top + ROW_HEIGHT.session / 2,
        turnCount: turns.length,
      });
      top += ROW_HEIGHT.session;
      if (!expanded.has(s.id) || turns.length < 2) continue;
      turns.forEach((t, step) => {
        rows.push({
          key: `${s.id}:${t.id}`,
          kind: "turn",
          projectId: project.id,
          sessionId: s.id,
          top,
          height: ROW_HEIGHT.turn,
          y: top + ROW_HEIGHT.turn / 2,
          turnId: t.id,
          turnNumber: s.turns.indexOf(t) + 1,
          step,
        });
        top += ROW_HEIGHT.turn;
      });
    }
  }
  return rows;
}

/** Merge only touching or overlapping ranges: idle gaps remain empty. */
export function unionRanges(ranges: TimeWindow[]): TimeWindow[] {
  const merged: TimeWindow[] = [];
  for (const range of [...ranges].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  )) {
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}
function waitingOutsideActive(waits: TimeWindow[], active: TimeWindow[]) {
  const result: TimeWindow[] = [];
  for (const wait of waits) {
    let from = wait.from;
    for (const ai of active) {
      if (ai.to <= from) continue;
      if (ai.from >= wait.to) break;
      if (ai.from > from) result.push({ from, to: Math.min(ai.from, wait.to) });
      from = Math.max(from, ai.to);
      if (from >= wait.to) break;
    }
    if (from < wait.to) result.push({ from, to: wait.to });
  }
  return result;
}

/** value: [y, start, end, kind, abnormal, rowHeight, faded, targetY]; kind 4 is a stair connector. */
export interface PlacedItem {
  value: [number, number, number, number, number, number, number, number];
  sessionId: string;
  projectId?: string;
  label: string;
}

export function placeItems(
  data: Analysis,
  rows: TimelineRow[],
  showWait = true,
): PlacedItem[] {
  const sessionRows = new Map<string, TimelineRow>(),
    turnRows = new Map<string, TimelineRow>(),
    names = new Map(data.sessions.map((s) => [s.id, s.name]));
  for (const row of rows)
    if (row.kind === "project") continue;
    else if (row.turnId) turnRows.set(`${row.sessionId}:${row.turnId}`, row);
    else sessionRows.set(row.sessionId, row);
  const placed: PlacedItem[] = [];
  const put = (item: TimelineItem, row: TimelineRow, faded: boolean) => {
    const [, start, end, kind, abnormal] = item.value;
    placed.push({
      value: [row.y, start, end, kind, abnormal, row.height, faded ? 1 : 0, 0],
      sessionId: item.sessionId,
      label:
        (names.get(item.sessionId) ?? "") +
        (row.turnNumber ? ` · 第 ${row.turnNumber} 轮` : ""),
    });
  };
  for (const item of timelineItems(data, showWait)) {
    const sessionRow = sessionRows.get(item.sessionId);
    if (!sessionRow) continue;
    const turnRow = item.turnId
      ? turnRows.get(`${item.sessionId}:${item.turnId}`)
      : undefined;
    // Expanded sessions keep a faded summary so the overlap with other sessions stays readable.
    put(item, sessionRow, Boolean(turnRow));
    if (turnRow) put(item, turnRow, false);
  }
  // A project row summarizes coverage, not the span from its first activity to its last.
  const allItems = timelineItems(data, showWait);
  for (const row of rows.filter((r) => r.kind === "project")) {
    const ss = data.sessions.filter((s) => s.projectId === row.projectId);
    const ids = new Set(ss.map((s) => s.id));
    const project = data.projects.find((p) => p.id === row.projectId)!;
    const ii = data.intervals.filter((i) => ids.has(i.sessionId));
    const active = unionRanges(
      ii
        .filter((i) => i.kind === "ai_active")
        .map((i) => ({ from: i.start, to: i.end })),
    );
    const waits = showWait
      ? waitingOutsideActive(
          unionRanges(
            ii
              .filter((i) => i.kind === "awaiting_user")
              .map((i) => ({ from: i.start, to: i.end })),
          ),
          active,
        )
      : [];
    const faded = ss.some((s) => sessionRows.has(s.id)) ? 1 : 0;
    for (const [kind, ranges] of [
      [0, active],
      [1, waits],
    ] as const)
      for (const range of ranges)
        placed.push({
          value: [row.y, range.from, range.to, kind, 0, row.height, faded, 0],
          sessionId: "",
          projectId: row.projectId,
          label: `${project.name} · ${ss.length} 个会话`,
        });
    const points = new Set<string>();
    for (const item of allItems) {
      if (!ids.has(item.sessionId) || item.value[3] < 2) continue;
      const [, at, , kind] = item.value;
      const pointKey = `${kind}:${at}`;
      if (points.has(pointKey)) continue;
      points.add(pointKey);
      placed.push({
        value: [row.y, at, at, kind, 0, row.height, faded, 0],
        sessionId: "",
        projectId: row.projectId,
        label: `${project.name} · ${ss.length} 个会话`,
      });
    }
  }
  // Vertical connector where each next turn begins, dropping one step.
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1],
      next = rows[i];
    if (!prev.turnId || !next.turnId || prev.sessionId !== next.sessionId)
      continue;
    const turn = data.sessions
      .find((s) => s.id === next.sessionId)
      ?.turns.find((t) => t.id === next.turnId);
    const at = turn?.start ?? turn?.end ?? turn?.observedAt ?? null;
    if (at === null) continue;
    placed.push({
      value: [prev.y, at, at, 4, 0, next.height, 0, next.y],
      sessionId: next.sessionId,
      label: names.get(next.sessionId) ?? "",
    });
  }
  return placed;
}

export function limitWindow(view: TimeWindow, full: TimeWindow): TimeWindow {
  if (
    !Number.isFinite(view.from) ||
    !Number.isFinite(view.to) ||
    view.to <= view.from
  )
    return full;
  const span = Math.min(view.to - view.from, full.to - full.from);
  const from = Math.max(full.from, Math.min(view.from, full.to - span));
  return { from, to: from + span };
}

export function dayPreset(
  full: TimeWindow,
  mode: "morning" | "afternoon",
): TimeWindow | null {
  const day = (at: number) => Math.floor((at + 8 * 3600000) / 86400000);
  if (day(full.from) !== day(full.to - 1)) return null;
  const start = day(full.from) * 86400000 - 8 * 3600000;
  const from = Math.max(
    full.from,
    start + (mode === "afternoon" ? 12 * 3600000 : 0),
  );
  const to = Math.min(
    full.to,
    start + (mode === "morning" ? 12 * 3600000 : 86400000),
  );
  return to > from ? { from, to } : null;
}

export function resolveView(data: Analysis, choice: ViewChoice): TimeWindow {
  if (choice.mode === "custom") return limitWindow(choice.window, data.window);
  if (choice.mode === "full") return data.window;
  if (choice.mode === "morning" || choice.mode === "afternoon")
    return dayPreset(data.window, choice.mode) ?? data.window;
  let from = Infinity,
    to = -Infinity;
  for (const item of timelineItems(data)) {
    from = Math.min(from, item.value[1]);
    to = Math.max(to, item.value[2]);
  }
  if (!Number.isFinite(from)) return data.window;
  const pad = Math.max(5 * 60000, (to - from) * 0.05);
  return {
    from: Math.max(data.window.from, Math.floor((from - pad) / 60000) * 60000),
    to: Math.min(data.window.to, Math.ceil((to + pad) / 60000) * 60000),
  };
}

export function localDateTime(at: number): string {
  return new Date(at + 8 * 3600000).toISOString().slice(0, 23);
}
export const viewTime = (at: number, precise = false) =>
  localDateTime(at)
    .slice(5, precise ? 23 : 16)
    .replace("T", " ");
export function containsActivity(
  data: Analysis,
  view: TimeWindow,
  showWait = true,
): boolean {
  return timelineItems(data, showWait).some(({ value: [, from, to] }) =>
    from === to
      ? from >= view.from && from < view.to
      : from < view.to && to > view.from,
  );
}

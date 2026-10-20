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
      const at = t.start ?? t.end;
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
export const ROW_HEIGHT = { session: 60, turn: 34 } as const;

export interface TimelineRow {
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
      const at = t.start ?? t.end;
      return (
        t.status === "unknown" &&
        at !== null &&
        at >= data.window.from &&
        at < data.window.to
      );
    })
    .sort(
      (a, b) =>
        (a.start ?? a.end ?? Infinity) - (b.start ?? b.end ?? Infinity),
    );
}

/** Stacks session lanes; an expanded session adds one row per turn, which reads as stairs because turns run in order. */
export function timelineRows(
  data: Analysis,
  expanded: ReadonlySet<string>,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let top = 0;
  for (const s of data.sessions) {
    const turns = stairTurns(data, s);
    rows.push({
      key: s.id,
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
  return rows;
}

/** value: [y, start, end, kind, abnormal, rowHeight, faded, targetY]; kind 4 is a stair connector. */
export interface PlacedItem {
  value: [number, number, number, number, number, number, number, number];
  sessionId: string;
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
    if (row.turnId) turnRows.set(`${row.sessionId}:${row.turnId}`, row);
    else sessionRows.set(row.sessionId, row);
  const placed: PlacedItem[] = [];
  const put = (
    item: TimelineItem,
    row: TimelineRow,
    faded: boolean,
  ) => {
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
  // Vertical connector where each next turn begins, dropping one step.
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1],
      next = rows[i];
    if (!prev.turnId || !next.turnId || prev.sessionId !== next.sessionId)
      continue;
    const turn = data.sessions
      .find((s) => s.id === next.sessionId)
      ?.turns.find((t) => t.id === next.turnId);
    const at = turn?.start ?? turn?.end ?? null;
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

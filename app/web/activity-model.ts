import type { Analysis, Session, Turn } from "../core/types";
import type { TimeWindow } from "./timeline-window";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const dayStart = (at: number) =>
  Math.floor((at + 8 * HOUR) / DAY) * DAY - 8 * HOUR;
export const hourStart = (at: number) => Math.floor(at / HOUR) * HOUR;
export const inside = (at: number | null | undefined, w: TimeWindow) =>
  at != null && at >= w.from && at < w.to;
export const overlaps = (start: number, end: number, w: TimeWindow) =>
  start < w.to && end > w.from;
export const clock = (at: number, seconds = false) =>
  new Date(at + 8 * HOUR).toISOString().slice(11, seconds ? 19 : 16);
export const dateKey = (at: number) =>
  new Date(at + 8 * HOUR).toISOString().slice(0, 10);

export function plotTicks(w: TimeWindow) {
  const target = (w.to - w.from) / 7;
  const step =
    [
      1000,
      5000,
      10000,
      30000,
      MINUTE,
      2 * MINUTE,
      5 * MINUTE,
      10 * MINUTE,
      15 * MINUTE,
      HOUR,
    ].find((n) => n >= target) ?? HOUR;
  const ticks: number[] = [];
  for (let at = Math.ceil(w.from / step) * step; at <= w.to; at += step)
    ticks.push(at);
  return ticks;
}

export function sessionsInWindow(data: Analysis, w: TimeWindow) {
  const active = new Set(
    data.intervals
      .filter((i) => i.kind === "ai_active" && overlaps(i.start, i.end, w))
      .map((i) => i.sessionId),
  );
  return data.sessions.filter(
    (s) =>
      active.has(s.id) ||
      s.inputs.some((i) => inside(i.at, w)) ||
      s.turns.some((t) => inside(t.observedAt ?? t.start ?? t.end, w)),
  );
}

export function turnsInWindow(data: Analysis, session: Session, w: TimeWindow) {
  const active = new Set(
    data.intervals
      .filter(
        (i) =>
          i.sessionId === session.id &&
          i.kind === "ai_active" &&
          overlaps(i.start, i.end, w),
      )
      .map((i) => i.turnId),
  );
  return session.turns
    .filter(
      (t) => active.has(t.id) || inside(t.observedAt ?? t.start ?? t.end, w),
    )
    .sort((a, b) => turnAt(a) - turnAt(b));
}
export const turnAt = (t: Turn) => t.observedAt ?? t.start ?? t.end ?? Infinity;

/** No interval is created from a recorded duration. */
export function activityOverview(data: Analysis) {
  let first = Infinity,
    last = -Infinity;
  const observe = (at: number) => {
    if (inside(at, data.window)) {
      first = Math.min(first, at);
      last = Math.max(last, at);
    }
  };
  for (const s of data.sessions) {
    s.inputs.forEach((i) => observe(i.at));
    s.turns.forEach((t) => {
      const at = t.observedAt ?? t.start ?? t.end;
      if (at != null) observe(at);
    });
  }
  for (const i of data.intervals)
    if (i.kind === "ai_active") {
      observe(i.start);
      observe(i.end - 1);
    }
  if (!Number.isFinite(first)) {
    first = data.window.from;
    last = first;
  }
  const multiDay = dayStart(first) !== dayStart(last);
  // Calendar-aligned columns, even when the query begins halfway through a day.
  // Padding the display must never bring out-of-query inputs back into the counts.
  const from = multiDay ? dayStart(first) : hourStart(first);
  const to = multiDay ? dayStart(last) + DAY : hourStart(last) + HOUR;
  // Bound rendering for all-time windows; long history groups multiple calendar days.
  const step = multiDay
    ? DAY * Math.max(1, Math.ceil((to - from) / DAY / 90))
    : 15 * MINUTE;
  const bins: { from: number; to: number }[] = [];
  for (let at = from; at < to; at += step)
    bins.push({ from: at, to: Math.min(at + step, to) });
  let maximum = 1;
  const rows = data.projects.map((project) => {
    const sessions = data.sessions.filter((s) => s.projectId === project.id);
    const ids = new Set(sessions.map((s) => s.id));
    const intervals = data.intervals.filter(
      (i) => ids.has(i.sessionId) && i.kind === "ai_active",
    );
    const counts = Array.from({ length: bins.length }, () => 0);
    for (const s of sessions)
      for (const input of s.inputs) {
        const index = Math.floor((input.at - from) / step);
        if (
          inside(input.at, data.window) &&
          inside(input.at, { from, to }) &&
          bins[index]
        )
          counts[index]++;
      }
    const cells = bins.map((bin, index) => {
      maximum = Math.max(maximum, counts[index]);
      return {
        ...bin,
        inputs: counts[index],
        knownExecution: intervals.some(
          (i) =>
            ids.has(i.sessionId) &&
            i.kind === "ai_active" &&
            overlaps(i.start, i.end, bin),
        ),
      };
    });
    return { project, sessions, cells };
  });
  return { from, to, multiDay, step, bins, rows, maximum };
}

export function defaultHour(data: Analysis) {
  // Prefer the most recent observed activity, even when its execution boundary is unknown.
  let last = data.window.from;
  for (const s of data.sessions)
    for (const input of s.inputs)
      if (inside(input.at, data.window)) last = Math.max(last, input.at);
  return hourStart(last);
}
export function hourWindow(data: Analysis, at: number): TimeWindow {
  const start = hourStart(
    Math.max(data.window.from, Math.min(at, data.window.to - 1)),
  );
  return {
    from: Math.max(start, data.window.from),
    to: Math.min(start + HOUR, data.window.to),
  };
}

export function minuteWindow(
  data: Analysis,
  s: Session,
  hour: TimeWindow,
): TimeWindow {
  const turns = turnsInWindow(data, s, hour);
  let first = Infinity,
    last = -Infinity;
  for (const t of turns) {
    const ii = data.intervals.filter(
      (i) =>
        i.sessionId === s.id &&
        i.turnId === t.id &&
        i.kind === "ai_active" &&
        overlaps(i.start, i.end, hour),
    );
    if (ii.length)
      for (const i of ii) {
        first = Math.min(first, Math.max(hour.from, i.start));
        last = Math.max(last, Math.min(hour.to, i.end));
      }
    else {
      const at = turnAt(t);
      first = Math.min(first, at);
      last = Math.max(last, at);
    }
  }
  return Number.isFinite(first)
    ? {
        from: Math.max(
          hour.from,
          Math.floor((first - 30_000) / MINUTE) * MINUTE,
        ),
        to: Math.min(hour.to, Math.ceil((last + 30_000) / MINUTE) * MINUTE),
      }
    : hour;
}

export function chartBox(start: number, end: number, w: TimeWindow) {
  if (end > start ? !overlaps(start, end, w) : !inside(start, w)) return null;
  return {
    left: (100 * (Math.max(start, w.from) - w.from)) / (w.to - w.from),
    width:
      (100 * (Math.min(end, w.to) - Math.max(start, w.from))) / (w.to - w.from),
    continued: end > w.to,
    preceded: start < w.from,
  };
}

/** Cluster close input events for the hour view; retain their original timestamps in the tooltip. */
export function inputClusters(session: Session, w: TimeWindow) {
  const groups = new Map<number, typeof session.inputs>();
  for (const input of session.inputs)
    if (inside(input.at, w)) {
      const key = Math.floor((input.at - w.from) / MINUTE);
      const group = groups.get(key) ?? [];
      group.push(input);
      groups.set(key, group);
    }
  return [...groups.values()].map((inputs) => ({ at: inputs[0].at, inputs }));
}

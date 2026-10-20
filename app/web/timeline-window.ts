import type { Analysis } from "../core/types";

export type TimeWindow = Analysis["window"];
export type ViewChoice =
  | { mode: "fit" | "full" | "morning" | "afternoon" }
  | { mode: "custom"; window: TimeWindow };
export interface TimelineItem {
  value: [number, number, number, number, number];
  sessionId: string;
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
        items.push({ value: [lane, at, at, 2, 0], sessionId: s.id });
    }
    for (const input of s.inputs)
      if (input.at >= data.window.from && input.at < data.window.to)
        items.push({
          value: [lane, input.at, input.at, 3, 0],
          sessionId: s.id,
        });
  });
  return items;
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

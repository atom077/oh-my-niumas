import type { Analysis, Project, Session, Turn } from "../core/types";

export type SortDirection = "desc" | "asc";
export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

/** Turns that touch the analysis window; the same rule drives the turn column and session detail. */
export const windowTurns = (data: Analysis, s: Session): Turn[] =>
  s.turns.filter(
    (t) =>
      (t.start ?? t.end ?? t.observedAt ?? Infinity) < data.window.to &&
      (t.end ?? t.start ?? t.observedAt ?? -Infinity) >= data.window.from,
  );

/**
 * AI execution shown in the project table. Projects with any closed turn use located intervals plus
 * unlocated Cursor records; projects with only open Codex turns fall back to Cursor records (or N/A).
 */
export function projectWorkMs(data: Analysis, p: Project): number | null {
  const located = data.sessions.some(
    (s) => s.projectId === p.id && s.turns.some((t) => t.status !== "unknown"),
  );
  return located
    ? p.workloadMs + (p.unlocatedReportedMs ?? 0)
    : p.reportedWorkloadMs;
}

/** Cursor sessions show recorded totals; Codex sessions without any closed turn stay N/A, never 0. */
export const sessionWorkMs = (s: Session): number | null =>
  s.provider === "cursor"
    ? s.reportedWorkloadMs ?? null
    : s.turns.some((t) => t.status !== "unknown")
    ? s.workloadMs
    : null;

/** Token totals only describe Codex, so groups made purely of Cursor sessions have no token value. */
export const projectTokens = (data: Analysis, p: Project): number | null =>
  data.sessions.some((s) => s.projectId === p.id && s.provider !== "cursor")
    ? p.tokens
    : null;

/**
 * Stable sort by a nullable numeric value. Missing values stay last in both directions so N/A is
 * never read as the smallest (or largest) workload.
 */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => number | null,
  direction: SortDirection,
): T[] {
  const sign = direction === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) =>
      a.v === null || b.v === null
        ? (a.v === null ? 1 : 0) - (b.v === null ? 1 : 0) || a.index - b.index
        : sign * (a.v - b.v) || a.index - b.index,
    )
    .map((x) => x.row);
}

/** Clicking the active column flips direction; a new column starts from the largest value. */
export const nextSort = <K extends string>(
  current: SortState<K>,
  key: K,
): SortState<K> =>
  current.key === key
    ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
    : { key, direction: "desc" };

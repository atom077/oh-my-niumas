import type { Analysis } from "../core/types";
import { activityOverview, dateKey, clock, DAY, HOUR } from "./activity-model";
import { windowTurns } from "./table-sort";

/** Chart totals share the overview KPI's located + unlocated-record accounting. */
export function workloadCharts(data: Analysis) {
  const reportedOnly = data.sessions.length > 0 && data.sessions.every((s) => s.provider === "cursor");
  const overview = activityOverview(data);
  const step = overview.multiDay ? overview.step : HOUR;
  const buckets: { from: number; to: number; label: string; ms: number }[] = [];
  for (let at = overview.from; at < overview.to; at += step)
    buckets.push({
      from: at,
      to: Math.min(at + step, overview.to),
      label: step >= DAY ? dateKey(at).slice(5) : clock(at),
      ms: 0,
    });

  for (const interval of data.intervals) {
    if (reportedOnly || interval.kind !== "ai_active") continue;
    for (const bucket of buckets)
      bucket.ms += Math.max(
        0,
        Math.min(interval.end, bucket.to, data.window.to) -
          Math.max(interval.start, bucket.from, data.window.from),
      );
  }
  // A record without an interval belongs wholly to its observed input, never a fabricated span.
  for (const session of data.sessions)
    for (const turn of session.turns) {
      if ((!reportedOnly && turn.timing === "inferred") || turn.reportedDurationMs === undefined)
        continue;
      const at = turn.observedAt;
      if (at == null || at < data.window.from || at >= data.window.to) continue;
      const bucket = buckets.find((b) => at >= b.from && at < b.to);
      if (bucket) bucket.ms += turn.reportedDurationMs;
    }

  const sources = (["codex", "cursor"] as const)
    .map((provider) => {
      const sessions = data.sessions.filter(
        (s) => (s.provider ?? "codex") === provider,
      );
      const known = sessions.some(
        (s) =>
          s.reportedWorkloadMs != null ||
          windowTurns(data, s).some(
            (t) => t.start !== null && t.end !== null && t.status !== "unknown",
          ),
      );
      return {
        provider,
        name: provider === "codex" ? "Codex" : "Cursor",
        ms: reportedOnly ? (known ? sessions.reduce((n, s) => n + (s.reportedWorkloadMs ?? 0), 0) : null) : known
          ? sessions.reduce(
              (n, s) => n + s.workloadMs + (s.unlocatedReportedMs ?? 0),
              0,
            )
          : null,
        sessions: sessions.length,
      };
    })
    .filter((s) => s.sessions > 0);
  const known = sources.some((s) => s.ms !== null);
  const total = sources.reduce((n, s) => n + (s.ms ?? 0), 0);
  return {
    buckets,
    sources,
    total,
    known,
    step,
    reportedOnly,
    inferred: !reportedOnly && data.metrics.inferredWorkloadMs > 0,
    unlocated: !reportedOnly && (data.metrics.unlocatedReportedMs ?? 0) > 0,
    partial: sources.some((s) => s.ms === null),
  };
}

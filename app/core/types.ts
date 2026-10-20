export type Status = "completed" | "aborted" | "failed" | "unknown";
export type Confidence = "observed" | "inferred" | "unknown";
export interface Source {
  alias: string;
  text: string;
  demo?: { project: string; session: string; exactInputs?: boolean };
}
export interface Evidence {
  source: string;
  line: number;
}
export interface Turn {
  id: string;
  start: number | null;
  end: number | null;
  status: Status;
  evidence: Evidence[];
  tokens: number | null;
  conflict?: boolean;
  /** Cursor's recorded duration has no verified absolute terminal boundary. */
  reportedDurationMs?: number;
  /** Activity timestamp without a verified execution boundary. */
  observedAt?: number | null;
}
export interface Usage {
  id: string;
  at: number;
  turnId: string | null;
  tokens: number;
  input: number;
  cached: number | null;
  output: number;
  reasoning: number | null;
  threadTotal: number | null;
  evidence: Evidence;
}
export interface Input {
  id: string;
  at: number;
  turnId: string | null;
  exact: boolean;
}
export interface Counter {
  at: number;
  total: number;
  evidence: Evidence;
}
export interface Session {
  id: string;
  name: string;
  provider?: "codex" | "cursor";
  activityTimes?: number[];
  titleSource?: "index" | "cursor" | "missing";
  projectId: string;
  projectName: string;
  originalProjectId?: string;
  originalProjectName?: string;
  note?: string;
  versions: string[];
  turns: Turn[];
  firstAt: number | null;
  lastAt: number | null;
  issues: string[];
  inputs: Input[];
  usage: Usage[];
  counters: Counter[];
  tokens: number | null;
  tokenMode: "record" | "counter" | "unknown";
  tokenComplete: boolean;
  recordSeen: boolean;
  conflictedUsageIds: string[];
  workloadMs: number;
  reportedWorkloadMs?: number | null;
  reportedTurns?: number;
  reportedTurnTotal?: number;
  spanMs: number | null;
  waitingMs: number | null;
  openWaiting: boolean;
}
export interface Dataset {
  sessions: Session[];
  issues: string[];
}
export interface Query {
  provider?: string;
  from?: number;
  to?: number;
  project?: string;
  search?: string;
  status?: string;
}
export interface Metrics {
  workloadMs: number;
  reportedWorkloadMs: number | null;
  reportedTurns: number;
  reportedTurnTotal: number;
  coverageMs: number;
  averageParallelism: number | null;
  peakParallelism: number;
  tokens: number | null;
  waitingMs: number | null;
  closedTurns: number;
  startedTurns: number;
  observedTurns: number;
  tokenSessions: number;
  inputCount: number;
}
export interface Interval {
  id: string;
  sessionId: string;
  turnId: string;
  start: number;
  end: number;
  status: Status;
  kind: "ai_active" | "awaiting_user";
}
export interface Project {
  id: string;
  name: string;
  sessionCount: number;
  workloadMs: number;
  reportedWorkloadMs: number | null;
  reportedTurns: number;
  reportedTurnTotal: number;
  tokens: number | null;
  waitingMs: number | null;
}
export interface Analysis {
  sessions: Session[];
  projects: Project[];
  intervals: Interval[];
  metrics: Metrics;
  window: { from: number; to: number };
  extent: { from: number; to: number };
  issues: string[];
  concurrency: { at: number; count: number }[];
  confidence: { timing: Confidence; tokens: Confidence; waiting: Confidence };
  provenance: {
    executionTurnIds: string[];
    tokenEventIds: string[];
    inputEventIds: string[];
  };
}

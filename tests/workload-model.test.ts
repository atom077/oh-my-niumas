import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSources } from "../app/core/analysis.ts";
import { demoSources } from "../app/core/demo.ts";
import { DAY, HOUR, dayStart } from "../app/web/activity-model.ts";
import { workloadCharts } from "../app/web/workload-model.ts";

test("工作量柱图分桶与来源环图守恒，不把并发时长去重", () => {
  const data = analyzeSources(demoSources("parallel"));
  const model = workloadCharts(data);
  assert.equal(model.buckets.reduce((n, b) => n + b.ms, 0), data.metrics.workloadMs);
  assert.equal(model.total, data.metrics.workloadMs);
  assert.equal(model.sources.length, 1);
  assert.equal(model.sources[0].provider, "codex");
  assert.ok(model.total > data.metrics.coverageMs);
});

test("跨午夜执行按上海小时裁切，不把整轮归在开始小时", () => {
  const data = analyzeSources(demoSources("parallel"));
  const midnight = dayStart(data.window.from) + DAY;
  data.window = { from: midnight - HOUR, to: midnight + HOUR };
  data.intervals = [{ ...data.intervals[0], start: midnight - 10 * 60_000, end: midnight + 20 * 60_000 }];
  data.sessions.forEach((s) => { s.inputs = []; s.turns = []; });
  const model = workloadCharts(data);
  assert.equal(model.step, DAY);
  assert.deepEqual(model.buckets.map((b) => b.ms), [600_000, 1_200_000]);
});

test("Cursor推算不重复叠加记录，未定位记录仅按输入时刻归属", () => {
  const data = analyzeSources(demoSources("parallel"));
  const base = data.sessions[0];
  const at = data.window.from + 1000;
  data.sessions = [{ ...base, provider: "cursor", workloadMs: 600_000,
    reportedWorkloadMs: 900_000, unlocatedReportedMs: 300_000,
    turns: [
      { ...base.turns[0], timing: "inferred", start: at, end: at + 600_000, observedAt: at, reportedDurationMs: 600_000 },
      { ...base.turns[0], id: "unlocated", start: null, end: null, status: "unknown", observedAt: at + 700_000, reportedDurationMs: 300_000 },
      { ...base.turns[0], id: "outside", start: null, end: null, status: "unknown", observedAt: data.window.to, reportedDurationMs: 700_000 },
    ],
  }];
  data.intervals = [{ ...data.intervals[0], start: at, end: at + 600_000, confidence: "inferred" }];
  const model = workloadCharts(data);
  assert.equal(model.total, 900_000);
  assert.equal(model.buckets.reduce((n, b) => n + b.ms, 0), 900_000);
  assert.equal(model.sources[0].provider, "cursor");
});

test("没有结束证据的未知时长不显示为零，已知零记录仍有效", () => {
  const data = analyzeSources(demoSources("parallel"));
  const base = data.sessions[0];
  data.intervals = [];
  data.sessions = [{ ...base, workloadMs: 0, turns: [{ ...base.turns[0], end: null, status: "unknown" }] }];
  assert.equal(workloadCharts(data).known, false);
  assert.equal(workloadCharts(data).sources[0].ms, null);
  data.sessions[0].provider = "cursor";
  data.sessions[0].reportedWorkloadMs = 0;
  assert.equal(workloadCharts(data).known, true);
  assert.equal(workloadCharts(data).total, 0);
});

test("长历史合并日历桶并限制柱数，仍保留所有区间时长", () => {
  const data = analyzeSources(demoSources("parallel"));
  const at = data.window.from;
  data.window.to = at + 181 * DAY;
  data.intervals.push({ ...data.intervals[0], id: "later", start: at + 180 * DAY, end: at + 180 * DAY + HOUR });
  const model = workloadCharts(data);
  assert.ok(model.buckets.length <= 90);
  assert.equal(model.buckets.reduce((n, b) => n + b.ms, 0), data.metrics.workloadMs + HOUR);
});

test("Cursor单来源与现有记录累计KPI一致，跨窗口推算区间不改变记录归属", () => {
  const data = analyzeSources(demoSources("parallel"));
  const base = data.sessions[0];
  const at = data.window.from;
  data.sessions = [{ ...base, provider: "cursor", workloadMs: 60_000,
    reportedWorkloadMs: 600_000, unlocatedReportedMs: 0,
    turns: [{ ...base.turns[0], timing: "inferred", start: at, end: at + 600_000, observedAt: at, reportedDurationMs: 600_000 }],
  }];
  data.intervals = [{ ...data.intervals[0], start: at, end: at + 60_000 }];
  const model = workloadCharts(data);
  assert.equal(model.reportedOnly, true);
  assert.equal(model.inferred, false);
  assert.equal(model.total, 600_000);
  assert.equal(model.buckets.reduce((n, b) => n + b.ms, 0), 600_000);
});

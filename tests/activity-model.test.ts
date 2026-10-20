import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSources } from "../app/core/analysis.ts";
import { demoSources } from "../app/core/demo.ts";
import {
  activityOverview,
  chartBox,
  dayStart,
  hourWindow,
  inputClusters,
  minuteWindow,
  plotTicks,
  sessionsInWindow,
  turnsInWindow,
  DAY,
  HOUR,
  MINUTE,
} from "../app/web/activity-model.ts";

test("活动格按输入计数，保留无输入的执行覆盖，不改变统计", () => {
  const data = analyzeSources(demoSources("parallel"));
  const before = JSON.stringify(data);
  const model = activityOverview(data);
  assert.equal(model.multiDay, false);
  assert.equal(model.step, 15 * MINUTE);
  assert.equal(
    model.rows.flatMap((r) => r.cells).reduce((n, c) => n + c.inputs, 0),
    data.metrics.inputCount,
  );
  assert.ok(model.rows.flatMap((r) => r.cells).some((c) => c.knownExecution));
  assert.equal(JSON.stringify(data), before);
});

test("Cursor记录值不补造区间，小时选择与事件聚类采用左闭右开", () => {
  const data = analyzeSources(demoSources("parallel"));
  const from = data.window.from,
    to = from + HOUR;
  const base = data.sessions[0];
  const cursor = {
    ...base,
    id: "cursor",
    provider: "cursor" as const,
    turns: [
      {
        ...base.turns[0],
        id: "c1",
        start: null,
        end: null,
        status: "unknown" as const,
        observedAt: from + 10_000,
        reportedDurationMs: 500_000,
      },
    ],
    inputs: [
      { ...base.inputs[0], id: "c1", at: from + 10_000, turnId: "c1" },
      { ...base.inputs[0], id: "c2", at: from + 20_000, turnId: "c1" },
      { ...base.inputs[0], id: "c3", at: to, turnId: "c1" },
    ],
  };
  data.sessions.push(cursor);
  const w = { from, to };
  assert.ok(sessionsInWindow(data, w).some((s) => s.id === "cursor"));
  assert.equal(inputClusters(cursor, w).length, 1);
  assert.equal(inputClusters(cursor, w)[0].inputs.length, 2);
  assert.equal(turnsInWindow(data, cursor, w).length, 1);
  assert.equal(chartBox(to, to, w), null);
  const fit = minuteWindow(data, cursor, w);
  assert.ok(fit.to - fit.from <= 2 * MINUTE, "未知执行时长不得用于定位视窗");
  assert.equal(
    data.intervals.filter((i) => i.sessionId === "cursor").length,
    0,
  );
});

test("跨日按上海日期聚合，长历史限制列数，边界区间裁切", () => {
  const data = analyzeSources(demoSources("parallel"));
  const first = data.sessions[0].inputs[0];
  data.window = {
    from: dayStart(first.at),
    to: dayStart(first.at) + 181 * DAY,
  };
  data.sessions[0].inputs.push({
    ...first,
    id: "later",
    at: first.at + 180 * DAY,
  });
  const model = activityOverview(data);
  assert.equal(model.multiDay, true);
  assert.ok(model.bins.length <= 90);
  const hour = hourWindow(data, first.at);
  assert.ok(hour.to - hour.from <= HOUR);
  assert.deepEqual(chartBox(hour.from - 10_000, hour.to + 10_000, hour), {
    left: 0,
    width: 100,
    continued: true,
    preceded: true,
  });
  assert.equal(chartBox(hour.to, hour.to + 1000, hour), null);
});

test("秒级短响应选择真实起止，放大后刻度保持秒级精度", () => {
  const data = analyzeSources(demoSources("parallel"));
  const s = data.sessions[0],
    at = data.window.from + MINUTE;
  s.turns = [
    { ...s.turns[0], start: at, end: at + 11_000, status: "completed" },
  ];
  data.intervals = [
    {
      ...data.intervals[0],
      sessionId: s.id,
      turnId: s.turns[0].id,
      start: at,
      end: at + 11_000,
      kind: "ai_active",
    },
  ];
  const hour = hourWindow(data, at),
    fit = minuteWindow(data, s, hour);
  assert.ok(fit.to - fit.from <= 2 * MINUTE);
  const box = chartBox(at, at + 11_000, fit)!;
  assert.ok(box.width > 5, "短响应在分钟视窗中必须可辨认");
  assert.ok(plotTicks({ from: at, to: at + 15_000 }).length >= 3);
});

test("部分日期窗口仍按日历分组，显示补齐不带回筛选外输入", () => {
  const data = analyzeSources(demoSources("parallel"));
  const first = data.sessions[0].inputs[0],
    day = dayStart(first.at);
  data.window = { from: day + 12 * HOUR, to: day + DAY + 4 * HOUR };
  data.intervals = [];
  data.sessions.forEach((s) => {
    s.inputs = [];
    s.turns = [];
  });
  data.sessions[0].inputs = [
    { ...first, id: "before", at: day + 11 * HOUR },
    { ...first, id: "first", at: day + 13 * HOUR },
    { ...first, id: "second", at: day + DAY + HOUR },
  ];
  const model = activityOverview(data);
  assert.equal(model.from, day);
  assert.equal(model.step, DAY);
  assert.equal(
    model.rows.flatMap((r) => r.cells).reduce((n, c) => n + c.inputs, 0),
    2,
  );
});

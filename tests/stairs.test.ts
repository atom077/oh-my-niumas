import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSources } from "../app/core/analysis.ts";
import { demoSources } from "../app/core/demo.ts";
import {
  ROW_HEIGHT,
  placeItems,
  stairTurns,
  timelineRows,
} from "../app/web/timeline-window.ts";

test("展开会话后按轮次逐级下移，并在每轮起点画衔接线", () => {
  const data = analyzeSources(demoSources("parallel"));
  const target = data.sessions.find((s) => stairTurns(data, s).length > 1);
  assert.ok(target, "演示数据应包含多轮会话");
  const turns = stairTurns(data, target);

  const closed = timelineRows(data, new Set());
  assert.equal(closed.length, data.sessions.length);
  assert.ok(closed.every((r) => r.height === ROW_HEIGHT.session));

  const rows = timelineRows(data, new Set([target.id]));
  const steps = rows.filter((r) => r.sessionId === target.id && r.turnId);
  assert.equal(rows.length, data.sessions.length + turns.length);
  assert.deepEqual(
    steps.map((r) => r.step),
    turns.map((_, i) => i),
  );
  // Steps sit directly under their session row and keep descending.
  const parent = rows.findIndex((r) => r.key === target.id);
  assert.deepEqual(
    rows.slice(parent + 1, parent + 1 + turns.length).map((r) => r.turnId),
    turns.map((t) => t.id),
  );
  for (let i = 1; i < steps.length; i++)
    assert.ok(steps[i].y > steps[i - 1].y);
  // Turn starts follow the same order, which makes the rows read as stairs.
  for (let i = 1; i < turns.length; i++)
    assert.ok((turns[i].start ?? 0) >= (turns[i - 1].start ?? 0));

  const items = placeItems(data, rows);
  const connectors = items.filter((i) => i.value[3] === 4);
  assert.equal(connectors.length, turns.length - 1);
  connectors.forEach((c, i) => {
    assert.equal(c.value[0], steps[i].y);
    assert.equal(c.value[7], steps[i + 1].y);
    assert.equal(c.value[1], turns[i + 1].start);
  });
  // The session row keeps a faded summary of the unfolded turns.
  const summary = items.filter(
    (i) => i.value[0] === rows[parent].y && i.value[3] === 0,
  );
  assert.ok(summary.length > 0 && summary.every((i) => i.value[6] === 1));
  const others = items.filter(
    (i) => i.sessionId !== target.id && i.value[3] !== 4,
  );
  assert.ok(others.every((i) => i.value[6] === 0));
});

test("单轮会话不生成阶梯行", () => {
  const data = analyzeSources(demoSources("parallel"));
  const single = data.sessions.filter((s) => stairTurns(data, s).length < 2);
  const rows = timelineRows(data, new Set(single.map((s) => s.id)));
  assert.equal(rows.length, data.sessions.length);
});

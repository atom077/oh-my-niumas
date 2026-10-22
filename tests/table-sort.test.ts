import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSources } from "../app/core/analysis.ts";
import { demoSources } from "../app/core/demo.ts";
import {
  nextSort,
  projectWorkMs,
  sessionWorkMs,
  sortRows,
} from "../app/web/table-sort.ts";

test("排序时 N/A 始终在最后，同值保持原顺序", () => {
  const rows = [
    { id: "a", v: 5 },
    { id: "b", v: null },
    { id: "c", v: 9 },
    { id: "d", v: 5 },
  ];
  const ids = (direction: "desc" | "asc") =>
    sortRows(rows, (r) => r.v, direction).map((r) => r.id);
  assert.deepEqual(ids("desc"), ["c", "a", "d", "b"]);
  assert.deepEqual(ids("asc"), ["a", "d", "c", "b"]);
});

test("点击同一列切换方向，切换到新列从大到小", () => {
  const start = { key: "work", direction: "desc" } as const;
  assert.deepEqual(nextSort(start, "work"), { key: "work", direction: "asc" });
  assert.deepEqual(nextSort(start, "span"), { key: "span", direction: "desc" });
});

test("项目与会话按显示的 AI 执行值排序", () => {
  const data = analyzeSources(demoSources("parallel"));
  const projects = sortRows(
    data.projects,
    (p) => projectWorkMs(data, p),
    "desc",
  ).map((p) => projectWorkMs(data, p) ?? -1);
  assert.deepEqual(projects, [...projects].sort((a, b) => b - a));
  const sessions = sortRows(data.sessions, sessionWorkMs, "desc").map(
    (s) => sessionWorkMs(s) ?? -1,
  );
  assert.deepEqual(sessions, [...sessions].sort((a, b) => b - a));
});

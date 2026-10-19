import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeSources } from "../app/core/analysis.ts";
import { demoSources } from "../app/core/demo.ts";

function log(session: string, cwd: string, start: number, end: number) {
  const at = (min: number) =>
    new Date(Date.UTC(2026, 9, 19, 1, min)).toISOString();
  return {
    alias: session,
    text: [
      {
        timestamp: at(start),
        type: "session_meta",
        payload: { id: session, cwd },
      },
      {
        timestamp: at(start),
        type: "event_msg",
        payload: { type: "task_started", turn_id: "t1" },
      },
      {
        timestamp: at(end),
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "t1" },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n"),
  };
}

test("三个会话显示 100 分钟工作量、50 分钟覆盖和 2.0 倍并行", () => {
  const result = analyzeSources([
    log("a", "/demo/a", 0, 40),
    log("b", "/demo/a", 10, 45),
    log("c", "/demo/b", 25, 50),
  ]);
  assert.equal(result.metrics.workloadMs, 6_000_000);
  assert.equal(result.metrics.coverageMs, 3_000_000);
  assert.equal(result.metrics.averageParallelism, 2);
  assert.equal(result.metrics.peakParallelism, 3);
  assert.equal(result.sessions.length, 3);
  assert.equal(result.projects.length, 2);
});

test("真实匿名三轮样例从 usage 记账，配套 token_count 不重复加入", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../fixtures/observed/s01-multiturn.json", import.meta.url),
      "utf8",
    ),
  );
  const rows: object[] = [
    {
      timestamp: "2000-01-01T00:00:00Z",
      type: "session_meta",
      payload: { id: "observed", cwd: "/anonymous" },
    },
  ];
  for (const e of fixture.events) {
    const timestamp = new Date(
      Date.UTC(2000, 0, 1) + e.offset_sec * 1000,
    ).toISOString();
    if (e.event === "token_usage_record")
      rows.push({
        timestamp,
        type: e.event,
        payload: {
          thread_id: "observed",
          turn_id: e.turn,
          response_id: `r${e.line}`,
          usage: e.usage,
          turn_token_usage: e.turn_usage,
          thread_token_usage: e.thread_usage,
        },
      });
    else if (e.event === "token_count")
      rows.push({
        timestamp,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: e.total, last_token_usage: e.last },
        },
      });
    else
      rows.push({
        timestamp,
        type: "event_msg",
        payload: {
          type:
            e.event === "item_completed.UserMessage"
              ? "item_completed"
              : e.event,
          turn_id: e.turn,
          item: { type: "UserMessage", id: `i${e.line}` },
        },
      });
  }
  const source = {
    alias: "observed",
    text: rows.map((r) => JSON.stringify(r)).join("\n"),
  };
  const result = analyzeSources([source]);
  assert.equal(result.metrics.tokens, 391822);
  assert.deepEqual(
    result.sessions[0].turns.map((t) => t.tokens),
    [105259, 229963, 56600],
  );
  assert.equal(result.sessions[0].waitingMs, null);
  assert.ok(
    result.sessions[0].issues.includes("输入记录晚于执行开始，精确等待未知"),
  );
});

test("窗口裁切采用半开区间，相接执行不产生虚假并发", () => {
  const sources = [
    log("a", "/demo/a", 0, 40),
    log("b", "/demo/a", 10, 45),
    log("c", "/demo/b", 25, 50),
  ];
  const result = analyzeSources(sources, {
    from: Date.UTC(2026, 9, 19, 1, 20),
    to: Date.UTC(2026, 9, 19, 1, 30),
  });
  assert.equal(result.metrics.workloadMs, 1_500_000);
  assert.equal(result.metrics.coverageMs, 600_000);
  assert.equal(result.metrics.averageParallelism, 2.5);
  const adjacent = analyzeSources([
    log("a", "/demo/a", 0, 10),
    log("b", "/demo/b", 10, 20),
  ]);
  assert.equal(adjacent.metrics.peakParallelism, 1);
});

test("重复来源与重复开始不增加工作量，异常终点不产生负时长", () => {
  const source = log("a", "/demo/a", 0, 40);
  assert.equal(
    analyzeSources([source, { ...source, alias: "copied-file" }]).metrics
      .workloadMs,
    2_400_000,
  );
  const bad = log("b", "/demo/b", 20, 10);
  const result = analyzeSources([bad]);
  assert.equal(result.metrics.workloadMs, 0);
  assert.ok(result.sessions[0].issues.includes("结束早于开始"));
});

test("同一会话的冲突开始和重叠轮次不伪装成精确执行", () => {
  const a = log("a", "/demo", 0, 40),
    b = log("a", "/demo", 10, 40);
  const result = analyzeSources([a, b]);
  assert.equal(result.metrics.workloadMs, 0);
  assert.ok(result.issues.some((i) => i.includes("冲突")));
});

test("合成输入给出七分钟闭合等待，最后开放等待不累计", () => {
  const result = analyzeSources(demoSources());
  assert.equal(result.metrics.waitingMs, 420000);
  assert.equal(result.sessions[0].spanMs, 2820000);
  assert.equal(result.sessions[0].workloadMs, 2400000);
  assert.equal(result.sessions[0].openWaiting, true);
  assert.equal(result.metrics.tokens, 100800);
});

test("旧累计重报与重置只恢复可证明的增量，未知字段和坏行不泄漏内容", () => {
  const source = log("a", "/private/secret-project", 0, 40);
  const events = [100, 150, 150, 20, 40].map((total, i) =>
    JSON.stringify({
      timestamp: new Date(Date.UTC(2026, 9, 19, 1, i + 1)).toISOString(),
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: total },
          last_token_usage: { total_tokens: 999999 },
        },
        message: "SECRET_PROMPT",
      },
    }),
  );
  const result = analyzeSources([
    { ...source, text: source.text + "\n" + events.join("\n") + "\n{broken" },
  ]);
  assert.equal(result.metrics.tokens, 70);
  assert.equal(result.sessions[0].tokenComplete, false);
  assert.ok(result.issues.some((i) => i.includes("重置")));
  assert.ok(!JSON.stringify(result).includes("SECRET_PROMPT"));
  assert.ok(!JSON.stringify(result).includes("secret-project"));
});

test("压缩后优先 usage 作用域，计数分歧明确提示", () => {
  const source = log("a", "/demo", 0, 40);
  const at = "2026-10-19T01:20:00Z";
  const record = {
    timestamp: at,
    type: "token_usage_record",
    payload: {
      thread_id: "a",
      turn_id: "t1",
      response_id: "r1",
      usage: {
        input_tokens: 323850,
        output_tokens: 3630,
        total_tokens: 327480,
      },
      thread_token_usage: { total_tokens: 327480 },
    },
  };
  const counter = {
    timestamp: at,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: 0 },
        last_token_usage: { total_tokens: 35160 },
      },
    },
  };
  const result = analyzeSources([
    {
      ...source,
      text:
        source.text +
        "\n" +
        JSON.stringify(record) +
        "\n" +
        JSON.stringify(counter) +
        "\n" +
        JSON.stringify(record),
    },
  ]);
  assert.equal(result.metrics.tokens, 327480);
  assert.ok(result.issues.some((i) => i.includes("分歧")));
});

test("跨日执行按上海日期裁切，历史未闭合与 fork 不计精确工作量", () => {
  const source = log("a", "/demo", 0, 40);
  const rows = source.text.split("\n").map((l) => JSON.parse(l));
  rows[1].timestamp = "2026-10-18T23:50:00+08:00";
  rows[2].timestamp = "2026-10-19T00:20:00+08:00";
  const result = analyzeSources(
    [{ ...source, text: rows.map((r) => JSON.stringify(r)).join("\n") }],
    {
      from: Date.parse("2026-10-19T00:00:00+08:00"),
      to: Date.parse("2026-10-20T00:00:00+08:00"),
    },
  );
  assert.equal(result.metrics.workloadMs, 1200000);
  const unclosed = analyzeSources([
    { ...source, text: source.text.split("\n").slice(0, 2).join("\n") },
  ]);
  assert.equal(unclosed.sessions[0].turns[0].status, "unknown");
  assert.equal(unclosed.metrics.coverageMs, 0);
  rows[0].payload.forked_from_id = "parent";
  const fork = analyzeSources([
    { ...source, text: rows.map((r) => JSON.stringify(r)).join("\n") },
  ]);
  assert.equal(fork.sessions.length, 0);
  assert.ok(fork.issues.some((i) => i.includes("fork")));
});

test("存在线程作用域冲突时不回退到无法归属的累计计数", () => {
  const source = log("child", "/demo", 0, 40);
  const rows = [
    {
      timestamp: "2026-10-19T01:01:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { total_tokens: 100 } },
      },
    },
    {
      timestamp: "2026-10-19T01:02:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { total_tokens: 200 } },
      },
    },
    {
      timestamp: "2026-10-19T01:02:00Z",
      type: "token_usage_record",
      payload: {
        thread_id: "parent",
        turn_id: "t1",
        response_id: "r1",
        usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 },
      },
    },
  ];
  const result = analyzeSources([
    {
      ...source,
      text: source.text + "\n" + rows.map((r) => JSON.stringify(r)).join("\n"),
    },
  ]);
  assert.equal(result.metrics.tokens, null);
});

test("跨日闲置会话不能把没有活动的窗口当作完整会话跨度", () => {
  const first = log("a", "/demo", 0, 10),
    later = log("a", "/demo", 100, 110);
  const result = analyzeSources(
    [first, { ...later, text: later.text.replaceAll("t1", "t2") }],
    { from: Date.UTC(2026, 9, 19, 1, 20), to: Date.UTC(2026, 9, 19, 1, 30) },
  );
  assert.equal(result.sessions.length, 0);
});

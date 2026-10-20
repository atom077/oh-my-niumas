import type { Source } from "./types.ts";

export function demoSources(scenario = "parallel"): Source[] {
  if (scenario === "boundaries") return boundarySources();
  const epoch = Date.UTC(2026, 9, 19, 1);
  const definitions = [
    {
      id: "demo-a",
      cwd: "/synthetic/web",
      project: "前端应用",
      session: "会话 A · 登录体验打磨",
      turns: [
        [0, 18],
        [25, 47],
      ],
    },
    {
      id: "demo-b",
      cwd: "/synthetic/web",
      project: "前端应用",
      session: "会话 B · 组件测试补齐",
      turns: [[10, 45]],
    },
    {
      id: "demo-c",
      cwd: "/synthetic/data",
      project: "数据服务",
      session: "会话 C · 清洗脚本优化",
      turns: [[25, 50]],
    },
  ];
  return definitions.map((d) => {
    const rows: object[] = [
      {
        timestamp: new Date(epoch).toISOString(),
        type: "session_meta",
        payload: { id: d.id, cwd: d.cwd },
      },
    ];
    let total = 0;
    for (const [i, [start, end]] of d.turns.entries()) {
      const at = (m: number) => new Date(epoch + m * 60_000).toISOString();
      const turn = `${d.id}-t${i}`;
      rows.push({
        timestamp: at(start),
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: turn,
          item: { type: "UserMessage", id: `input-${turn}` },
        },
      });
      rows.push({
        timestamp: at(start),
        type: "event_msg",
        payload: { type: "task_started", turn_id: turn },
      });
      const usage = {
        input_tokens: 24000,
        cached_input_tokens: 12000,
        output_tokens: 1200,
        reasoning_output_tokens: 300,
        total_tokens: 25200,
      };
      total += usage.total_tokens;
      rows.push({
        timestamp: at(end - 0.01),
        type: "token_usage_record",
        payload: {
          thread_id: d.id,
          turn_id: turn,
          response_id: `response-${turn}`,
          usage,
          turn_token_usage: usage,
          thread_token_usage: {
            ...usage,
            input_tokens: 24000 * (i + 1),
            cached_input_tokens: 12000 * (i + 1),
            output_tokens: 1200 * (i + 1),
            reasoning_output_tokens: 300 * (i + 1),
            total_tokens: total,
          },
        },
      });
      rows.push({
        timestamp: at(end),
        type: "event_msg",
        payload: { type: "task_complete", turn_id: turn },
      });
    }
    return {
      alias: d.id,
      text: rows.map((r) => JSON.stringify(r)).join("\n"),
      demo: { project: d.project, session: d.session, exactInputs: true },
    };
  });
}

function boundarySources(): Source[] {
  const definitions = [
    {
      id: "cross",
      name: "会话 D · 跨午夜执行",
      start: "2026-10-18T23:50:00+08:00",
      end: "2026-10-19T00:20:00+08:00",
      kind: "task_complete",
    },
    {
      id: "abort",
      name: "会话 E · 已中止",
      start: "2026-10-19T00:03:00+08:00",
      end: "2026-10-19T00:08:00+08:00",
      kind: "turn_aborted",
    },
    {
      id: "unknown",
      name: "会话 F · 缺失结束",
      start: "2026-10-19T00:05:00+08:00",
      end: null,
      kind: null,
    },
    {
      id: "failed",
      name: "会话 G · 明确失败（合成）",
      start: "2026-10-19T00:06:00+08:00",
      end: "2026-10-19T00:09:00+08:00",
      kind: "task_failed",
    },
  ];
  const base = definitions.map((d) => ({
    alias: d.id,
    demo: { project: "边界试验场", session: d.name, exactInputs: true },
    text: [
      {
        timestamp: d.start,
        type: "session_meta",
        payload: { id: d.id, cwd: "/synthetic/boundaries" },
      },
      {
        timestamp: d.start,
        type: "event_msg",
        payload: { type: "task_started", turn_id: "t1" },
      },
      ...(d.end
        ? [
            {
              timestamp: d.end,
              type: "event_msg",
              payload: { type: d.kind, turn_id: "t1" },
            },
          ]
        : []),
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  }));
  const counter = (id: string, name: string, events: object[]): Source => ({
    alias: id,
    demo: { project: "计数试验场", session: name, exactInputs: true },
    text: [
      {
        timestamp: "2026-10-19T00:01:00+08:00",
        type: "session_meta",
        payload: { id, cwd: "/synthetic/counters" },
      },
      {
        timestamp: "2026-10-19T00:01:00+08:00",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "t1" },
      },
      ...events,
      {
        timestamp: "2026-10-19T00:12:00+08:00",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "t1" },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  });
  return [
    ...base,
    counter(
      "reset",
      "会话 H · Token 重报与重置",
      [0, 100, 150, 150, 20, 40].map((total, i) => ({
        timestamp: new Date(
          Date.parse("2026-10-19T00:02:00+08:00") + i * 60_000,
        ).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: { total_tokens: total } },
        },
      })),
    ),
    counter("compact", "会话 I · 压缩计数分歧", [
      {
        timestamp: "2026-10-19T00:05:00+08:00",
        type: "token_usage_record",
        payload: {
          thread_id: "compact",
          turn_id: "t1",
          response_id: "r1",
          usage: {
            input_tokens: 323850,
            output_tokens: 3630,
            total_tokens: 327480,
          },
          thread_token_usage: { total_tokens: 327480 },
        },
      },
      {
        timestamp: "2026-10-19T00:06:00+08:00",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { total_tokens: 0 },
            last_token_usage: { total_tokens: 35160 },
          },
        },
      },
    ]),
  ];
}

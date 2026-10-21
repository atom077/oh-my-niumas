import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, cp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app/server.ts";
import {
  INFERENCE_TOLERANCE_MS,
  normalizeCursor,
  scanCursor,
} from "../app/cursor-importer.ts";
import { cursorFixture } from "./helpers/cursor-fixture.ts";

test("Cursor 推算区间：容差边界、越过下一次输入与缺少记录时长", () => {
  const t0 = Date.parse("2026-10-19T01:00:00Z");
  const bubble = (
    id: string,
    type: 1 | 2,
    at: number,
    reportedDurationMs: number | null = null,
  ) => ({
    id,
    type,
    at,
    start: null,
    completed: null,
    reportedDurationMs,
    simulated: false,
  });
  const [s] = normalizeCursor([
    {
      id: "edge",
      projectId: "p",
      projectName: "p",
      projectEvidence: "folder",
      bubbles: [
        // Exactly at tolerance: accepted.
        bubble("u1", 1, t0),
        bubble("a1", 2, t0 + 60_000 - INFERENCE_TOLERANCE_MS, 60_000),
        // Agrees with its message but runs past the next input: rejected.
        bubble("u2", 1, t0 + 100_000),
        bubble("a2", 2, t0 + 150_000, 50_000),
        // No recorded duration: rejected.
        bubble("u3", 1, t0 + 140_000),
        bubble("a3", 2, t0 + 150_000),
      ],
    },
  ]).sessions;
  assert.deepEqual(
    s.turns.map((t) => [t.start, t.end, t.timing ?? null]),
    [
      [t0, t0 + 60_000, "inferred"],
      [null, null, null],
      [null, null, null],
    ],
  );
  assert.ok(s.issues.some((i) => i.includes("2 轮缺少记录时长")));
});

test("Cursor v18：消息头分页存储于 composerConvHeaders，含子消息 ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "niumas-cursor-v18-"));
  try {
    await mkdir(join(root, "globalStorage"));
    const db = new DatabaseSync(join(root, "globalStorage", "state.vscdb"));
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
    const put = (k: string, v: unknown) =>
      db
        .prepare("INSERT INTO cursorDiskKV VALUES (?,?)")
        .run(k, JSON.stringify(v));
    const id = "v18-session",
      t0 = Date.parse("2026-10-21T02:00:00Z");
    put(`composerData:${id}`, {
      _v: 18,
      composerId: id,
      lastUpdatedAt: t0 + 60_000,
      workspaceIdentifier: {
        id: "multi",
        configPath: { scheme: "file", path: "/synthetic/demo.code-workspace" },
      },
      fullConversationHeadersOnly: [],
      conversationMap: {},
    });
    // Turn split across two pages; the terminal sub-bubble carries the turn duration.
    const turn = [
      ["u1", 1, 0, null],
      ["u1/s:0", 2, 5_000, null],
      ["u1/t:call-1\nfc_1_0", 2, 9_000, null],
      ["u1/s:1", 2, 28_000, 30_000],
    ] as const;
    put(
      `composerConvHeaders:${id}:000000`,
      turn.slice(0, 2).map(([bubbleId, type]) => ({ bubbleId, type })),
    );
    put(
      `composerConvHeaders:${id}:000001`,
      turn.slice(2).map(([bubbleId, type]) => ({ bubbleId, type })),
    );
    for (const [bid, type, offset, turnDurationMs] of turn)
      put(`bubbleId:${id}:${bid}`, {
        type,
        createdAt: new Date(t0 + offset).toISOString(),
        ...(turnDurationMs ? { turnDurationMs } : {}),
      });
    db.close();
    const { projections, status } = await scanCursor(root);
    assert.equal(projections?.length, 1);
    assert.equal(status.messages, 4, "两页消息头全部读取");
    assert.equal(projections![0].projectName, "demo（多目录）");
    assert.equal(projections![0].projectEvidence, "workspace");
    const [s] = normalizeCursor(projections!).sessions;
    assert.equal(s.turns.length, 1);
    assert.deepEqual(
      [s.turns[0].start, s.turns[0].end, s.turns[0].timing],
      [t0, t0 + 30_000, "inferred"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cursor HTTP 接入：来源隔离、推算区间、只读隐私、刷新与重启", async () => {
  const root = await mkdtemp(join(tmpdir(), "niumas-cursor-"));
  await cp("fixtures/import-smoke", root, { recursive: true });
  const cursorRoot = join(root, "cursor"),
    cache = join(root, "cache.sqlite");
  const cursorPath = await cursorFixture(cursorRoot);
  const original = await readFile(cursorPath);
  const start = async () => {
    const server = await createApp({
      logRoot: root,
      cursorRoot,
      dbPath: cache,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    return {
      refresh: () =>
        fetch(base + "/api/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).then((r) => r.json()),
      analysis: (provider = "") =>
        fetch(base + "/api/analysis?source=local&provider=" + provider).then(
          (r) => r.json(),
        ),
      get: (url: string) => fetch(base + url),
      close: () =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    };
  };
  let app = await start();
  try {
    const scan = await app.refresh();
    assert.deepEqual(scan.providers, { codex: 1, cursor: 1 });
    assert.equal(scan.cursor.excluded, 1);
    const all = await app.analysis(),
      cursor = await app.analysis("cursor"),
      codex = await app.analysis("codex");
    assert.equal(all.sessions.length, 2);
    assert.equal(all.projects.length, 1, "同目录跨来源共用项目");
    assert.equal(all.metrics.workloadMs, codex.metrics.workloadMs + 40_000);
    assert.equal(all.metrics.inferredWorkloadMs, 40_000);
    assert.equal(
      all.metrics.unlocatedReportedMs,
      40_000,
      "混合总量只补未定位记录，推算轮次不重复累加",
    );
    assert.equal(all.metrics.reportedWorkloadMs, 80_000);
    assert.equal(cursor.metrics.reportedWorkloadMs, 80_000);
    assert.equal(cursor.metrics.reportedTurns, 2);
    assert.equal(cursor.metrics.reportedTurnTotal, 2);
    assert.equal(codex.metrics.reportedWorkloadMs, null);
    assert.equal(all.projects[0].reportedWorkloadMs, 80_000);
    assert.equal(cursor.projects[0].reportedWorkloadMs, 80_000);
    assert.equal(cursor.projects[0].reportedTurns, 2);
    assert.equal(cursor.sessions.length, 1);
    assert.equal(cursor.sessions[0].provider, "cursor");
    assert.equal(cursor.sessions[0].name, "Cursor 合成写作");
    assert.equal(cursor.sessions[0].turns.length, 2);
    const base = Date.parse("2026-10-19T01:00:00Z");
    const [inferred, unlocated] = cursor.sessions[0].turns;
    assert.equal(inferred.reportedDurationMs, 40_000);
    assert.equal(inferred.start, base, "推算起点为输入时间");
    assert.equal(inferred.end, base + 40_000, "推算终点为输入 + 记录时长");
    assert.equal(inferred.timing, "inferred");
    assert.equal(inferred.status, "completed");
    assert.equal(unlocated.start, null, "与结尾消息相差 30 秒，超出容差");
    assert.equal(unlocated.end, null);
    assert.equal(unlocated.timing, undefined);
    assert.equal(unlocated.status, "unknown");
    assert.equal(cursor.metrics.tokens, null);
    assert.equal(cursor.metrics.workloadMs, 40_000);
    assert.equal(cursor.metrics.coverageMs, 40_000);
    assert.equal(cursor.metrics.waitingMs, 80_000, "推算终点至下一次输入");
    assert.equal(cursor.metrics.inputCount, 2);
    assert.deepEqual(
      cursor.intervals.map((i: { kind: string; confidence: string }) => [
        i.kind,
        i.confidence,
      ]),
      [
        ["ai_active", "inferred"],
        ["awaiting_user", "inferred"],
      ],
    );
    assert.equal(cursor.confidence.timing, "inferred");
    assert.equal(cursor.confidence.waiting, "inferred");
    assert.equal(cursor.sessions[0].spanMs, 190_000);
    assert.ok(
      cursor.sessions[0].issues.some((i: string) =>
        i.includes("1 轮缺少记录时长或与消息跨度不一致"),
      ),
    );
    assert.equal(cursor.sessions[0].reportedWorkloadMs, 80_000);
    assert.equal(cursor.sessions[0].reportedTurns, 2);
    assert.equal(cursor.sessions[0].reportedTurnTotal, 2);
    const sliced = await app
      .get(
        "/api/analysis?source=local&provider=cursor&from=" +
          Date.parse("2026-10-19T01:03:00Z") +
          "&to=" +
          Date.parse("2026-10-19T01:04:00Z"),
      )
      .then((r) => r.json());
    assert.equal(sliced.sessions.length, 1, "仅助手活动的窗口也可查询");
    assert.equal(sliced.metrics.reportedWorkloadMs, null);
    assert.equal(sliced.metrics.reportedTurns, 0);
    assert.equal(
      sliced.sessions[0].reportedWorkloadMs,
      null,
      "记录时长整笔按输入时间归属，不填入仅助手活动的窗口",
    );
    assert.equal((await app.get("/api/analysis?provider=invalid")).status, 400);
    assert.deepEqual(await readFile(cursorPath), original, "源库未修改");
    const second = await app.refresh();
    assert.equal(second.newTurns, 0);
    assert.equal(second.newSessions, 0);
    assert.equal(
      (await app.analysis("cursor")).sessions[0].reportedWorkloadMs,
      80_000,
      "重复扫描不重复累加记录时长",
    );
    const raw = await readFile(cache);
    for (const secret of [
      "SECRET_HEADER_PREVIEW",
      "SECRET_PROMPT",
      "SECRET_MAP",
      "SECRET_OUTPUT",
      "SECRET_INPUT",
      "SECRET_TOOL",
      "/synthetic/http-demo",
      "Cursor 合成写作",
    ]) {
      assert.ok(!raw.includes(Buffer.from(secret)), `缓存不得含 ${secret}`);
      if (secret !== "Cursor 合成写作")
        assert.ok(!JSON.stringify(all).includes(secret));
    }
    await app.close();
    app = await start();
    const restart = await app.refresh();
    assert.equal(restart.newSessions, 0);
    assert.equal(restart.newTurns, 0);
    const db = new DatabaseSync(cursorPath);
    db.exec("PRAGMA journal_mode=WAL");
    db.prepare("UPDATE composerHeaders SET value=? WHERE composerId=?").run(
      JSON.stringify({ name: "合成标题已更新" }),
      "synthetic-http-session",
    );
    try {
      await app.refresh();
      assert.equal(
        (await app.analysis("cursor")).sessions[0].name,
        "合成标题已更新",
        "只读查询包含已提交 WAL",
      );
    } finally {
      db.close();
    }
    await rm(cursorPath);
    await symlink("/etc/passwd", cursorPath);
    const linked = await app.refresh();
    assert.equal(linked.providers.cursor, 1, "不可读时保留缓存");
    assert.ok(linked.issues.some((i: string) => i.includes("上次缓存")));
    await rm(cursorPath);
    await app.refresh();
    assert.equal(
      (await app.analysis("cursor")).sessions.length,
      0,
      "源数据库删除后清除失效会话",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

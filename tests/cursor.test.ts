import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, cp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app/server.ts";
import { cursorFixture } from "./helpers/cursor-fixture.ts";

test("Cursor HTTP 接入：来源隔离、未知边界、只读隐私、刷新与重启", async () => {
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
    assert.equal(all.metrics.workloadMs, codex.metrics.workloadMs);
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
    assert.equal(cursor.sessions[0].turns[0].reportedDurationMs, 40_000);
    assert.equal(cursor.sessions[0].turns[0].start, null);
    assert.equal(cursor.sessions[0].turns[0].end, null);
    assert.equal(cursor.metrics.tokens, null);
    assert.equal(cursor.metrics.waitingMs, null);
    assert.equal(cursor.metrics.coverageMs, 0);
    assert.equal(cursor.metrics.inputCount, 2);
    assert.equal(cursor.intervals.length, 0);
    assert.equal(cursor.confidence.timing, "unknown");
    assert.equal(cursor.sessions[0].spanMs, 180_000);
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

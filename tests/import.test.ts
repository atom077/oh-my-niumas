import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  appendFile,
  copyFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app/server.ts";

test("HTTP 导入和重复刷新幂等，不改源文件也不返回敏感内容", async () => {
  const dir = await mkdtemp(join(tmpdir(), "niumas-import-"));
  await mkdir(join(dir, "sessions"), { recursive: true });
  const input = join(dir, "sessions", "one.jsonl");
  const rows = [
    {
      timestamp: "2026-10-19T01:00:00Z",
      type: "session_meta",
      payload: {
        id: "test-session",
        cwd: "/Users/PRIVATE_PROJECT/sample-app",
        instructions: "SECRET_PROMPT",
      },
    },
    {
      timestamp: "2026-10-19T01:00:00Z",
      type: "event_msg",
      payload: { type: "task_started", turn_id: "t1" },
    },
    {
      timestamp: "2026-10-19T01:09:00Z",
      type: "token_usage_record",
      payload: {
        thread_id: "test-session",
        turn_id: "t1",
        response_id: "r1",
        usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 },
        thread_token_usage: { total_tokens: 100 },
      },
    },
    {
      timestamp: "2026-10-19T01:10:00Z",
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: "t1",
        last_agent_message: "SECRET_OUTPUT",
      },
    },
  ];
  const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(input, text);
  const server = await createApp({
    logRoot: dir,
    dbPath: join(dir, "cache.sqlite"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const refresh = () =>
      fetch(base + "/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    const response = await refresh();
    assert.equal(response.status, 200);
    const scan = await response.json();
    assert.equal(scan.addedFiles, 1);
    assert.equal(scan.changedFiles, 0);
    assert.equal(scan.removedFiles, 0);
    assert.equal(scan.newTurns, 1);
    assert.ok(scan.durationMs >= 0);
    const first = await fetch(base + "/api/analysis?source=local").then((r) =>
      r.json(),
    );
    assert.equal(first.source, "local");
    assert.equal(first.metrics.workloadMs, 600000);
    assert.equal(first.metrics.tokens, 100);
    await refresh();
    const second = await fetch(base + "/api/analysis?source=local").then((r) =>
      r.json(),
    );
    assert.deepEqual(second.metrics, first.metrics);
    assert.equal(second.importStatus.cachedFiles, 1);
    assert.equal(second.importStatus.addedFiles, 0);
    assert.equal(second.importStatus.newTurns, 0);
    assert.equal(await readFile(input, "utf8"), text);
    for (const secret of [
      "PRIVATE_PROJECT",
      "SECRET_PROMPT",
      "SECRET_OUTPUT",
    ]) {
      assert.ok(!JSON.stringify(second).includes(secret));
      assert.ok(
        !(await readFile(join(dir, "cache.sqlite"))).includes(
          Buffer.from(secret),
        ),
      );
    }
    const forbidden = await fetch(base + "/api/refresh", {
      method: "POST",
      headers: {
        Origin: "https://example.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(forbidden.status, 403);
    const extra =
      [
        {
          timestamp: "2026-10-19T01:20:00Z",
          type: "event_msg",
          payload: { type: "task_started", turn_id: "t2" },
        },
        {
          timestamp: "2026-10-19T01:30:00Z",
          type: "event_msg",
          payload: { type: "task_complete", turn_id: "t2" },
        },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n";
    await appendFile(input, extra);
    await refresh();
    const appended = await fetch(base + "/api/analysis?source=local").then(
      (r) => r.json(),
    );
    assert.equal(appended.metrics.workloadMs, 1200000);
    assert.equal(appended.importStatus.changedFiles, 1);
    assert.equal(appended.importStatus.newTurns, 1);
    await mkdir(join(dir, "archived_sessions"));
    await copyFile(input, join(dir, "archived_sessions", "copy.jsonl"));
    await refresh();
    const archived = await fetch(base + "/api/analysis?source=local").then(
      (r) => r.json(),
    );
    assert.equal(archived.metrics.workloadMs, 1200000);
    assert.equal(archived.metrics.tokens, 100);
    await writeFile(input, JSON.stringify(rows[0]) + "\n");
    await rm(join(dir, "archived_sessions", "copy.jsonl"));
    await symlink("/etc/passwd", join(dir, "sessions", "link.jsonl"));
    await refresh();
    const truncated = await fetch(base + "/api/analysis?source=local").then(
      (r) => r.json(),
    );
    assert.equal(truncated.metrics.workloadMs, 0);
    assert.equal(truncated.importStatus.removedFiles, 1);
    assert.equal(truncated.sessions.length, 0);
    assert.ok(
      truncated.importStatus.issues.some((s: string) => s.includes("符号链接")),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app/server.ts";

test("HTTP 本地标记可合并、恢复、搜索并在刷新重启后保留原始归属", async () => {
  const dir = await mkdtemp(join(tmpdir(), "niumas-labels-"));
  await mkdir(join(dir, "sessions"));
  const text = await readFile(
    "fixtures/import-smoke/sessions/synthetic.jsonl",
    "utf8",
  );
  await writeFile(join(dir, "sessions", "a.jsonl"), text);
  await writeFile(
    join(dir, "sessions", "b.jsonl"),
    text
      .replaceAll("synthetic-http-session", "second-session")
      .replaceAll("/synthetic/http-demo", "/synthetic/second"),
  );
  let server: Awaited<ReturnType<typeof createApp>>;
  let base = "";
  const start = async () => {
    server = await createApp({
      logRoot: dir,
      dbPath: join(dir, "cache.sqlite"),
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  };
  const stop = () => new Promise<void>((r) => server.close(() => r()));
  const post = (path: string, body: unknown, origin?: string) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  const analysis = (query = "") =>
    fetch(base + "/api/analysis?source=local" + query).then((r) => r.json());
  await start();
  try {
    await post("/api/refresh", {});
    const first = await analysis();
    const [a, b] = first.projects;
    const session = first.sessions.find((s: any) => s.projectId === a.id);
    assert.equal(
      (
        await post("/api/annotations", {
          action: "renameProject",
          projectId: a.id,
          name: "我的前端",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/api/annotations", {
          action: "sessionNote",
          sessionId: session.id,
          note: "复查登录表单",
        })
      ).status,
      200,
    );
    assert.equal(
      (await analysis("&search=" + encodeURIComponent("登录表单"))).sessions
        .length,
      1,
    );
    assert.equal(
      (
        await post("/api/annotations", {
          action: "mergeProjects",
          from: b.id,
          to: a.id,
        })
      ).status,
      200,
    );
    const merged = await analysis("&project=" + a.id);
    assert.equal(merged.projects.length, 1);
    assert.equal(merged.projects[0].name, "我的前端");
    assert.equal(merged.projects[0].sessionCount, 2);
    assert.equal(merged.metrics.workloadMs, 1200000);
    assert.equal(merged.metrics.coverageMs, 600000);
    assert.equal(merged.metrics.tokens, 200);
    await rm(join(dir, "sessions", "a.jsonl"));
    await post("/api/refresh", {});
    const missingLeader = await analysis();
    assert.equal(missingLeader.projects[0].id, a.id);
    assert.equal(missingLeader.projects[0].name, "我的前端");
    await writeFile(join(dir, "sessions", "a.jsonl"), text);
    await post("/api/refresh", {});
    assert.equal(
      merged.sessions.find((s: any) => s.id !== session.id).originalProjectId,
      b.id,
    );
    await post("/api/refresh", {});
    assert.equal(
      (await analysis()).sessions.find((s: any) => s.id === session.id).note,
      "复查登录表单",
    );
    await stop();
    await start();
    await post("/api/refresh", {});
    assert.equal((await analysis()).projects[0].sessionCount, 2);
    assert.equal(
      (
        await post("/api/annotations", {
          action: "restoreProject",
          projectId: b.id,
        })
      ).status,
      200,
    );
    assert.equal((await analysis()).projects.length, 2);
    assert.equal(
      (
        await post("/api/annotations", {
          action: "renameProject",
          projectId: a.id,
          name: "/Users/private/project",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/api/annotations", {
          action: "sessionNote",
          sessionId: session.id,
          note: "x".repeat(501),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/api/annotations", {
          action: "renameProject",
          projectId: "missing",
          name: "无效",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/api/annotations",
          { action: "renameProject", projectId: a.id, name: "跨站" },
          "https://example.invalid",
        )
      ).status,
      403,
    );
    const demo = await fetch(base + "/api/analysis?source=demo").then((r) =>
      r.json(),
    );
    assert.equal(demo.metrics.workloadMs, 6000000);
    assert.ok(!JSON.stringify(demo).includes("复查登录表单"));
    assert.equal(
      await readFile(join(dir, "sessions", "a.jsonl"), "utf8"),
      text,
    );
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});

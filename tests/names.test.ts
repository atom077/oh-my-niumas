import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  appendFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app/server.ts";

test("HTTP 使用 Codex 索引标题与目录名，索引改名无需重读日志且保持只读", async () => {
  const root = await mkdtemp(join(tmpdir(), "niumas-names-"));
  await mkdir(join(root, "sessions"));
  const text = await readFile(
    "fixtures/import-smoke/sessions/synthetic.jsonl",
    "utf8",
  );
  const input = join(root, "sessions", "one.jsonl"),
    index = join(root, "session_index.jsonl");
  await writeFile(input, text);
  const entry = (thread_name: string, updated_at: string) =>
    JSON.stringify({ id: "synthetic-http-session", thread_name, updated_at }) +
    "\n";
  await writeFile(
    index,
    entry("验证会话标题", "2026-10-20T01:00:00Z") +
      entry("过期标题", "2026-10-19T01:00:00Z"),
  );
  const server = await createApp({
    logRoot: root,
    dbPath: join(root, "cache.sqlite"),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const refresh = () =>
    fetch(base + "/api/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  const analysis = (query = "") =>
    fetch(base + "/api/analysis?source=local" + query).then((r) => r.json());
  try {
    const originalIndex = await readFile(index, "utf8");
    await refresh();
    assert.equal(await readFile(index, "utf8"), originalIndex);
    const first = await analysis();
    assert.equal(first.sessions[0].name, "验证会话标题");
    assert.equal(first.sessions[0].titleSource, "index");
    assert.equal(first.projects[0].name, "http-demo");
    assert.ok(!JSON.stringify(first).includes("/synthetic/"));
    assert.equal(
      (await analysis("&search=" + encodeURIComponent("验证会话标题"))).sessions
        .length,
      1,
    );
    await appendFile(index, entry("已更新的会话标题", "2026-10-20T02:00:00Z"));
    await refresh();
    const renamed = await analysis();
    assert.equal(renamed.sessions[0].name, "已更新的会话标题");
    assert.equal(renamed.sessions[0].id, first.sessions[0].id);
    assert.equal(renamed.importStatus.readFiles, 0);
    assert.deepEqual(renamed.metrics, first.metrics);
    await appendFile(
      index,
      entry("处理路径 /Users/SECRET/work/file.ts", "2026-10-20T03:00:00Z"),
    );
    await refresh();
    assert.equal((await analysis()).sessions[0].name, "处理路径 [路径]");
    await appendFile(
      index,
      entry("检查目录在/srv/company/data", "2026-10-20T03:30:00Z"),
    );
    await refresh();
    assert.equal((await analysis()).sessions[0].name, "检查目录在[路径]");
    for (const path of [
      String.raw`\\corp-server\secret-share\client-list.csv`,
      String.raw`\\?\C:\secret\report.csv`,
      "＼＼server＼share＼report.csv",
    ]) {
      await writeFile(
        index,
        entry("检查共享目录 " + path, "2026-10-20T03:40:00Z"),
      );
      await refresh();
      assert.equal((await analysis()).sessions[0].name, "检查共享目录 [路径]");
    }
    await rm(index);
    await refresh();
    assert.equal((await analysis()).sessions[0].name, "未命名会话");
    await writeFile(
      join(root, "secret-index"),
      entry("不应读取", "2026-10-20T04:00:00Z"),
    );
    await symlink(join(root, "secret-index"), index);
    await refresh();
    const skipped = await analysis();
    assert.equal(skipped.sessions[0].name, "未命名会话");
    assert.ok(!JSON.stringify(skipped).includes("不应读取"));
    assert.equal(await readFile(input, "utf8"), text);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});

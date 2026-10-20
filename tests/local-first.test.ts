import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app/server.ts";

/** Starts the app on a free port and returns its base URL with a closer. */
async function start(root: string, dbPath: string) {
  const server = await createApp({ logRoot: root, dbPath });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("本机数据可用性：未扫描、扫描后就绪、重启后仅有缓存", async () => {
  const root = await mkdtemp(join(tmpdir(), "niumas-sources-"));
  await cp("fixtures/import-smoke", root, { recursive: true });
  const db = join(root, "cache.sqlite");
  try {
    const first = await start(root, db);
    try {
      const sources = () =>
        fetch(first.base + "/api/sources").then((r) => r.json());
      assert.deepEqual(await sources(), {
        local: { ready: false, cached: false, sessions: 0, lastAt: null },
      });
      await fetch(first.base + "/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const { local } = await sources();
      assert.equal(local.ready, true);
      assert.equal(local.cached, true);
      assert.equal(local.sessions, 1);
      assert.equal(typeof local.lastAt, "number");
      const wrong = await fetch(first.base + "/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(wrong.status, 405);
    } finally {
      await first.close();
    }
    // After a restart the in-memory dataset is empty but the cache tells the page to rebuild it.
    const second = await start(root, db);
    try {
      const { local } = await fetch(second.base + "/api/sources").then((r) =>
        r.json(),
      );
      assert.equal(local.ready, false);
      assert.equal(local.cached, true);
      // Rebuilding from cache must not report already-known turns as new.
      const scan = await fetch(second.base + "/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then((r) => r.json());
      assert.equal(scan.cachedFiles, 1);
      assert.equal(scan.newSessions, 0);
      assert.equal(scan.newTurns, 0);
    } finally {
      await second.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

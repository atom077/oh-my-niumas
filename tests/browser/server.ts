import { mkdtemp, cp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../app/server.ts";

const root = await mkdtemp(join(tmpdir(), "niumas-browser-"));
await cp("fixtures/import-smoke", root, { recursive: true });
await mkdir(".local", { recursive: true });
await writeFile(".local/e2e-root.txt", root);
const server = await createApp({
  logRoot: root,
  dbPath: join(root, "cache.sqlite"),
});
server.listen(4318, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    server.close(async () => {
      await rm(root, { recursive: true, force: true });
      await rm(".local/e2e-root.txt", { force: true });
      process.exit(0);
    });
  });

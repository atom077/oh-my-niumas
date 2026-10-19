import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { analyze, normalizeSources } from "./core/analysis.ts";
import { demoSources } from "./core/demo.ts";
import { createLogStore } from "./importer.ts";

export async function createApp(
  options: { dev?: boolean; logRoot?: string; dbPath?: string } = {},
) {
  const store = await createLogStore(
    options.logRoot ?? join(homedir(), ".codex"),
    options.dbPath ?? resolve(".local/niumas.sqlite"),
  );
  const vite = options.dev
    ? await (
        await import("vite")
      ).createServer({
        server: {
          middlewareMode: true,
          hmr: {
            host: "127.0.0.1",
            port: Number(process.env.PORT ?? 4317) + 20000,
          },
        },
        appType: "spa",
      })
    : null;
  const server = createServer(async (req, res) => {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))
      return json(403, { error: "仅支持本机访问" });
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname === "/api/refresh") {
        if (req.method !== "POST")
          return json(405, { error: "请使用 POST 刷新" });
        if (
          (req.headers.origin && req.headers.origin !== `http://${host}`) ||
          req.headers["sec-fetch-site"] === "cross-site"
        )
          return json(403, { error: "来源不被允许" });
        if (
          !req.headers["content-type"]?.startsWith("application/json") ||
          Number(req.headers["content-length"] ?? 0) > 1024 ||
          req.headers["transfer-encoding"]
        )
          return json(400, { error: "请求格式无效" });
        req.resume();
        return json(200, await store.refresh());
      }
      if (url.pathname === "/api/analysis") {
        if (req.method !== "GET")
          return json(405, { error: "请使用 GET 查询" });
        const source = url.searchParams.get("source") ?? "demo";
        if (!["demo", "local"].includes(source))
          return json(400, { error: "数据源无效" });
        const number = (v: string | null) =>
          v === null ? undefined : Number(v);
        const from = number(url.searchParams.get("from")),
          to = number(url.searchParams.get("to"));
        if (
          (from !== undefined && !Number.isFinite(from)) ||
          (to !== undefined && !Number.isFinite(to)) ||
          (from !== undefined && to !== undefined && to <= from)
        )
          return json(400, { error: "时间范围无效" });
        const dataset =
          source === "local"
            ? store.getDataset()
            : normalizeSources(
                demoSources(url.searchParams.get("scenario") ?? undefined),
              );
        const data = analyze(dataset, {
          from,
          to,
          project: url.searchParams.get("project") ?? undefined,
          search: url.searchParams.get("search") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
        });
        return json(200, {
          ...data,
          projectOptions: analyze(dataset).projects,
          source,
          importStatus: source === "local" ? store.getStatus() : null,
        });
      }
      if (url.pathname.startsWith("/api/"))
        return json(404, { error: "接口不存在" });
      if (vite)
        return vite.middlewares(req, res, () => {
          res.writeHead(404);
          res.end();
        });
      const path =
        url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      const target = resolve("dist", `.${path}`);
      if (!target.startsWith(resolve("dist") + "/"))
        return json(403, { error: "路径不可访问" });
      let buffer: Buffer,
        extension = extname(target);
      try {
        buffer = await readFile(target);
      } catch {
        if (extension) return json(404, { error: "文件不存在" });
        buffer = await readFile(resolve("dist/index.html"));
        extension = ".html";
      }
      const mime: Record<string, string> = {
        ".js": "application/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      res.writeHead(200, {
        "Content-Type": mime[extension] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(buffer);
    } catch {
      return json(503, {
        error: "本机数据或页面暂时不可用，请重试或检查本地配置",
      });
    }
  });
  server.on("close", () => {
    store.close();
    void vite?.close();
  });
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = await createApp({
    dev: process.env.NIUMAS_DEV === "1",
    logRoot: process.env.NIUMAS_LOG_ROOT,
    dbPath: process.env.NIUMAS_DB_PATH,
  });
  server.listen(Number(process.env.PORT ?? 4317), "127.0.0.1", () =>
    console.log(
      "oh-my-牛马s → http://127.0.0.1:" + String(process.env.PORT ?? 4317),
    ),
  );
}

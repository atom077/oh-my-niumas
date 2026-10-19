import { DatabaseSync } from "node:sqlite";
import { constants } from "node:fs";
import { lstat, readdir, mkdir, open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { key, normalizeSources } from "./core/analysis.ts";
import type { Dataset, Source } from "./core/types.ts";

export interface ImportStatus {
  files: number;
  readFiles: number;
  cachedFiles: number;
  sessions: number;
  skippedLines: number;
  cappedFiles: number;
  updatedAt: string | null;
  issues: string[];
}
const MAX_FILE_BYTES = 64 * 1024 * 1024,
  MAX_TOTAL_BYTES = 1024 * 1024 * 1024,
  MAX_FILES = 1000;
const obj = (v: unknown): Record<string, any> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
const safeId = (v: unknown) =>
  typeof v === "string" && v ? key(v) : undefined;
const tokenFields = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];
function usage(v: unknown) {
  const p = obj(v);
  return Object.fromEntries(
    tokenFields.filter((k) => typeof p[k] === "number").map((k) => [k, p[k]]),
  );
}

// This projection is the sole persistence boundary. No original JSON line is cached.
function projectLine(raw: string): string {
  const v = obj(JSON.parse(raw)),
    p = obj(v.payload);
  const at =
    typeof v.timestamp === "string" && Number.isFinite(Date.parse(v.timestamp))
      ? new Date(v.timestamp).toISOString()
      : null;
  if (!at) return "";
  let payload: Record<string, unknown>;
  if (v.type === "session_meta") {
    payload = {
      id: safeId(p.id),
      cwd: safeId(p.cwd),
      forked_from_id: safeId(p.forked_from_id),
      parent_thread_id: safeId(p.parent_thread_id),
    };
    if (
      typeof p.cli_version === "string" &&
      /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(p.cli_version)
    )
      payload.cli_version = p.cli_version;
    if (obj(p.source).subagent) payload.source = { subagent: true };
  } else if (v.type === "turn_context") {
    payload = { cwd: safeId(p.cwd) };
  } else if (v.type === "token_usage_record") {
    payload = {
      thread_id: safeId(p.thread_id),
      turn_id: safeId(p.turn_id),
      response_id: safeId(p.response_id),
      usage: usage(p.usage),
      turn_token_usage: usage(p.turn_token_usage),
      thread_token_usage: usage(p.thread_token_usage),
    };
  } else if (
    v.type === "event_msg" &&
    [
      "task_started",
      "task_complete",
      "turn_aborted",
      "item_completed",
      "token_count",
    ].includes(p.type)
  ) {
    payload = { type: p.type, turn_id: safeId(p.turn_id) };
    if (p.type === "item_completed") {
      if (obj(p.item).type !== "UserMessage") return "";
      payload.item = { type: "UserMessage", id: safeId(obj(p.item).id) };
    }
    if (p.type === "token_count")
      payload.info = {
        total_token_usage: usage(obj(p.info).total_token_usage),
        last_token_usage: usage(obj(p.info).last_token_usage),
      };
  } else return "";
  return JSON.stringify({ timestamp: at, type: v.type, payload });
}

async function discover(root: string) {
  const files: string[] = [];
  let symlinks = 0,
    unreadable = 0;
  async function visit(path: string, depth: number) {
    if (depth > 8 || files.length >= MAX_FILES) return;
    let entries;
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        symlinks++;
        return;
      }
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      unreadable++;
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (entry.isSymbolicLink()) {
        symlinks++;
        continue;
      }
      const path2 = join(path, entry.name);
      if (entry.isDirectory()) await visit(path2, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.push(path2);
    }
  }
  await visit(join(root, "sessions"), 0);
  await visit(join(root, "archived_sessions"), 0);
  return { files: files.sort(), symlinks, unreadable };
}

export async function createLogStore(root: string, dbPath: string) {
  await mkdir(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE IF NOT EXISTS source_cache (file_key TEXT PRIMARY KEY, signature TEXT NOT NULL, projection TEXT NOT NULL, skipped INTEGER NOT NULL, capped INTEGER NOT NULL)",
  );
  let dataset: Dataset = { sessions: [], issues: [] };
  let status: ImportStatus = {
    files: 0,
    readFiles: 0,
    cachedFiles: 0,
    sessions: 0,
    skippedLines: 0,
    cappedFiles: 0,
    updatedAt: null,
    issues: [],
  };
  let inFlight: Promise<ImportStatus> | null = null;
  const refresh = () => {
    if (inFlight) return inFlight;
    inFlight = scan().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  async function scan(): Promise<ImportStatus> {
    const found = await discover(root),
      sources: Source[] = [],
      seen = new Set<string>();
    const next: ImportStatus = {
      files: found.files.length,
      readFiles: 0,
      cachedFiles: 0,
      sessions: 0,
      skippedLines: 0,
      cappedFiles: 0,
      updatedAt: new Date().toISOString(),
      issues: [],
    };
    if (found.symlinks) next.issues.push(`已跳过 ${found.symlinks} 个符号链接`);
    if (found.unreadable)
      next.issues.push(`${found.unreadable} 个候选目录不可用或不存在`);
    let budget = MAX_TOTAL_BYTES;
    for (const path of found.files) {
      const fileKey = key(path);
      seen.add(fileKey);
      try {
        const info = await lstat(path, { bigint: true });
        if (!info.isFile() || info.isSymbolicLink()) continue;
        const signature = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:v2`;
        const cached = db
          .prepare(
            "SELECT signature,projection,skipped,capped FROM source_cache WHERE file_key=?",
          )
          .get(fileKey);
        if (cached?.signature === signature) {
          sources.push({ alias: fileKey, text: String(cached.projection) });
          next.cachedFiles++;
          next.skippedLines += Number(cached.skipped);
          next.cappedFiles += Number(cached.capped);
          continue;
        }
        const size = Number(info.size),
          limit = Math.min(size, MAX_FILE_BYTES, budget);
        if (limit <= 0 && size > 0) {
          next.issues.push("达到单次 1 GiB 扫描预算，其余文件本次未导入");
          break;
        }
        budget -= limit;
        const rows: string[] = [];
        let skipped = 0;
        if (limit > 0) {
          const file = await open(
            path,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          const stream = file.createReadStream({
            start: 0,
            end: limit - 1,
            autoClose: true,
          });
          const reader = createInterface({
            input: stream,
            crlfDelay: Infinity,
          });
          for await (const line of reader) {
            if (!line.trim()) {
              rows.push("");
              continue;
            }
            if (Buffer.byteLength(line) > 1024 * 1024) {
              skipped++;
              rows.push("");
              continue;
            }
            try {
              rows.push(projectLine(line));
            } catch {
              skipped++;
              rows.push("");
            }
          }
        }
        const projection = rows.join("\n"),
          capped = limit < size ? 1 : 0;
        db.prepare(
          "INSERT OR REPLACE INTO source_cache VALUES (?,?,?,?,?)",
        ).run(fileKey, signature, projection, skipped, capped);
        sources.push({ alias: fileKey, text: projection });
        next.readFiles++;
        next.skippedLines += skipped;
        next.cappedFiles += capped;
      } catch {
        next.issues.push("一个日志不可读或扫描期间发生变化，已跳过");
      }
    }
    for (const row of db.prepare("SELECT file_key FROM source_cache").all())
      if (!seen.has(String(row.file_key)))
        db.prepare("DELETE FROM source_cache WHERE file_key=?").run(
          row.file_key,
        );
    dataset = normalizeSources(sources);
    next.sessions = dataset.sessions.length;
    if (next.cappedFiles)
      next.issues.push(
        `${next.cappedFiles} 个日志只读取前 64 MiB 或预算内前缀，覆盖不完整`,
      );
    if (next.skippedLines)
      next.issues.push(`${next.skippedLines} 行过大、不完整或无效，未导入`);
    const noTiming = dataset.sessions.filter((s) => s.firstAt === null).length;
    if (noTiming)
      next.issues.push(`${noTiming} 个会话缺少可用时间证据，未进入时间轴`);
    if (found.files.length >= MAX_FILES)
      next.issues.push("达到 1000 文件发现上限，覆盖可能不完整");
    if (!found.files.length)
      next.issues.push("未发现本机日志，可继续使用合成演示");
    status = next;
    return structuredClone(status);
  }
  return {
    refresh,
    getDataset: () => dataset,
    getStatus: () => structuredClone(status),
    close: () => db.close(),
  };
}

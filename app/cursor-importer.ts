import { DatabaseSync } from "node:sqlite";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { key, normalizeSources } from "./core/analysis.ts";
import type { Dataset, Session } from "./core/types.ts";
import { projectDirectoryName, titleText } from "./display-names.ts";

const MAX_DATABASES = 100,
  MAX_SESSIONS = 1000,
  MAX_MESSAGES = 20_000;
const MAX_VALUE = 64 * 1024 * 1024,
  MAX_BYTES = 128 * 1024 * 1024;
const obj = (v: unknown): Record<string, any> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
const at = (v: unknown): number | null => {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n < 8.64e15 ? n : null;
};
const safeId = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null;
function folderPath(uri: unknown): string | null {
  try {
    if (typeof uri === "string" && uri.startsWith("file:"))
      return fileURLToPath(uri);
    const u = obj(uri);
    if (
      u.scheme === "file" &&
      typeof u.path === "string" &&
      u.path.startsWith("/")
    )
      return u.path;
  } catch {
    /* Invalid/remote workspace URI is not a local project. */
  }
  return null;
}
async function regular(path: string) {
  const s = await lstat(path);
  if (s.isSymbolicLink()) throw Error("symlink");
  return s;
}

interface Bubble {
  id: string;
  type: number;
  at: number | null;
  start: number | null;
  completed: number | null;
  reportedDurationMs: number | null;
  simulated: boolean;
}
interface Projection {
  id: string;
  projectId: string;
  projectName: string;
  projectKnown: boolean;
  bubbles: Bubble[];
}
export interface CursorStatus {
  databases: number;
  sessions: number;
  excluded: number;
  messages: number;
  issues: string[];
}
export function normalizeCursor(projections: Projection[]): Dataset {
  const sessions: Session[] = [];
  for (const p of projections) {
    // Reuse the established empty-session defaults, without translating Cursor messages into Codex events.
    const s = normalizeSources([
      {
        alias: p.id,
        text: JSON.stringify({
          type: "session_meta",
          payload: { id: p.id, cwd: p.projectId, project_name: p.projectName },
        }),
      },
    ]).sessions[0];
    s.provider = "cursor";
    s.titleSource = "missing";
    s.name = "未命名会话";
    s.issues.push(
      "Cursor 整轮起止边界未验证，执行、并发及闭合等待不计入已知值",
    );
    s.issues.push("Cursor Token 计数语义未验证，零值不代表零消耗，显示 N/A");
    if (!p.projectKnown)
      s.issues.push("Cursor 缺少单目录工作区证据，项目归属未知");
    else s.issues.push("Cursor 项目按工作区目录归属，不能证明是会话起始 cwd");
    let turn: Session["turns"][number] | undefined;
    const times: number[] = [];
    p.bubbles.forEach((b, index) => {
      for (const t of [b.at, b.start, b.completed])
        if (t !== null) times.push(t);
      if (b.type === 1 && !b.simulated) {
        turn = {
          id: key(`${p.id}:${b.id}`),
          start: null,
          end: null,
          observedAt: b.at,
          status: "unknown",
          tokens: null,
          evidence: [{ source: p.id, line: index + 1 }],
        };
        // Input time is an observed activity point, not an AI execution start.
        s.turns.push(turn);
        if (b.at !== null)
          s.inputs.push({ id: b.id, at: b.at, turnId: turn.id, exact: false });
      } else if (b.type === 2 && turn) {
        if (b.reportedDurationMs !== null)
          turn.reportedDurationMs = Math.max(
            turn.reportedDurationMs ?? 0,
            b.reportedDurationMs,
          );
        turn.evidence.push({ source: p.id, line: index + 1 });
      }
    });
    if (!s.inputs.length) continue;
    s.activityTimes = [...new Set(times)];
    for (const t of times) {
      if (s.firstAt === null || t < s.firstAt) s.firstAt = t;
      if (s.lastAt === null || t > s.lastAt) s.lastAt = t;
    }
    sessions.push(s);
  }
  return { sessions, issues: [] };
}

/** Reads only allowlisted metadata. No chat text, tools, authentication rows or original JSON leave SQLite. */
export async function scanCursor(root: string) {
  const status: CursorStatus = {
    databases: 0,
    sessions: 0,
    excluded: 0,
    messages: 0,
    issues: [],
  };
  const titles = new Map<string, string>();
  const paths: string[] = [];
  const folders = new Map<string, string>();
  const projections = new Map<string, Projection>();
  try {
    if (!(await regular(root)).isDirectory()) throw Error("not a directory");
  } catch (e) {
    status.issues.push("Cursor 根目录不存在、不可读或为符号链接");
    return {
      status,
      titles,
      projections: (e as NodeJS.ErrnoException).code === "ENOENT" ? [] : null,
    };
  }
  let unavailable = false;
  try {
    const global = join(root, "globalStorage");
    await regular(global);
    paths.push(join(global, "state.vscdb"));
  } catch (e) {
    unavailable = (e as NodeJS.ErrnoException).code !== "ENOENT";
    status.issues.push("Cursor 全局存储不存在、不可读或为符号链接");
  }
  try {
    const workspaces = join(root, "workspaceStorage");
    await regular(workspaces);
    const entries = await readdir(workspaces, { withFileTypes: true });
    if (entries.length > MAX_DATABASES)
      status.issues.push("Cursor 工作区发现超过 100 个，覆盖不完整");
    for (const entry of entries.slice(0, MAX_DATABASES)) {
      if (entry.isSymbolicLink()) {
        status.issues.push("Cursor 已跳过符号链接工作区，覆盖不完整");
        continue;
      }
      if (!entry.isDirectory()) continue;
      const dir = join(workspaces, entry.name);
      paths.push(join(dir, "state.vscdb"));
      try {
        const path = join(dir, "workspace.json");
        if ((await regular(path)).size > 64 * 1024) throw Error("large");
        const data = JSON.parse(await readFile(path, "utf8"));
        const folder = folderPath(data.folder);
        if (folder) folders.set(entry.name, folder);
      } catch {
        /* A multi-root/empty workspace has no proven single directory. */
      }
    }
  } catch (e) {
    unavailable ||= (e as NodeJS.ErrnoException).code !== "ENOENT";
    status.issues.push("Cursor 工作区存储不存在、不可读或为符号链接");
  }
  if (unavailable) {
    status.issues.push("Cursor 存储不可读，本次保留上次缓存");
    return { status, titles, projections: null };
  }
  let bytes = 0;
  for (const path of paths) {
    let db: DatabaseSync | undefined;
    try {
      if (!(await regular(path)).isFile()) continue;
      // Never follow a linked WAL/SHM sidecar or request immutable mode (which would ignore live WAL data).
      for (const suffix of ["-wal", "-shm"]) {
        try {
          await regular(path + suffix);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
      db = new DatabaseSync(path, { readOnly: true });
      db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=150; BEGIN");
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((r) => r.name),
      );
      if (!tables.has("cursorDiskKV")) {
        status.issues.push(
          "一个 Cursor 数据库没有受支持的 cursorDiskKV 表，未解析旧版聊天",
        );
        continue;
      }
      status.databases++;
      const headers = new Map<string, Record<string, any>>();
      if (tables.has("composerHeaders")) {
        for (const row of db
          .prepare(
            `SELECT composerId, json_object(
          'name',json_extract(value,'$.name'), 'isSubagent',isSubagent,
          'workspaceId',workspaceId, 'workspaceIdentifier',json_extract(value,'$.workspaceIdentifier'),
          'subagentInfo',json_type(value,'$.subagentInfo'),
          'isBestOfNSubcomposer',json_extract(value,'$.isBestOfNSubcomposer')) AS metadata
          FROM composerHeaders WHERE json_valid(value) LIMIT ?`,
          )
          .all(MAX_SESSIONS + 1)) {
          headers.set(String(row.composerId), JSON.parse(String(row.metadata)));
        }
      }
      const rows = db
        .prepare(
          `SELECT key, length(value) AS size,
        CASE WHEN length(value)<=? AND json_valid(value) THEN json_object(
        'composerId',json_extract(value,'$.composerId'),
        'workspaceIdentifier',json_extract(value,'$.workspaceIdentifier'),
        'subagentInfo',json_type(value,'$.subagentInfo'),
        'isBestOfNSubcomposer',json_extract(value,'$.isBestOfNSubcomposer'),
        'headerCount',json_array_length(value,'$.fullConversationHeadersOnly'),
        'headers',(SELECT json_group_array(json_object('bubbleId',json_extract(h.value,'$.bubbleId')))
          FROM (SELECT value FROM json_each(cursorDiskKV.value,'$.fullConversationHeadersOnly') LIMIT 20000) h)) END AS metadata
        FROM cursorDiskKV WHERE key GLOB 'composerData:*' ORDER BY key LIMIT ?`,
        )
        .iterate(MAX_VALUE, MAX_SESSIONS + 1);
      let inspected = 0;
      for (const row of rows) {
        if (++inspected > MAX_SESSIONS) {
          status.issues.push("Cursor 会话发现超过 1000 个，覆盖不完整");
          break;
        }
        if (projections.size >= MAX_SESSIONS || bytes >= MAX_BYTES) {
          status.issues.push(
            "Cursor 达到 1000 会话或 128 MiB 扫描预算，覆盖不完整",
          );
          break;
        }
        bytes += Number(row.size);
        if (!row.metadata) {
          status.excluded++;
          continue;
        }
        const m = JSON.parse(String(row.metadata)),
          id = safeId(m.composerId);
        if (!id || row.key !== `composerData:${id}`) {
          status.excluded++;
          continue;
        }
        const header = headers.get(id) ?? {};
        if (
          m.subagentInfo ||
          header.subagentInfo ||
          header.isSubagent ||
          m.isBestOfNSubcomposer ||
          header.isBestOfNSubcomposer
        ) {
          status.excluded++;
          continue;
        }
        const sessionKey = key(`cursor:${id}`);
        if (projections.has(sessionKey)) continue;
        const hs = Array.isArray(m.headers) ? m.headers : [];
        if (m.headerCount > MAX_MESSAGES)
          status.issues.push("Cursor 单会话消息超过 20000 条，覆盖不完整");
        if (!hs.length) continue; // Drafts are not sessions with observed input.
        const folder =
          folderPath(obj(m.workspaceIdentifier).uri) ??
          folderPath(obj(header.workspaceIdentifier).uri) ??
          folders.get(
            String(obj(m.workspaceIdentifier).id ?? header.workspaceId),
          );
        const projection: Projection = {
          id: sessionKey,
          projectId: folder
            ? key(folder)
            : key(`cursor:unassigned:${obj(m.workspaceIdentifier).id ?? id}`),
          projectName: folder
            ? projectDirectoryName(folder)
            : "Cursor · 未知工作区",
          projectKnown: Boolean(folder),
          bubbles: [],
        };
        const seen = new Set<string>();
        for (const h of hs) {
          if (status.messages >= MAX_MESSAGES || bytes >= MAX_BYTES) {
            status.issues.push(
              "Cursor 达到 20000 消息或 128 MiB 扫描预算，覆盖不完整",
            );
            break;
          }
          const bid = safeId(obj(h).bubbleId);
          if (!bid || seen.has(bid)) continue;
          seen.add(bid);
          const bRow = db
            .prepare(
              `SELECT length(value) AS size, CASE WHEN length(value)<=? AND json_valid(value) THEN json_object(
            'type',json_extract(value,'$.type'), 'createdAt',json_extract(value,'$.createdAt'),
            'startedAtMs',json_extract(value,'$.startedAtMs'), 'completedAtMs',json_extract(value,'$.completedAtMs'),
            'turnDurationMs',json_extract(value,'$.turnDurationMs'), 'isSimulatedMsg',json_extract(value,'$.isSimulatedMsg')) END AS metadata
            FROM cursorDiskKV WHERE key=?`,
            )
            .get(MAX_VALUE, `bubbleId:${id}:${bid}`);
          if (!bRow?.metadata) {
            status.issues.push("Cursor 部分消息缺失、过大或无效，覆盖不完整");
            continue;
          }
          bytes += Number(bRow.size);
          const b = JSON.parse(String(bRow.metadata));
          if (b.type !== 1 && b.type !== 2) continue;
          projection.bubbles.push({
            id: key(`cursor:${id}:${bid}`),
            type: b.type,
            at: at(b.createdAt),
            start: at(b.startedAtMs),
            completed: at(b.completedAtMs),
            simulated: b.isSimulatedMsg === 1,
            reportedDurationMs:
              Number.isSafeInteger(b.turnDurationMs) && b.turnDurationMs > 0
                ? b.turnDurationMs
                : null,
          });
          status.messages++;
        }
        projections.set(sessionKey, projection);
        const title = titleText(header.name);
        if (title) titles.set(key(sessionKey), title);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      status.issues.push(
        "一个 Cursor 数据库不可读、繁忙或格式不受支持，本次保留上次缓存",
      );
      return { status, titles, projections: null };
    } finally {
      db?.close();
    }
  }
  status.issues = [...new Set(status.issues)];
  status.sessions = normalizeCursor([...projections.values()]).sessions.length;
  if (status.excluded)
    status.issues.push(
      `Cursor 排除 ${status.excluded} 个子 Agent、分支或无效会话`,
    );
  return { status, titles, projections: [...projections.values()] };
}

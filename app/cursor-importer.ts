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
/** Max gap between input + turnDurationMs and the terminal message; ~93% of locally sampled turns fall within it. */
export const INFERENCE_TOLERANCE_MS = 20_000;
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
  /** Raw Cursor bubbleId; a moved or forked chat copies it into the new composer unchanged. */
  sourceId?: string;
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
  /** folder: single workspace directory; workspace: multi-root .code-workspace file, not attributed to any one repo. */
  projectEvidence: "folder" | "workspace" | "unknown";
  /** composerData.createdAt; breaks ties between copies in favour of the newer composer. */
  createdAt?: number | null;
  bubbles: Bubble[];
}

/**
 * Moving a chat to another workspace (or forking it) archives the original composer and creates a new one
 * that repeats the same bubbleIds. Each turn, keyed by its user bubbleId, is kept in exactly one composer:
 * the copy holding the most bubbles for it, then the newer composer. Composers left without turns disappear.
 * @returns Projections with duplicate turns removed, and how many composers were fully absorbed.
 */
export function dedupeCursorCopies(projections: Projection[]) {
  const groups = projections.map((p) => {
    // A leading run before the first user bubble belongs to no turn and is kept as-is.
    const out: { key: string | null; bubbles: Bubble[] }[] = [
      { key: null, bubbles: [] },
    ];
    for (const b of p.bubbles) {
      if (b.type === 1 && !b.simulated)
        out.push({ key: b.sourceId ?? b.id, bubbles: [] });
      out[out.length - 1].bubbles.push(b);
    }
    return out;
  });
  const owner = new Map<string, { index: number; size: number }>();
  groups.forEach((gs, index) => {
    for (const g of gs) {
      if (g.key === null) continue;
      const cur = owner.get(g.key);
      const newer =
        cur !== undefined &&
        (projections[index].createdAt ?? 0) >
          (projections[cur.index].createdAt ?? 0);
      if (
        !cur ||
        g.bubbles.length > cur.size ||
        (g.bubbles.length === cur.size && newer)
      )
        owner.set(g.key, { index, size: g.bubbles.length });
    }
  });
  let absorbed = 0;
  const result = projections.map((p, index) => {
    const kept = groups[index].filter(
      (g) => g.key === null || owner.get(g.key)!.index === index,
    );
    if (
      groups[index].some((g) => g.key !== null) &&
      !kept.some((g) => g.key !== null)
    )
      absorbed++;
    return { ...p, bubbles: kept.flatMap((g) => g.bubbles) };
  });
  return { projections: result, absorbed };
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
  const deduped = dedupeCursorCopies(projections);
  for (const p of deduped.projections) {
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
    let turn: Session["turns"][number] | undefined;
    const times: number[] = [];
    /** Creation time of the assistant message that carries each turn's recorded duration. */
    const terminalAt = new Map<string, number | null>();
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
        s.turns.push(turn);
        // Cursor stamps the user message at submission, and turnDurationMs is timed from it.
        if (b.at !== null)
          s.inputs.push({ id: b.id, at: b.at, turnId: turn.id, exact: true });
      } else if (b.type === 2 && turn) {
        if (
          b.reportedDurationMs !== null &&
          b.reportedDurationMs > (turn.reportedDurationMs ?? 0)
        ) {
          turn.reportedDurationMs = b.reportedDurationMs;
          terminalAt.set(turn.id, b.at);
        }
        turn.evidence.push({ source: p.id, line: index + 1 });
      }
    });
    if (!s.inputs.length) continue;
    // No official API exposes turn end; accept input + duration only when it agrees with the terminal message
    // and does not run into the next input. Everything else stays an activity point.
    let unlocated = 0;
    s.turns.forEach((t, i) => {
      const terminal = terminalAt.get(t.id) ?? null,
        next = s.turns[i + 1]?.observedAt ?? null;
      const end =
        t.observedAt != null && t.reportedDurationMs !== undefined
          ? t.observedAt + t.reportedDurationMs
          : null;
      if (
        end !== null &&
        terminal !== null &&
        Math.abs(end - terminal) <= INFERENCE_TOLERANCE_MS &&
        (next === null || end <= next)
      ) {
        t.start = t.observedAt!;
        t.end = end;
        // A recorded terminal duration is the only completion evidence; aborts are indistinguishable.
        t.status = "completed";
        t.timing = "inferred";
      } else unlocated++;
    });
    if (s.turns.some((t) => t.timing === "inferred"))
      s.issues.push(
        "Cursor 执行区间按输入时间 + 记录时长推算（与结尾消息相差不超过 20 秒），非官方接口，状态按完成推算",
      );
    if (unlocated)
      s.issues.push(
        `Cursor ${unlocated} 轮缺少记录时长或与消息跨度不一致，未绘制执行区间`,
      );
    if (p.projectEvidence === "unknown")
      s.issues.push("Cursor 缺少单目录工作区证据，项目归属未知");
    else if (p.projectEvidence === "workspace")
      s.issues.push(
        "Cursor 会话属于多目录工作区，按工作区文件分组，未归属到其中任一仓库",
      );
    else s.issues.push("Cursor 项目按工作区目录归属，不能证明是会话起始 cwd");
    s.activityTimes = [...new Set(times)];
    // Inferred ends may trail the last stored message slightly; keep them inside the session extent.
    for (const t of times.concat(
      s.turns.flatMap((t) => (t.end === null ? [] : [t.end])),
    )) {
      if (s.firstAt === null || t < s.firstAt) s.firstAt = t;
      if (s.lastAt === null || t > s.lastAt) s.lastAt = t;
    }
    sessions.push(s);
  }
  return {
    sessions,
    issues: deduped.absorbed
      ? [
          `Cursor 合并 ${deduped.absorbed} 个迁移工作区或分叉留下的会话副本，重复轮次只计一次`,
        ]
      : [],
  };
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
  /** Workspace storage id → multi-root .code-workspace path. */
  const workspaceFiles = new Map<string, string>();
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
        const workspaceFile = folderPath(data.workspace);
        if (workspaceFile) workspaceFiles.set(entry.name, workspaceFile);
      } catch {
        /* An empty/unreadable workspace has no proven directory or workspace file. */
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
        'createdAt',json_extract(value,'$.createdAt'),
        'workspaceIdentifier',json_extract(value,'$.workspaceIdentifier'),
        'subagentInfo',json_type(value,'$.subagentInfo'),
        'isBestOfNSubcomposer',json_extract(value,'$.isBestOfNSubcomposer'),
        'headerCount',json_array_length(value,'$.fullConversationHeadersOnly'),
        'headers',(SELECT json_group_array(json_object('bubbleId',json_extract(h.value,'$.bubbleId')))
          FROM (SELECT value FROM json_each(cursorDiskKV.value,'$.fullConversationHeadersOnly') LIMIT 20000) h)) END AS metadata
        FROM cursorDiskKV WHERE key GLOB 'composerData:*'
        ORDER BY CASE WHEN json_valid(value) THEN json_extract(value,'$.lastUpdatedAt') END DESC, key LIMIT ?`,
        )
        .iterate(MAX_VALUE, MAX_SESSIONS + 1);
      /**
       * Cursor composerData v18+ leaves fullConversationHeadersOnly empty and pages headers into
       * composerConvHeaders:<id>:000000, :000001 … (zero-padded, so key order is page order).
       */
      const pageStmt = db.prepare(
        `SELECT length(value) AS size, CASE WHEN length(value)<=? AND json_valid(value) THEN
        (SELECT json_group_array(json_object('bubbleId',json_extract(h.value,'$.bubbleId')))
          FROM (SELECT value FROM json_each(cursorDiskKV.value) LIMIT 20000) h) END AS headers
        FROM cursorDiskKV WHERE key > ? AND key < ? ORDER BY key`,
      );
      const bubbleStmt = db.prepare(
        `SELECT length(value) AS size, CASE WHEN length(value)<=? AND json_valid(value) THEN json_object(
        'type',json_extract(value,'$.type'), 'createdAt',json_extract(value,'$.createdAt'),
        'startedAtMs',json_extract(value,'$.startedAtMs'), 'completedAtMs',json_extract(value,'$.completedAtMs'),
        'turnDurationMs',json_extract(value,'$.turnDurationMs'), 'isSimulatedMsg',json_extract(value,'$.isSimulatedMsg')) END AS metadata
        FROM cursorDiskKV WHERE key=?`,
      );
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
        const hs: unknown[] = Array.isArray(m.headers) ? m.headers : [];
        if (!hs.length) {
          m.headerCount = 0;
          // ';' is the code point after ':', so the range covers exactly this composer's pages.
          for (const page of pageStmt.iterate(
            MAX_VALUE,
            `composerConvHeaders:${id}:`,
            `composerConvHeaders:${id};`,
          )) {
            bytes += Number(page.size);
            if (!page.headers) {
              status.issues.push("Cursor 部分消息页过大或无效，覆盖不完整");
              continue;
            }
            const items = JSON.parse(String(page.headers));
            m.headerCount += items.length;
            if (hs.length < MAX_MESSAGES)
              hs.push(...items.slice(0, MAX_MESSAGES - hs.length));
          }
        }
        if (m.headerCount > MAX_MESSAGES)
          status.issues.push("Cursor 单会话消息超过 20000 条，覆盖不完整");
        if (!hs.length) continue; // Drafts are not sessions with observed input.
        const workspaceId = String(
          obj(m.workspaceIdentifier).id ?? header.workspaceId,
        );
        const folder =
          folderPath(obj(m.workspaceIdentifier).uri) ??
          folderPath(obj(header.workspaceIdentifier).uri) ??
          folders.get(workspaceId);
        // Multi-root workspaces list several repos; group by the workspace file instead of guessing one.
        const workspaceFile = folder
          ? undefined
          : (folderPath(obj(m.workspaceIdentifier).configPath) ??
            folderPath(obj(header.workspaceIdentifier).configPath) ??
            workspaceFiles.get(workspaceId));
        const projection: Projection = {
          id: sessionKey,
          projectId: folder
            ? key(folder)
            : workspaceFile
              ? key(`cursor:workspace:${workspaceFile}`)
              : key(
                  `cursor:unassigned:${obj(m.workspaceIdentifier).id ?? id}`,
                ),
          projectName: folder
            ? projectDirectoryName(folder)
            : workspaceFile
              ? `${projectDirectoryName(workspaceFile.replace(/\.code-workspace$/i, ""))}（多目录）`
              : "Cursor · 未知工作区",
          projectEvidence: folder
            ? "folder"
            : workspaceFile
              ? "workspace"
              : "unknown",
          createdAt: at(m.createdAt),
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
          const bRow = bubbleStmt.get(MAX_VALUE, `bubbleId:${id}:${bid}`);
          if (!bRow?.metadata) {
            status.issues.push("Cursor 部分消息缺失、过大或无效，覆盖不完整");
            continue;
          }
          bytes += Number(bRow.size);
          const b = JSON.parse(String(bRow.metadata));
          if (b.type !== 1 && b.type !== 2) continue;
          projection.bubbles.push({
            id: key(`cursor:${id}:${bid}`),
            sourceId: bid,
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
  const normalized = normalizeCursor([...projections.values()]);
  status.sessions = normalized.sessions.length;
  status.issues.push(...normalized.issues);
  if (status.excluded)
    status.issues.push(
      `Cursor 排除 ${status.excluded} 个子 Agent、分支或无效会话`,
    );
  return { status, titles, projections: [...projections.values()] };
}

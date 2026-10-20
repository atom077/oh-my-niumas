import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { basename, win32, join } from "node:path";
import { key } from "./core/analysis.ts";

// Titles are explicit index metadata, never reconstructed from message content.
export function titleText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[／＼]/g, (c) => (c === "／" ? "/" : "\\"))
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\\\\[^\s<>"'`，。；（）()[\]{}]+/g, "[路径]")
    .replace(/[A-Za-z]:[\\/][^\s<>"'`，。；（）()[\]{}]+/g, "[路径]")
    .replace(/\\[^\s<>"'`，。；（）()[\]{}]+/g, "[路径]")
    .replace(
      /\/(?:Users|home|private|tmp|var|opt|etc|Volumes)\/[^\s<>"'`，。；（）()[\]{}]+/g,
      "[路径]",
    )
    .replace(
      /(^|[\s\p{Script=Han}（("'`：:=])\/(?!\/)[^\s<>"'`，。；（）()[\]{}]+/gu,
      "$1[路径]",
    )
    .replace(
      /\/[^\s<>"'`，。；（）()[\]{}]+\/[^\s<>"'`，。；（）()[\]{}]+/g,
      "[路径]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function projectDirectoryName(cwd: unknown): string {
  if (typeof cwd !== "string") return "未命名项目";
  const leaf = cwd.includes("\\") ? win32.basename(cwd) : basename(cwd);
  return titleText(leaf) || "未命名项目";
}

export async function readSessionTitles(root: string) {
  const names = new Map<string, { title: string; updated: number }>();
  const issues: string[] = [];
  const maxBytes = 8 * 1024 * 1024;
  let skipped = 0;
  try {
    const path = join(root, "session_index.jsonl");
    const candidate = await lstat(path);
    if (!candidate.isFile() || candidate.isSymbolicLink())
      throw Error("index unavailable");
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (!info.isFile()) throw Error("index unavailable");
      const limit = Math.min(info.size, maxBytes);
      if (info.size > limit) issues.push("会话标题索引超过 8 MiB，仅读取前缀");
      if (limit > 0) {
        const buffer = Buffer.alloc(limit);
        let bytes = 0;
        while (bytes < limit) {
          const result = await file.read(buffer, bytes, limit - bytes, bytes);
          if (!result.bytesRead) break;
          bytes += result.bytesRead;
        }
        for (const line of buffer
          .subarray(0, bytes)
          .toString("utf8")
          .split(/\r?\n/)) {
          if (!line.trim()) continue;
          if (Buffer.byteLength(line) > 64 * 1024) {
            skipped++;
            continue;
          }
          try {
            const value = JSON.parse(line);
            const title = titleText(value?.thread_name),
              updated = Date.parse(value?.updated_at);
            if (
              typeof value?.id !== "string" ||
              !value.id ||
              typeof value?.updated_at !== "string" ||
              !title ||
              !Number.isFinite(updated)
            ) {
              skipped++;
              continue;
            }
            // Match the unchanged two-stage anonymous session identifier used by the importer.
            const id = key(key(value.id));
            if (!names.has(id) || updated >= names.get(id)!.updated)
              names.set(id, { title, updated });
          } catch {
            skipped++;
          }
        }
      }
    } finally {
      await file.close();
    }
  } catch {
    issues.push("会话标题索引不可用，缺少标题的记录显示为未命名会话");
  }
  if (skipped) issues.push(`会话标题索引跳过 ${skipped} 条无效或过大记录`);
  return { names, issues };
}

import { DatabaseSync } from "node:sqlite";
import type { Dataset } from "./core/types.ts";

interface Labels {
  names: Record<string, string>;
  groups: Record<string, string>;
  notes: Record<string, string>;
}
export class AnnotationError extends Error {}

function label(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value) ||
    /(?:^|[\s:：=(\["'])\/|\/(?:Users|home|private|tmp|etc|var|Volumes)\/|~\/|[A-Za-z]:[\\/]|\\\\|file:\/\//.test(
      value,
    )
  )
    throw new AnnotationError("请使用不含绝对路径的短文本");
  return value.trim();
}

export function createAnnotations(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS local_labels (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)",
  );
  const row = db.prepare("SELECT value FROM local_labels WHERE id=1").get();
  let labels: Labels = row
    ? JSON.parse(String(row.value))
    : { names: {}, groups: {}, notes: {} };
  const group = (id: string) => labels.groups[id] ?? id;
  const projects = (dataset: Dataset) => {
    const names = new Map(
      dataset.sessions.map((s) => [s.projectId, s.projectName]),
    );
    const available = new Set(names.keys());
    for (const id of available) {
      const target = group(id);
      if (!names.has(target)) names.set(target, `工地 ${target.slice(0, 6)}`);
    }
    return [...names.entries()].map(([id, originalName]) => ({
      id,
      originalName,
      name: labels.names[id] || originalName,
      groupId: group(id),
      available: available.has(id),
    }));
  };
  return {
    projects,
    apply(dataset: Dataset): Dataset {
      const known = new Map(projects(dataset).map((p) => [p.id, p]));
      return {
        ...dataset,
        sessions: dataset.sessions.map((s) => {
          const target = known.get(group(s.projectId));
          return {
            ...s,
            originalProjectId: s.projectId,
            originalProjectName: s.projectName,
            projectId: target?.id ?? s.projectId,
            projectName:
              target?.name ?? (labels.names[s.projectId] || s.projectName),
            note: labels.notes[s.id] ?? "",
          };
        }),
      };
    },
    update(value: unknown, dataset: Dataset) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new AnnotationError("标记格式无效");
      const v = value as Record<string, unknown>;
      const ids = new Set(projects(dataset).map((p) => p.id));
      const project = (id: unknown) => {
        if (typeof id !== "string" || !ids.has(id))
          throw new AnnotationError("请先扫描并选择有效项目");
        return id;
      };
      const next = structuredClone(labels);
      if (v.action === "renameProject") {
        next.names[project(v.projectId)] = label(v.name, 80);
      } else if (v.action === "sessionNote") {
        if (
          typeof v.sessionId !== "string" ||
          !dataset.sessions.some((s) => s.id === v.sessionId)
        )
          throw new AnnotationError("会话不存在");
        next.notes[v.sessionId] = label(v.note, 500);
      } else if (v.action === "mergeProjects") {
        const from = group(project(v.from)),
          to = group(project(v.to));
        if (from === to) throw new AnnotationError("请选择另一个项目");
        // Flatten the whole source group. No cycles or mapping chains are persisted.
        for (const id of new Set([...ids, ...Object.keys(labels.groups)]))
          if (group(id) === from) next.groups[id] = to;
      } else if (v.action === "restoreProject") {
        const id = project(v.projectId);
        // Detach one original directory; if it was the group leader, detach its members too.
        if (group(id) === id)
          for (const member of Object.keys(next.groups))
            if (next.groups[member] === id) delete next.groups[member];
        delete next.groups[id];
      } else throw new AnnotationError("标记操作无效");
      db.prepare("INSERT OR REPLACE INTO local_labels VALUES (1,?)").run(
        JSON.stringify(next),
      );
      labels = next;
    },
  };
}

import { useState } from "react";
import type { Session } from "../core/types";

export interface OriginalProject {
  id: string;
  originalName: string;
  name: string;
  groupId: string;
  available: boolean;
}
export type SaveLabel = (value: Record<string, string>) => Promise<void>;

export function ProjectLabels({
  projects,
  save,
}: {
  projects: OriginalProject[];
  save: SaveLabel;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(value: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      await save(value);
      setMessage("本地标记已保存");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="local-labels">
      <summary>管理本地项目</summary>
      <p>
        为项目目录添加别名，或将相关目录合并统计。恢复只改变本地分组，日志不会修改。恢复组首目录时会拆开整组。
      </p>
      {projects.map((p) => (
        <div className="label-row" key={p.id}>
          <small>
            起始目录证据 · {p.originalName}
            {!p.available && "（当前无可用日志）"}
          </small>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit({
                action: "renameProject",
                projectId: p.id,
                name: String(new FormData(e.currentTarget).get("name") ?? ""),
              });
            }}
          >
            <input
              key={p.name}
              name="name"
              aria-label="项目别名"
              defaultValue={p.name === p.originalName ? "" : p.name}
              placeholder={p.originalName}
              maxLength={80}
            />
            <button disabled={busy}>保存别名</button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const to = String(
                new FormData(e.currentTarget).get("target") ?? "",
              );
              if (to) void submit({ action: "mergeProjects", from: p.id, to });
            }}
          >
            <select name="target" aria-label="合并到项目" defaultValue="">
              <option value="">合并到…</option>
              {projects
                .filter((t) => t.groupId === t.id && t.groupId !== p.groupId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            <button
              disabled={busy || !projects.some((t) => t.groupId !== p.groupId)}
            >
              合并
            </button>
          </form>
          <span>
            当前：{projects.find((t) => t.id === p.groupId)?.name ?? p.name}
          </span>
          <button
            disabled={
              busy ||
              !projects.some((t) => t.groupId === p.groupId && t.id !== p.id)
            }
            onClick={() =>
              void submit({ action: "restoreProject", projectId: p.id })
            }
          >
            恢复原始归属
          </button>
        </div>
      ))}
      <div role="status">{message}</div>
    </details>
  );
}

export function SessionNote({
  session,
  save,
}: {
  session: Session;
  save: SaveLabel;
}) {
  const [note, setNote] = useState(session.note ?? ""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="session-label"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          await save({ action: "sessionNote", sessionId: session.id, note });
          setMessage("备注已保存");
        } catch (e) {
          setMessage(e instanceof Error ? e.message : "保存失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        会话备注{" "}
        <input
          aria-label="会话备注"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="添加便于搜索的短备注"
        />
      </label>
      <button disabled={busy}>保存备注</button>
      <small>
        原始归属：{session.originalProjectName} · 当前：{session.projectName}
      </small>
      <span role="status">{message}</span>
    </form>
  );
}

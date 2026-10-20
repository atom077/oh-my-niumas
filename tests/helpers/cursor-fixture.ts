import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Synthetic data only. Mirrors the metadata schema verified in Cursor 3.25.9. */
export async function cursorFixture(root: string) {
  await mkdir(join(root, "globalStorage"), { recursive: true });
  const path = join(root, "globalStorage", "state.vscdb");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, isSubagent INTEGER, value TEXT);`);
  const put = (key: string, value: unknown) =>
    db
      .prepare("INSERT OR REPLACE INTO cursorDiskKV VALUES (?,?)")
      .run(key, JSON.stringify(value));
  const base = Date.parse("2026-10-19T01:00:00Z");
  function session(id: string, subagent = false) {
    const headers = [
      {
        bubbleId: "user-1",
        grouping: { textPreview: "SECRET_HEADER_PREVIEW" },
      },
      { bubbleId: "assistant-1" },
      { bubbleId: "user-2" },
      { bubbleId: "assistant-2" },
    ];
    db.prepare("INSERT INTO composerHeaders VALUES (?,?,?,?)").run(
      id,
      "workspace",
      subagent ? 1 : 0,
      JSON.stringify({
        name: subagent ? "合成子 Agent" : "Cursor 合成写作",
        workspaceIdentifier: { id: "workspace" },
      }),
    );
    put(`composerData:${id}`, {
      composerId: id,
      fullConversationHeadersOnly: headers,
      workspaceIdentifier: {
        id: "workspace",
        uri: { scheme: "file", path: "/synthetic/http-demo" },
      },
      text: "SECRET_PROMPT",
      conversationMap: { secret: "SECRET_MAP" },
    });
    for (let i = 0; i < 4; i++) {
      const assistant = i % 2 === 1;
      put(`bubbleId:${id}:${headers[i].bubbleId}`, {
        type: assistant ? 2 : 1,
        createdAt: new Date(base + i * 60_000).toISOString(),
        ...(assistant
          ? { startedAtMs: base + i * 60_000, turnDurationMs: 40_000 }
          : {}),
        tokenCount: { inputTokens: 0, outputTokens: 0 },
        text: assistant ? "SECRET_OUTPUT" : "SECRET_INPUT",
        toolResults: ["SECRET_TOOL"],
      });
    }
  }
  session("synthetic-http-session");
  session("synthetic-subagent", true);
  put("composerData:draft", {
    composerId: "draft",
    fullConversationHeadersOnly: [],
  });
  db.close();
  return path;
}

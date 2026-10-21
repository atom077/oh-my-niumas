# Technical guide

[English introduction](../README.md) · [中文介绍](../README_zh.md)

This guide collects setup, implementation, and data contracts previously mixed into the README. Detailed source findings and historical verification notes linked below are primarily in Chinese. Current behavior is based on the implementation as of 2026-10-21; dated research snapshots do not establish support for every upstream version.

## Runtime and setup

- Node.js **24.11+** (`.nvmrc`: `24`); the importer uses built-in `node:sqlite`.
- npm with the committed lockfile: use `npm ci` for a reproducible install.
- macOS is the verified local-import environment. Cursor's default root is macOS-specific; other platforms and historical formats need separate validation.
- The UI is Simplified Chinese. Date windows use **Asia/Shanghai**, not the host's implicit timezone; internal interval arithmetic uses UTC instants.

```sh
nvm install
nvm use
npm ci
npm start
```

`npm start` type-checks and builds the frontend, then starts the local service at **http://127.0.0.1:4317**. Both HTTP and development hot reload bind to loopback.

| Command | Purpose |
| --- | --- |
| `npm start` | Build and serve the application. |
| `npm run dev` | Watch the local server and use Vite middleware / hot reload. |
| `npm run build` | Type-check and produce the frontend in `dist/`. |
| `npm run typecheck` | TypeScript validation without output. |
| `npm test` | Analysis, importer, privacy, and HTTP regression tests. |
| `npm run test:e2e` | Build, start an isolated fixture server on port 4318, and run Playwright. |

Browser tests currently use Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. On another system, update `launchOptions.executablePath` in [playwright.config.ts](../playwright.config.ts) to your installed browser, or remove that override and install Playwright Chromium with `npx playwright install chromium`. This is a test configuration step, not evidence of verified imports on that platform.

### Choosing data

- `http://127.0.0.1:4317/?source=demo` fixes the page to synthetic scenarios.
- `http://127.0.0.1:4317/?source=local` selects local imports.
- The regular home URL checks local availability first. Previously scanned data, including a cache after restart, takes priority. Otherwise it opens the demo and waits for a manual local scan.
- After restart, cached data triggers a read-only refresh to rebuild the in-memory dataset and load current index titles. The cache is the baseline for newly discovered turn counts.
- The initial local date range is the narrowest preset covering the latest activity: today, 7 days, 30 days, or all.

Choose **本机数据** and click **扫描 / 刷新** to import. Optional refresh intervals are 15, 30, or 60 seconds, disabled by default. A new interval starts after the previous scan completes; requests do not overlap. Hidden pages pause scheduling, returning pages restart the timer, and switching to demo disables it. Failures retain the previous successful result. A server scan already in progress may finish even if the browser stops waiting.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4317` | Local HTTP port; development HMR uses this port + 20000. |
| `NIUMAS_LOG_ROOT` | `~/.codex` | Codex root containing `sessions`, `archived_sessions`, and `session_index.jsonl`. |
| `NIUMAS_CURSOR_ROOT` | `~/Library/Application Support/Cursor/User` | Cursor User directory containing local storage databases. |
| `NIUMAS_DB_PATH` | `.local/niumas.sqlite` | Local metadata cache and manual annotations. |

Variables are process configuration. The browser cannot submit arbitrary filesystem paths. A custom `NIUMAS_LOG_ROOT` disables the implicit Cursor root; set `NIUMAS_CURSOR_ROOT` explicitly to import both. This also makes fixture runs independent of real history.

For an isolated demo and local-import test using only repository fixtures:

```sh
NIUMAS_LOG_ROOT="$PWD/fixtures/import-smoke" \
NIUMAS_DB_PATH="$PWD/.local/fixture-demo.sqlite" \
PORT=4319 npm start
```

Then open **http://127.0.0.1:4319/?source=demo**, or select local data and scan the synthetic import fixture. No real Codex or Cursor history is used by this command.

## Architecture

```text
Codex JSONL + title index       Cursor local SQLite metadata
             \                  /
               Read-only adapters
                       |
          Whitelisted events / turn reconstruction
                       |
       Token accounting + intervals + project grouping
                       |
          Local SQLite cache + local annotations
                       |
                  Local HTTP API
                       |
          React dashboard + HTML / ECharts timelines
```

Titles are refreshed from indexes into memory rather than persisted in the cache. Source adapters remain separate from pure analysis and UI code.

| Path | Responsibility |
| --- | --- |
| `app/server.ts` | Local HTTP service, guarded refresh / annotation endpoints, frontend serving. |
| `app/importer.ts` | Codex discovery, normalization, metadata cache, combined local dataset. |
| `app/cursor-importer.ts` | Bounded read-only Cursor SQLite projections and timing inference. |
| `app/display-names.ts`, `app/annotations.ts` | Indexed display names, path redaction, project grouping, local notes. |
| `app/core/` | Data contracts, synthetic demo, interval and token analysis. |
| `app/web/` | Four pages, shared filters, refresh state, three-level and advanced timelines. |
| `fixtures/`, `tests/` | Sanitized findings, synthetic vectors, importer / HTTP / browser checks. |

## Data and metric contracts

### Sources and confidence

Codex discovers `sessions` and `archived_sessions` JSONL files. Titles use the latest valid `session_index.jsonl` record; missing titles display “未命名会话” rather than falling back to prompt content. Projects initially use the session's starting directory basename, with anonymous directory associations and optional manual grouping.

Cursor support was checked against desktop **3.25.9**. It reads selected metadata from `globalStorage/state.vscdb`, `workspaceStorage/*/state.vscdb`, and single-folder workspace metadata. A workspace directory is grouping evidence, not proof of the session's starting cwd. Old `aiService` formats, cloud agents, and every CLI variant are not covered. SQLite uses read-only mode, query-only transactions, and committed WAL visibility; multiple databases do not share a global snapshot.

Sources distinguish **observed**, **inferred**, and **unknown**. Coverage is exposed rather than treating missing records as zero. Unverified fork / sub-agent scopes are excluded to avoid inherited or duplicated usage.

### Cursor timing: current behavior

The latest rule supersedes earlier research notes that displayed Cursor activity points only:

1. Group ordered messages into input-driven turns and keep the maximum eligible `turnDurationMs` as that turn's recorded duration.
2. Propose an interval from the user message's creation time to that time plus recorded duration.
3. Accept it only when its end is within **20 seconds** of the ending message and does not pass the next input.
4. Label the interval and derived timing **inferred**. Its completed state is also inferred and cannot reliably distinguish an interruption.
5. Keep other turns as unknown activity with recorded duration where available; do not draw a located execution bar for them.

Accepted inferred intervals participate in workload, coverage, concurrency, and closed waiting. Cursor tokens are **not rendered**: local `tokenCount` is always zero and `usageData` is empty; real usage exists only in Cursor's cloud billing, which this read-only tool does not access. Token metrics and denominators cover Codex sessions only.

| Field / metric | Meaning |
| --- | --- |
| `workloadMs` | Sum of located execution intervals after window clipping, including accepted Cursor inferences. |
| `coverageMs` | Length of their interval union: wall-clock time with at least one located execution. |
| Average parallelism | `workloadMs / coverageMs`; N/A if coverage is zero. |
| Peak concurrency | Maximum simultaneous located turns, using half-open intervals. |
| `inferredWorkloadMs` | The inferred portion already included in `workloadMs`. |
| `reportedWorkloadMs` | Cursor recorded durations, assigned whole to each turn's input time. |
| `unlocatedReportedMs` | Recorded durations from Cursor turns without an accepted located interval. |
| Mixed headline cumulative time | `workloadMs + unlocatedReportedMs`; accepted inferences are not added twice. |

The mixed headline can have a different attribution basis from the interval metrics. **Average parallelism always uses located workload**, never the mixed headline. Labels and coverage explain partial evidence.

Codex duration is elapsed time between supported task boundaries, including tools and internal waits; it need not equal the desktop application's internal duration field. Conversation span is separate. True input-send times are not established by Codex's delayed user-message records, so exact closed waiting may be N/A. Open waits are not included in closed-wait totals. A historical missing terminal event does not prove a task is still running.

Token accounting keeps source scope, deduplicates repeated reports, handles cumulative baselines and resets, and avoids adding cached input or reasoning subsets twice. The current window policy assigns attributable usage to its reporting event. API billing and subscription charges are not inferred from these totals.

### Timeline behavior

- Daily view counts input activity per project: 15-minute cells for one day, Shanghai dates for multiple days, coalesced for long histories. Density is not duration or efficiency. Known execution without input has its own outline.
- Hourly view separates input points, execution bars, closed waits, and unknown activity. Bars are clipped to the visible hour.
- Turn view preserves original turn numbering and supports seconds-scale zoom. A fragment's span and execution sum stay separate.
- Project execution rows merge intervals for drawing while preserving gaps; waiting rows subtract execution coverage. Visual aggregation does not redefine workload or concurrency.
- Execution bars use source colors and striped dashed styling: Codex blue, Cursor dark, mixed projects gray-blue, interrupted / failed red. Legends and hover text distinguish inference. Closed waits use a subtle dashed track.
- Refresh retains drill-down and selection; changing global filters resets them. Advanced ranges, sliders, Ctrl+wheel, expanded turns, and the aligned concurrency curve remain under **高级区间分析**. Chart zoom never changes the KPI window.

### Local organization

**项目 → 管理本地项目** saves aliases, merges directories, or restores grouping. Restoring the leading directory splits its entire merged group; restoring a member removes only that member. Aliases are limited to 80 characters. Session detail accepts searchable notes up to 500 characters. Empty text clears a label; slash-containing or absolute-path text is rejected. Annotations persist locally and are independent from synthetic demo labels.

## Privacy, caching, and resource limits

The cache contains whitelisted events, anonymous keys, directory basenames, signatures, source timing metadata, and manual annotations. It does not automatically collect raw prompts, tool output, full paths, or indexed titles. Titles are held in memory and recognizable absolute paths in them are redacted. Displayed names, titles, and user-written notes can still be private: use synthetic data for public screenshots and reports.

Codex reuses unchanged-file caches and reparses changed or truncated files within budgets. **This is not byte-offset tailing**; large updated files may have only a bounded prefix reread. Cursor requeries bounded metadata on each refresh. Truncation, skipped entries, exclusions, and unsupported records are surfaced.

| Area | Current bound |
| --- | --- |
| Codex discovery | Up to 1000 files. |
| Codex new reads | Up to 64 MiB per file and 1 GiB per scan; lines over 1 MiB skipped. |
| Title index | Up to 8 MiB; lines over 64 KiB skipped. |
| Cursor discovery | Up to 100 workspace candidate directories, 1000 sessions, 20000 messages. |
| Cursor records | Up to 64 MiB per original JSON value; 128 MiB cumulative original-record budget for projected metadata. |

Source symlinks are skipped or reported. Cursor does not query credentials or load raw message bodies into the application. The API checks local hosts and restricts state-changing requests by origin and JSON format. These controls support a personal localhost app, not a shared internet-facing deployment.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `node:sqlite` unavailable | Run `nvm use`, then confirm Node is at least 24.11. |
| Address already in use | Choose another `PORT` and open the printed URL. |
| No local sessions | Select local data, scan, choose all dates / sources, and check scan details and roots. |
| No Cursor sessions with a custom Codex root | Explicitly set `NIUMAS_CURSOR_ROOT`; the implicit root is disabled. |
| Cursor turns without bars | Check coverage: usage fields or timing evidence may be insufficient. |
| No Codex waiting tracks | Recorded input times may be delayed; exact send times are required. |
| Empty chart | Check filters and the drill-down hour; compare with the fixed demo URL. |
| E2E cannot find Chrome | Adjust the browser configuration described above. |

## Detailed references

| Document | What it covers |
| --- | --- |
| [Product and brand brief](../oh-my-niumas-project/PROJECT.md) | Vision, design explorations, boundaries, original metric definitions. |
| [Domain glossary](../GLOSSARY.md) | Project, Session, Turn, workload, coverage, and waiting. |
| [Codex source findings](log-format-findings.md) | Formats, token channels, timing evidence, and limitations. |
| [Cursor source findings](cursor-log-findings.md) | Version scope, inference checks, and privacy. Read the latest amendment for current timing behavior. |
| [Metric specification](metrics-spec.md) | Formulas, interval boundaries, token rules, current amendments. |
| [UX flows](ux-flows.md) | Page responsibilities and navigation. |
| [Fixtures](../fixtures/README.md) | Sanitized research samples versus fully synthetic data. |
| [Verification record](verification.md) | Historical checks and known limitations. |
| [Application / log comparison](real-session-comparison.md) | Sanitized comparisons, duration discrepancies, scan snapshots. |
| [Design QA](../design-qa.md) | Working screenshot review and visual limitations. |

Implementation specifications and completed tasks remain in `.scratch/`, including [core demo](../.scratch/core-demo/spec.md), [daily use](../.scratch/daily-use/spec.md), [page polish](../.scratch/page-polish/spec.md), [Cursor imports](../.scratch/cursor-sessions/spec.md), [mixed workload](../.scratch/mixed-workload/spec.md), and [layered timeline](../.scratch/layered-timeline/spec.md). These are development records, not promises that every proposal has shipped.

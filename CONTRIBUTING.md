# Contributing

Issues and pull requests in English or Chinese are welcome.

## Start here

Read the [introduction](README.md) and [technical guide](docs/TECHNICAL.md). For parser or metric changes, also read the [metric specification](docs/metrics-spec.md), relevant source findings, and [AGENTS.md](AGENTS.md). Product language follows [GLOSSARY.md](GLOSSARY.md).

For a bug report, include the app commit, Node / OS version, AI tool version, reproduction steps, expected behavior, and coverage / warning labels. Prefer the built-in demo or a small synthetic fixture. Never attach raw session files, a real cache database, private titles, prompts, credentials, or tool output. See [SECURITY.md](SECURITY.md) for vulnerabilities.

## Local development

Use Node.js 24.11+ and `npm ci`. `npm run dev` starts the application on http://127.0.0.1:4317. For isolated imports, use the fixture-only command in the [technical guide](docs/TECHNICAL.md#environment-variables).

Run checks relevant to your change:

```sh
npm test
npm run typecheck
npm run build
# For UI and end-to-end import changes; see browser setup in the technical guide:
npm run test:e2e
```

Keep changes focused and explain the problem, new behavior, validation, and remaining limits. Parser changes should include synthetic evidence for supported fields and edge cases. Preserve source confidence, partial coverage, half-open intervals, and token deduplication. New source adapters need documented version scope and read-only behavior.

Public requests can start as GitHub Issues. Maintainer implementation tasks use the local Markdown tracker under `.scratch/`, following [the tracker convention](docs/agents/issue-tracker.md). Small documentation fixes do not require a new specification.

Use synthetic data for committed screenshots and label design concepts separately from working UI. Update both README languages and the technical guide when behavior changes. Contributions are made under [MIT](LICENSE); preserve third-party notices.

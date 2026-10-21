# Security and privacy

This is a personal localhost application. It reads supported local AI session metadata and stores a local cache. Do not expose it through public hosting or a tunnel as a multi-user service.

Do not report secrets or private conversations in a public issue. Use GitHub's **Security → Report a vulnerability** when available. If private reporting is unavailable, open a minimal issue requesting a private channel without exploit details or sensitive data.

Useful reports identify the affected commit, impact, and reproduction using synthetic inputs. Do not upload source logs, `.local/` databases, credentials, private titles, or screenshots containing them. The current main branch is the maintenance target; there is no formal support schedule for older snapshots.

Read-only imports do not make user-authored titles or notes safe to publish. Review screenshots and exports before sharing. Cache contents, source boundaries, and resource limits are documented in the [technical guide](docs/TECHNICAL.md#privacy-caching-and-resource-limits).

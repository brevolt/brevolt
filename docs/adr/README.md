# Architecture Decision Records

One ADR per decision. Statuses: `Proposed`, `Accepted`, `Superseded by ADR-xxxx`.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-runtime-node-typescript.md) | Runtime: Node 22 LTS + strict TypeScript | Accepted |
| [0002](0002-http-server-fastify.md) | HTTP server: Fastify | Accepted |
| [0003](0003-persistence-sqlite-drizzle.md) | Persistence: SQLite with Drizzle | Accepted |
| [0004](0004-validation-zod.md) | Validation: Zod | Accepted |
| [0005](0005-dashboard-react.md) | Dashboard: React | Accepted |
| [0006](0006-monorepo-layout.md) | Monorepo: pnpm workspaces and folder layout | Accepted |
| [0007](0007-testing-vitest-fast-check-playwright.md) | Testing: Vitest, fast-check, Playwright | Accepted |
| [0008](0008-macos-bridge-swift.md) | macOS bridge: Swift | Accepted (open risks) |
| [0009](0009-license.md) | License: MIT or AGPL-3.0 | **Proposed** (decision pending: @raul) |

## Open risks from the phase 0 spikes (do not block)

- Spike 001 works **with limitations**: see ADR-0008.
- Spike 002 is **pending live verification** (no test OAuth client available): see ADR-0002 and ADR-0004.
- Spike 003 works **with limitations**; real-app and mobile checks pending: see ADR-0006 and ADR-0007.

## Template

```markdown
# ADR-NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR-xxxx
- Date: YYYY-MM-DD
- Spike reports: (links, if any)

## Context
## Decision
## Alternatives considered
- Option: why it was rejected.
## Consequences
(including open risks)
```

# ADR-0006: Monorepo: pnpm workspaces and folder layout

- Status: Accepted
- Date: 2026-11-16
- Spike reports: [003](../spikes/003-obsidian-plugin.md)

## Context

Several deliverables (core, contracts, server, dashboard, plugin, Swift bridge) must evolve together with shared types, one CI, and a mandatory lockfile (R-SEC-13).

## Decision

One public repository using pnpm workspaces. Layout:

```
brevolt/
  packages/core/          # model, normalization, merge, Markdown mapping (pure TS, no I/O)
  packages/contracts/     # Zod schemas, generated OpenAPI, shared JSON fixtures
  apps/server/            # Fastify + SQLite (Drizzle) + adapters (Google)
  apps/dashboard/         # React, served by the server
  apps/obsidian-plugin/   # Obsidian plugin
  apps/bridge-macos/      # Swift app (Xcode, SwiftPM)
  spikes/                 # phase 0 code, never imported by production
  docs/                   # spec, backlog, spikes/ reports, adr/
  deploy/                 # docker-compose.yml, .env.example
```

- `packages/core` depends on nothing but `contracts`; it never touches network or disk.
- `apps/*` depend on `packages/*`, never on each other; `spikes/` is never imported.
- The Swift bridge lives under `apps/bridge-macos` (the issue text mentioned a top-level `bridge/`; `docs/backlog.md` is the source of truth and uses `apps/`).

## Alternatives considered

- npm / yarn workspaces: weaker disk use and dependency strictness than pnpm.
- Nx / Turborepo: extra tooling not needed at this size; can be added later.
- Separate repositories: shared contracts and fixtures would drift.

## Consequences

- Contracts are shared by construction.
- **Open risk (spike 003):** the plugin spike was verified in Node against a shim and a reference model of `processFrontMatter`, not in the real Obsidian app; secret storage on mobile (`app.secretStorage`) is unverified. This affects `apps/obsidian-plugin`, not the layout.
- Spike code has its own `pnpm-lock.yaml`/package files and is excluded from production builds.

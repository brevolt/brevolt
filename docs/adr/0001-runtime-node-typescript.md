# ADR-0001: Runtime: Node 22 LTS + strict TypeScript

- Status: Accepted
- Date: 2026-11-16
- Spike reports: [003](../spikes/003-obsidian-plugin.md) (plugin builds with TypeScript and esbuild)

## Context

Server, core, contracts and Obsidian plugin share one language so the Zod-inferred types are a single source of truth (spec, Proposed stack). Obsidian plugins must be JS/TS.

## Decision

Node.js 22 LTS with TypeScript in `strict` mode across the monorepo; `tsc --noEmit` is a blocking CI job.

## Alternatives considered

- Bun / Deno: smaller ecosystem for SQLite and Fastify tooling, less operational maturity; no gain that justifies the risk.
- Go or Rust for the server: the plugin and dashboard would still need TS, so types and schemas could not be shared.
- Plain JavaScript: no compile-time guarantees for the merge engine, the highest-risk code.

## Consequences

- One toolchain for server, core, dashboard and plugin.
- Node 22 must be upgraded to the next LTS before its end of life.
- Strict mode raises the cost of writing code, accepted for `core` safety.

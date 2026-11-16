# ADR-0005: Dashboard: React

- Status: Accepted
- Date: 2026-11-16
- Spike reports: none

## Context

All decisions (conflicts, merges, deletions) are made in the dashboard, so it is the main user surface. It is built as static files served by the server process.

## Decision

React with TypeScript, built to static assets and served by the Fastify server.

## Alternatives considered

- Server-rendered templates (htmx): simpler, but the decision inbox and diff views are highly interactive.
- Svelte / Vue: good options, but React gives the largest ecosystem and shares tooling with the rest of the TS monorepo.
- Next.js: a separate server runtime is unnecessary; the dashboard is a static SPA.

## Consequences

- No second runtime in production.
- Dashboard visual design is decided separately and is out of scope here.

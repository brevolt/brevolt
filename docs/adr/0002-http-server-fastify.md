# ADR-0002: HTTP server: Fastify

- Status: Accepted
- Date: 2026-11-16
- Spike reports: [002](../spikes/002-google-people.md) (pending live verification)

## Context

The hub exposes a versioned API (`/v1/*`) for the bridge, the plugin and the dashboard, and runs the Google adapter in-process. It needs schema-driven validation, hooks for auth and rate limiting, and static file serving for the dashboard.

## Decision

Fastify, with Zod-based validation (ADR-0004), auth and rate-limiting plugins, and `@fastify/static` for the dashboard.

## Alternatives considered

- Express: no built-in schema validation, slower, weaker TypeScript story.
- Hono: lighter, but less mature plugin ecosystem for rate limiting, security headers and static serving in a Node-only deployment.
- NestJS: heavy framework and decorators for a small API surface.

## Consequences

- Single process serves API and dashboard.
- **Open risk (spike 002):** the Google People adapter was not verified live; its etag (`400 FAILED_PRECONDITION`), `EXPIRED_SYNC_TOKEN` (`400`) and `429` handling is expected from the docs only. Fastify choice does not depend on it; the adapter design may.

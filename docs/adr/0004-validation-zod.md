# ADR-0004: Validation: Zod

- Status: Accepted
- Date: 2026-11-16
- Spike reports: [002](../spikes/002-google-people.md) (pending live verification)

## Context

R-SEC-8 requires strict validation of all input. Server, plugin and bridge contract fixtures must share one definition of each payload.

## Decision

Zod schemas in `packages/contracts` and `packages/core`; TypeScript types are inferred from them, and OpenAPI is generated from them.

## Alternatives considered

- Hand-written TS types: no runtime validation.
- JSON Schema / Ajv: types and schemas drift apart unless generated.
- Valibot / TypeBox: smaller or faster, but a smaller ecosystem and less familiarity; performance is not a bottleneck here.

## Consequences

- A single source of types for server and plugin.
- **Open risk (spike 002):** Google API response shapes were not captured live; schemas for the adapter must be built from anonymized fixtures once spike 002 is verified.

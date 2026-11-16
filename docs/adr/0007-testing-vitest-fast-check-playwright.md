# ADR-0007: Testing: Vitest, fast-check and Playwright

- Status: Accepted
- Date: 2026-11-16
- Spike reports: [003](../spikes/003-obsidian-plugin.md)

## Context

`merge` is the highest-risk logic and must be tested for invariants, not just examples. CI must never touch real Contacts, Google or Obsidian.

## Decision

- Vitest for unit and integration tests (`vitest run` in CI).
- fast-check for property-based tests of `merge` and Markdown mapping invariants (1,000 runs per property in CI), mandatory on every `packages/core` change.
- Playwright for dashboard E2E against the real server with a temporary database.
- External systems are behind interfaces with test doubles. Coverage thresholds: `core` ≥ 95 %, rest ≥ 80 %.
- XCTest/`swift test` for the bridge.

## Alternatives considered

- Jest: slower and needs more configuration for ESM/TypeScript.
- Example-based tests only: miss merge edge cases (ordering, idempotence).
- Cypress: heavier; Playwright covers the browsers needed and parallelism.

## Consequences

- Vitest is already used by spike 003.
- **Open risk (spike 003):** frontmatter behavior comes from a reference model, not the real API. The real-app self-test (6 cases) is still pending; plugin tests must keep a fixture for each documented quirk (comments lost, CRLF, prepended block, invalid YAML).

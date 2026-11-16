# ADR-0003: Persistence: SQLite with Drizzle

- Status: Accepted
- Date: 2026-11-16
- Spike reports: none

## Context

Self-hosted, single-user (or very small) hub with a `change_log`, base snapshots and `external_link` data. Needs transactional writes, easy backup and restore, and versioned migrations.

## Decision

SQLite (single file, WAL mode) accessed through Drizzle ORM with versioned SQL migrations.

## Alternatives considered

- PostgreSQL: operational overhead (extra container, backups) not justified for one user; can be revisited if multi-user is ever needed.
- Prisma: heavier runtime and engine binaries, less control over SQL.
- Raw SQL with a query builder (Kysely): viable, but Drizzle gives schema-as-code and migrations with similar control.

## Consequences

- Backup is a file copy plus integrity check; restore drill is part of phase 2.
- One writer at a time; writes per user are serialized, which also fits Google API quotas.
- Migration to another database would need an adapter layer rewrite.

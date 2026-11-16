# Brevolt

Self-hosted contact hub that keeps Apple Contacts, Google Contacts and Obsidian notes in sync through a single merge engine. See `docs/spec.md` for requirements and `docs/backlog.md` for the plan.

## Layout

See [ADR-0006](docs/adr/0006-monorepo-layout.md). TypeScript packages live in `packages/*` and `apps/*` (pnpm workspace); the Swift bridge lives in `apps/bridge-macos`; `spikes/` is phase 0 code and is never imported.

## Getting started

Requirements: Node.js >= 22 and pnpm 10.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Configuration comes from environment variables; copy `.env.example` to `.env` and fill in values locally. Never commit `.env*` files.

## License

Pending decision (ADR-0009). A `LICENSE` file will be added once it is accepted.

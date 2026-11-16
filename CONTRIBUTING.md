# Contributing

Read `AGENTS.md` first; it holds the hard rules (no secrets, no real personal data, never bypass `merge`).

- Branch from `main`: `feat/BRV-xxx-short-name`, `fix/...`, `chore/...`.
- Conventional Commits, signed. One issue per PR; the PR title cites `BRV-xxx`.
- Before opening a PR: `pnpm lint && pnpm typecheck && pnpm test` must pass.
- Add a changeset (`pnpm changeset`) when a publishable package changes.
- Everything is written in English: docs, code, commits and PRs.

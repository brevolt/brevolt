# Contributing

Read `AGENTS.md` first; it holds the hard rules (no secrets, no real personal data, never bypass `merge`).

- Branch from `main`: `feat/BRV-xxx-short-name`, `fix/...`, `chore/...`.
- Conventional Commits, signed. One issue per PR; the PR title cites `BRV-xxx`.
- Before opening a PR: `pnpm lint && pnpm typecheck && pnpm test` must pass.
- Add a changeset (`pnpm changeset`) when a publishable package changes.
- Everything is written in English: docs, code, commits and PRs.

## CI and repository security

- Blocking jobs on PRs to `main`: `lint`, `typecheck`, `test`, `secrets` (gitleaks, full history), `codeql`, `audit` (`pnpm audit --prod`, high or critical).
- Pre-commit secret scanning: install [pre-commit](https://pre-commit.com) and run `pre-commit install` once; it runs gitleaks with `.gitleaks.toml`.
- Dependencies are updated by Renovate (`renovate.json`); GitHub Actions are pinned by digest.
- Repository settings (protected `main` with required review and signed commits, secret scanning with push protection) are applied by an admin with `scripts/apply-repo-security.sh`.
- Audit exceptions must be documented in the PR that adds them (`pnpm.auditConfig.ignoreCves`).

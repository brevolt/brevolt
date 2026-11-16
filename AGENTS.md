# AGENTS.md

Instructions for AI agents (and humans) working on Brevolt. Read this file before every task.

## Sources of truth

- `docs/spec.md` — what Brevolt is and its requirements (`R-SYNC-*`, `R-BR-*`, `R-OB-*`, `R-SEC-*`).
- `docs/backlog.md` — phases, issues (`BRV-xxx`), acceptance criteria, required tests, Definition of Ready and Definition of Done.
- If an issue and these documents disagree, stop and ask @raul in the issue. Do not guess.

## Hard rules

1. **No secrets, ever.** No API keys, tokens, OAuth client IDs or secrets, certificates, passwords or private URLs in code, config, tests, fixtures, commits or PR text. Configuration comes from environment variables or `*_FILE` secrets. Placeholders only in `.env.example`.
2. **No real personal data.** Never use real contacts. Tests and fixtures use the seeded synthetic generator. Manual testing uses the test Apple ID, test Google account and test vault only.
3. **No personal data in logs.** Phones, emails, names and tokens are redacted at every log level.
4. **Never bypass `merge`.** No code path writes to an external system (Contacts, Google, Obsidian) without going through the merge engine and recording a `change_log` entry.
5. **No silent deletes or auto-merges.** External deletions become `deleted-upstream` proposals; duplicates become merge proposals. Decisions are made only in the dashboard.
6. **One issue per PR.** Stay inside the issue's scope. If you find extra work, propose a new issue instead of doing it.

## Language

- The project is English-only: docs, issues, Multica comments, code, identifiers, comments, commits, branches and PRs.
- Issue and Multica comments are short (2–3 sentences: mention + action + pointer).

## Workflow

- Branch from `main`: `feat/BRV-023-contacts-api`, `fix/BRV-023-...`, `chore/...`, `spike/...`.
- Conventional Commits, signed: `feat(server): add contacts PATCH with If-Match`.
- PR title cites `BRV-xxx`; fill the PR template (issue, requirements covered, how to test, tests added, security/personal-data impact, screenshots for dashboard changes).
- Squash merge only, after Code Reviewer approval and @raul's final validation.

## Before opening a PR

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass locally (and `swift test` for the bridge).
- [ ] Every test listed in the issue exists and passes; coverage thresholds hold (`core` ≥ 95 %, rest ≥ 80 %).
- [ ] `gitleaks detect` finds nothing.
- [ ] Docs updated if the API, configuration or deployment changed.
- [ ] Changeset added if a publishable package changed.

## Tests

- Changes to `packages/core` require property-based tests (fast-check) for the invariants in `docs/backlog.md`.
- Every sync bug is fixed by first adding a failing test that reproduces it to the merge fixture corpus.
- External systems are behind interfaces with test doubles; CI never touches real Contacts, Google or Obsidian.

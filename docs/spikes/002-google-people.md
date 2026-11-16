# Spike 002 — Google People API sync

- Issue: BRV-002. Requirement: R-SYNC-5. Code: `spikes/google-people/`.
- **Result: PENDING live verification.** The test OAuth client and test account were not available to the agent, so nothing below under "Live result" has been executed yet.

## What is ready

- `spike.mjs` covers: OAuth (code + PKCE, loopback), refresh-token exchange, full listing with `requestSyncToken`, incremental listing, `updateContact` with etag, stale etag, bad/expired `syncToken`, bounded quota burst.
- Fixtures are anonymized automatically on save (`fixtures/`).
- No credentials in the repo: `.env*` (except the example), `.tokens.json` and `.sync-state.json` are git-ignored.

## Expected behavior (from Google docs, NOT yet verified)

| Topic | Expectation | Live result |
|---|---|---|
| OAuth | Scope `https://www.googleapis.com/auth/contacts`; `access_type=offline` + `prompt=consent` needed to get a refresh token. Apps in "Testing" mode have refresh tokens that expire after 7 days. | TBD |
| Initial list | `people/me/connections`, `requestSyncToken=true`, `pageSize` max 1000; `nextSyncToken` only on the last page. | TBD |
| Incremental | Same call with `syncToken`; changed contacts returned, deleted ones with `metadata.deleted=true`. | TBD |
| Update | `PATCH {resourceName}:updateContact` with `updatePersonFields`; body must carry the current `etag`. | TBD |
| Stale etag | Expected `400 FAILED_PRECONDITION` (etag mismatch). Handling: re-read, re-merge, retry. | TBD |
| Expired syncToken | Expires after ~7 days; expected `400` with reason `EXPIRED_SYNC_TOKEN`. Handling: full resync, dedupe by `resourceName`. | TBD |
| Quota | Per-user and per-project per-minute limits; expected `429 RESOURCE_EXHAUSTED`. Handling: exponential backoff with jitter; serialize writes per user. | TBD |

## To close the spike

1. @raul provides the test account's OAuth client (ID/secret) via local `.env`, and completes the browser consent.
2. Run the commands in `spikes/google-people/README.md`; fill the "Live result" column with real status codes and error bodies; review fixtures; set the final result (works / works with limitations / does not work).
3. The expired-token case needs a token older than 7 days: save one from `list` and re-run `expired <token>` later; meanwhile an invalid token gives the closest error.

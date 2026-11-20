# Deployment, backups and restore

## Start

```sh
cp deploy/.env.example deploy/.env      # fill ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
curl http://127.0.0.1:3000/healthz      # {"status":"ok"}
```

- Image: minimal Alpine base, user `node` (non-root), read-only root file system, all capabilities dropped. Only `/data` (database) and `/backups` (backup service) are writable volumes, plus a `/tmp` tmpfs.
- The port is bound to `127.0.0.1`; expose it only through Tailscale or a reverse proxy.
- Version: `/healthz` and the startup log report `version`. Release images carry their `X.Y.Z` (baked in by the Release workflow); any other build, such as staging built from `main`, reports `dev`. The compose files use `BREVOLT_VERSION` only to choose the image, so it never overrides the version inside the container.
- Secrets come from `deploy/.env` (never committed). Do not put them in the image.

## Backups

- The `backup` service writes `brevolt-YYYYMMDDTHHMMSSZ.db` (SQLite `VACUUM INTO`, consistent with WAL) to the `brevolt-backups` volume on start and every `BACKUP_INTERVAL_HOURS` (24).
- Files older than `BACKUP_RETENTION_DAYS` (30) are deleted. Only files with that name pattern are touched.
- The server also makes a copy next to the database before applying any migration.
- Manual backup: `docker compose -f deploy/docker-compose.yml run --rm backup node dist/backup-cli.js --once`.

## Restore

1. Stop the server and backup service: `docker compose -f deploy/docker-compose.yml stop server backup`.
2. Pick a backup: `docker compose -f deploy/docker-compose.yml run --rm --no-deps --entrypoint ls backup /backups`.
3. Keep the current database in case the restore is wrong, then copy the backup over it (the service user is uid 1000):
   ```sh
   docker compose -f deploy/docker-compose.yml run --rm --no-deps --entrypoint sh backup -c \
     'mv /data/brevolt.db /data/brevolt.db.before-restore; rm -f /data/brevolt.db-wal /data/brevolt.db-shm; cp /backups/<FILE>.db /data/brevolt.db'
   ```
4. Start again: `docker compose -f deploy/docker-compose.yml up -d` and check `/healthz`.
5. Verify the data in the dashboard. Once satisfied, delete `brevolt.db.before-restore`.

The `ENCRYPTION_KEY` must be the same one used when the backup was taken; without it, stored tokens cannot be decrypted.

## Release

Pushing a `v*` tag runs `.github/workflows/release.yml`: it builds and pushes `ghcr.io/<owner>/brevolt` (`X.Y.Z`, `X.Y`, `latest`), signs the image with cosign (keyless, GitHub OIDC), and attaches an SPDX SBOM as a signed attestation (also uploaded as a workflow artifact). Verify with:

```sh
cosign verify ghcr.io/<owner>/brevolt:<version> \
  --certificate-identity-regexp 'https://github.com/<owner>/brevolt/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Cut a release

Releases mark versions and publish images for self-hosting (`deploy/docker-compose.yml`) and for [Production](#production). They do not deploy anything: production moves only when `BREVOLT_VERSION` changes in Dokploy.

Run `pnpm release X.Y.Z` from an up-to-date, clean `main` (`pnpm release X.Y.Z --dry-run` runs the checks only). `scripts/release.sh`:

1. Checks the version is newer than the last tag and that CI passed on `HEAD`.
2. Runs `pnpm install --frozen-lockfile`, `lint`, `format`, `typecheck` and `test`.
3. Sets `version` in the root `package.json`, commits `chore(release): vX.Y.Z`, tags `vX.Y.Z` and pushes both atomically (the push to `main` also redeploys staging).
4. Waits for the Release workflow, which builds, pushes, signs and attests the image. The image is never built locally: it would be unsigned and built for the laptop's CPU architecture.
5. Creates the GitHub release (pre-release while the version is `0.x`) and verifies the signature if `cosign` is installed.

To verify an image by hand (signature and SBOM attestation):

```sh
cosign verify ghcr.io/brevolt/brevolt:X.Y.Z \
  --certificate-identity-regexp '^https://github.com/brevolt/brevolt/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify-attestation --type spdxjson ghcr.io/brevolt/brevolt:X.Y.Z \
  --certificate-identity-regexp '^https://github.com/brevolt/brevolt/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Environments

Two Compose services run on the same Dokploy server, each with its own volumes, `ENCRYPTION_KEY`, Google OAuth client and admin password. Nothing is shared between them.

| | Staging | Production |
|---|---|---|
| URL | `https://staging.brevolt.app` | Private host, set only in Dokploy (`<prod-host>` below) |
| Source | Built from `main` on every push | Published image `ghcr.io/brevolt/brevolt:X.Y.Z` |
| Compose Path | `./deploy/docker-compose.dokploy.yml` | `./deploy/docker-compose.dokploy-release.yml` |
| Auto-deploy | On | **Off** |
| Data | Test Apple ID, test Google account and test vault only | Real contacts |
| Upgrade | Push to `main` | `pnpm release X.Y.Z`, then change `BREVOLT_VERSION` and redeploy |

- Never put real contacts in staging: it deploys every push to `main` without waiting for CI.
- Clients (macOS bridge, Obsidian plugin) are registered per environment; a staging client token does not work in production and vice versa.
- Keep the three compose files in sync when changing the stack (hardening, healthcheck, volumes, environment). Intended differences: `deploy/docker-compose.yml` (self-hosting, CI smoke test) binds a host port; `docker-compose.dokploy.yml` builds from source; `docker-compose.dokploy-release.yml` pulls a pinned image and has no fixed project `name:`.

## Staging

Staging follows `main`: on every push, Dokploy's auto-deploy pulls `main`, builds `deploy/Dockerfile` on the server and restarts the stack.

- Staging does not wait for CI. A push with failing tests or a vulnerable dependency is deployed anyway; only a failed build stops it (Dokploy then keeps the running containers). Check CI after every push and `git revert` if it fails.

### Setup

1. DNS: `A` record (or `CNAME`) `staging.brevolt.app` pointing to the Dokploy server.
2. In Dokploy create a Compose service (e.g. project `brevolt-staging`), source **Git**, repository `brevolt/brevolt`, branch `main`, **Compose Path** `./deploy/docker-compose.dokploy.yml`. Turn **on** auto-deploy on Git push.
3. **Domains** tab: service `server`, port `3000`, host `staging.brevolt.app`, HTTPS on, certificate Let's Encrypt.
4. **Environment** tab: same variables as [Production](#production) except `BREVOLT_VERSION` (not used: the image is built from source), with `PUBLIC_URL=https://staging.brevolt.app` and its own `ENCRYPTION_KEY`. Do not set `BREVOLT_PORT`.
5. Deploy. The log must show a build of `deploy/Dockerfile`. `server` turns `healthy` and then `backup` starts.

## Production

Production runs a published, signed release pinned by `BREVOLT_VERSION`. It only changes when that variable changes and the service is redeployed; pushes to `main` do not touch it. Its host name is private: it lives in DNS and in the Dokploy Domains/Environment tabs only, never in the repository, issues or PRs.

### Prerequisites

- The `ghcr.io/brevolt/brevolt` package is **public** (GitHub → Packages → brevolt → Package settings → Change visibility), so Dokploy pulls it without registry credentials. The image holds no secrets; all configuration comes from the environment.
- At least one release exists (`pnpm release X.Y.Z`, see [Cut a release](#cut-a-release)).

### Setup

1. DNS: `A` record (or `CNAME`) for `<prod-host>` pointing to the Dokploy server.
2. In Dokploy create a Compose service in its own project (e.g. `brevolt-prod`), source **Git**, repository `brevolt/brevolt`, branch `main`, **Compose Path** `./deploy/docker-compose.dokploy-release.yml`. Leave auto-deploy **off**.
3. **Domains** tab: service `server`, port `3000`, host `<prod-host>`, HTTPS on, certificate Let's Encrypt.
4. **Environment** tab (placeholders; never commit real values):

   ```sh
   BREVOLT_VERSION=<X.Y.Z>
   PUBLIC_URL=https://<prod-host>
   ENCRYPTION_KEY=<new value from: openssl rand -base64 32>
   GOOGLE_CLIENT_ID=<google-oauth-client-id>
   GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
   ADMIN_PASSWORD=<strong-password-min-12-chars>
   ```

   - `BREVOLT_VERSION` is required; the deploy fails without it. Use an exact `X.Y.Z`, never `latest` or `X.Y`.
   - `ENCRYPTION_KEY` must be generated for production. Never reuse staging's. Store it in a password manager: without it, backups cannot be decrypted.
   - `ADMIN_PASSWORD` is read only on the first startup (when no admin exists). After the first login works, delete it from the Environment tab and redeploy.
   - Optional: `LOG_LEVEL`, `BACKUP_INTERVAL_HOURS`, `BACKUP_RETENTION_DAYS`.
5. Deploy. The log must show a pull of `ghcr.io/brevolt/brevolt:<X.Y.Z>` (no build). `server` turns `healthy` and then `backup` starts.
6. Check `curl https://<prod-host>/healthz` (`{"status":"ok"}`) and log in as admin. Then remove `ADMIN_PASSWORD` and redeploy.

### Upgrade

1. Cut the release from `main` (`pnpm release X.Y.Z`) and let staging run it for a while.
2. Check the latest backup is recent (see [Production backups](#production-backups)).
3. In Dokploy, set `BREVOLT_VERSION=X.Y.Z` and **Redeploy**. Migrations make a copy of the database before running.
4. Check `/healthz` reports the new `version` and check the dashboard.

Dokploy reads the compose file from the current `main` on every redeploy, not from the release tag. Keep `docker-compose.dokploy-release.yml` compatible with the published versions still in use (e.g. a new required variable must be added to the Environment tab before redeploying).

### Rollback

Set `BREVOLT_VERSION` back to the previous version and redeploy. If the bad version applied a migration, restore the pre-migration copy or the latest backup first (see [Restore](#restore)), since an older version may not read the migrated database.

### Production backups

- The `backup` service writes `brevolt-YYYYMMDDTHHMMSSZ.db` to the `brevolt-backups` volume (same Docker host) on start and every 24 h; 30 days are kept (see [Backups](#backups)).
- Check it runs: in Dokploy open the `backup` container logs and look for a recent backup line, and check that the container is `running`. List files from the Dokploy terminal of `backup`: `ls -l /backups`. The newest file must be less than 24 h old.
- These are not offsite backups. Restore with the steps in [Restore](#restore) (in Dokploy, stop `server` and `backup`, run the commands from the `backup` container terminal, start again).

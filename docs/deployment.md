# Deployment, backups and restore

## Start

```sh
cp deploy/.env.example deploy/.env      # fill ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
curl http://127.0.0.1:3000/healthz      # {"status":"ok"}
```

- Image: minimal Alpine base, user `node` (non-root), read-only root file system, all capabilities dropped. Only `/data` (database) and `/backups` (backup service) are writable volumes, plus a `/tmp` tmpfs.
- The port is bound to `127.0.0.1`; expose it only through Tailscale or a reverse proxy.
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

Releases mark versions and publish images for self-hosting (`deploy/docker-compose.yml`). They do not deploy anything: production builds `main` (see [Production](#production)).

Run `pnpm release X.Y.Z` from an up-to-date, clean `main` (`pnpm release X.Y.Z --dry-run` runs the checks only). `scripts/release.sh`:

1. Checks the version is newer than the last tag and that CI passed on `HEAD`.
2. Runs `pnpm install --frozen-lockfile`, `lint`, `format`, `typecheck` and `test`.
3. Sets `version` in the root `package.json`, commits `chore(release): vX.Y.Z`, tags `vX.Y.Z` and pushes both atomically (the push to `main` also deploys production, with the same code).
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

## Dokploy

Use `deploy/docker-compose.dokploy.yml`. It is the same stack as `deploy/docker-compose.yml` (same hardening, healthcheck and volumes) but with no host port binding: `server` only does `expose: 3000` and Traefik routes to it.

1. Create a service of type **Compose**, source **Git**, repository `brevolt/brevolt`, branch `main`.
2. **Compose Path**: `./deploy/docker-compose.dokploy.yml`. Dokploy builds `deploy/Dockerfile` from the checked-out branch; no published image and no version variable are used.
3. **Environment** tab. Required: `ENCRYPTION_KEY` (`openssl rand -base64 32`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Optional: `ADMIN_PASSWORD` (initial dashboard admin, min 12 chars; read only on first startup), `PUBLIC_URL`, `LOG_LEVEL`, `BACKUP_INTERVAL_HOURS`, `BACKUP_RETENTION_DAYS`. Do not set `BREVOLT_PORT`; it is not used here.
4. **Domains** tab: service `server`, port `3000`, your host, HTTPS on (Let's Encrypt).
5. Set `PUBLIC_URL` to that public URL (e.g. `https://brevolt.example.com`).
6. Deploy. `server` becomes `healthy` via `/healthz`; `backup` starts after it. The Google OAuth flow is not implemented yet, so there is no redirect URI to register.

- Volumes `brevolt-data` (`/data`) and `brevolt-backups` (`/backups`) are named volumes, so they survive redeploys. Do not run "Clean volumes" / delete the service unless you want to drop the data.
- Keep both compose files in sync when changing the stack. The one intended difference: `deploy/docker-compose.yml` (self-hosting, CI smoke test) pulls a released image (`BREVOLT_VERSION`); the Dokploy file builds from source.

## Production

Production follows `main`: `https://dashboard.brevolt.app` runs whatever `main` builds to. When every CI job passes on a push to `main`, the `deploy` job calls the Dokploy deploy webhook; Dokploy pulls `main`, builds `deploy/Dockerfile` on the server and restarts the stack. No image is published and there is no staging step.

- Known gap: Dokploy builds the head of `main` at the time of the webhook. If another commit lands while CI runs, that newer commit is deployed before its own CI finishes.

### Setup

1. DNS: `A` record (or `CNAME`) `dashboard.brevolt.app` pointing to the Dokploy server.
2. In Dokploy create a Project/Compose service (e.g. project `brevolt-prod`), source **Git**, repository `brevolt/brevolt`, branch `main`, **Compose Path** `./deploy/docker-compose.dokploy.yml`. Turn **off** Dokploy's auto-deploy on Git push: it would deploy code that has not passed CI. CI triggers the deploy instead (step 5).
3. **Domains** tab: service `server`, port `3000`, host `dashboard.brevolt.app`, HTTPS on, certificate Let's Encrypt.
4. **Environment** tab (example with placeholders; never commit real values):

   ```sh
   PUBLIC_URL=https://dashboard.brevolt.app
   ENCRYPTION_KEY=<new value from: openssl rand -base64 32>
   GOOGLE_CLIENT_ID=<google-oauth-client-id>
   GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
   ADMIN_PASSWORD=<strong-password-min-12-chars>
   ```

   - `ENCRYPTION_KEY` must be generated for production. Never reuse another environment's. Store it in a password manager: without it, backups cannot be decrypted.
   - `ADMIN_PASSWORD` is read only on the first startup (when no admin exists). After the first login works, delete it from the Environment tab and redeploy.
5. Copy the compose service's deploy webhook URL from Dokploy and store it as the GitHub repository secret `DOKPLOY_DEPLOY_WEBHOOK`. Without it, the `deploy` job fails and nothing is deployed.
6. Deploy. The log must show a build of `deploy/Dockerfile`. `server` turns `healthy` and then `backup` starts.
7. Check `curl https://dashboard.brevolt.app/healthz` (`{"status":"ok"}`), log in as admin, create a contact. Then remove `ADMIN_PASSWORD` and redeploy.

### Backups

- The `backup` service writes `brevolt-YYYYMMDDTHHMMSSZ.db` to the `brevolt-backups` volume (same Docker host as production) on start and every 24 h; 30 days are kept (see [Backups](#backups)).
- Check it runs: in Dokploy open the `backup` container logs and look for a recent backup line, and check that the container is `running`. List files from the Dokploy terminal of `backup`: `ls -l /backups`. The newest file must be less than 24 h old.
- These are not offsite backups. Restore with the steps in [Restore](#restore) (in Dokploy, stop `server` and `backup`, run the commands from the `backup` container terminal, start again).

### Update and rollback

- Update: merge to `main`. CI passes, then Dokploy builds and deploys. Migrations make a copy of the database before running.
- Rollback: `git revert` the bad commit on `main`; it ships the same way. If the bad version applied a migration, restore the pre-migration copy or latest backup first (see [Restore](#restore)), since an older version may not read the migrated database.

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

Pushing a `v*` tag runs `.github/workflows/release.yml`: it builds and pushes `ghcr.io/<owner>/brevolt`, signs the image with cosign (keyless, GitHub OIDC), and attaches an SPDX SBOM as a signed attestation (also uploaded as a workflow artifact). Verify with:

```sh
cosign verify ghcr.io/<owner>/brevolt:<version> \
  --certificate-identity-regexp 'https://github.com/<owner>/brevolt/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Staging

Staging runs the published image, never a local build: `https://staging.brevolt.app`, deployed from `ghcr.io/brevolt/brevolt:0.2.0` (tag `v0.2.0`). The package is public.

1. Cut a release: `git tag vX.Y.Z && git push origin vX.Y.Z`, wait for the Release workflow, then `gh release create vX.Y.Z`.
2. Verify the image (signature and SBOM attestation):

```sh
cosign verify ghcr.io/brevolt/brevolt:X.Y.Z \
  --certificate-identity-regexp '^https://github.com/brevolt/brevolt/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify-attestation --type spdxjson ghcr.io/brevolt/brevolt:X.Y.Z \
  --certificate-identity-regexp '^https://github.com/brevolt/brevolt/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

3. In Dokploy, set `BREVOLT_VERSION=X.Y.Z` in the Environment tab and redeploy (see [Dokploy](#dokploy)). The deploy log must show a pull, not a build.
4. Check `curl https://staging.brevolt.app/healthz`, then log in to the dashboard and create a contact.

## Dokploy

Use `deploy/docker-compose.dokploy.yml`. It is the same stack as `deploy/docker-compose.yml` (same hardening, healthcheck and volumes) but with no host port binding: `server` only does `expose: 3000` and Traefik routes to it.

1. Create a service of type **Compose**, source **Git**, repository `brevolt/brevolt`, branch `main`.
2. **Compose Path**: `./deploy/docker-compose.dokploy.yml` (it pulls the published image; there is no `build:`, so set `BREVOLT_VERSION` to a released tag).
3. **Environment** tab. Required: `ENCRYPTION_KEY` (`openssl rand -base64 32`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Optional: `ADMIN_PASSWORD` (initial dashboard admin, min 12 chars; read only on first startup), `PUBLIC_URL`, `BREVOLT_VERSION`, `LOG_LEVEL`, `BACKUP_INTERVAL_HOURS`, `BACKUP_RETENTION_DAYS`. Do not set `BREVOLT_PORT`; it is not used here.
4. **Domains** tab: service `server`, port `3000`, your host, HTTPS on (Let's Encrypt).
5. Set `PUBLIC_URL` to that public URL (e.g. `https://brevolt.example.com`).
6. Deploy. The Google OAuth flow is not implemented yet, so there is no redirect URI to register.
7. Deploy. `server` becomes `healthy` via `/healthz`; `backup` starts after it.

- Volumes `brevolt-data` (`/data`) and `brevolt-backups` (`/backups`) are named volumes, so they survive redeploys. Do not run "Clean volumes" / delete the service unless you want to drop the data.
- Keep both compose files in sync when changing the stack.

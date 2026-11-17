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

Pushing a `v*` tag runs `.github/workflows/release.yml`: it builds and pushes `ghcr.io/<owner>/brevolt`, signs the image with cosign (keyless, GitHub OIDC), and attaches an SPDX SBOM as a signed attestation and as a release asset. Verify with:

```sh
cosign verify ghcr.io/<owner>/brevolt:<version> \
  --certificate-identity-regexp 'https://github.com/<owner>/brevolt/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

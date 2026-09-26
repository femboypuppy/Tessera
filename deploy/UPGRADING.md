# Upgrading Tessera

Tessera follows [semantic versioning](https://semver.org). Upgrades within a major version are
drop-in: the server migrates its database on startup, and older desktop apps and browsers keep
syncing with a newer server. Read the release notes before a major version.

## Docker Compose

1. **Back up first**: `deploy/backup/backup.sh`.
2. **Read the release notes** of every version between yours and the new one
   (<https://github.com/femboypuppy/Tessera-Notes/releases>).
3. **Change the version** in `.env` (pin releases instead of `latest`, so upgrades happen when you
   decide):
   ```bash
   TESSERA_VERSION=0.2.0
   ```
4. **Pull and restart**:
   ```bash
   docker compose pull
   docker compose --profile https up -d   # or without --profile if you don't use Caddy
   ```
5. **Check**: `docker compose ps` shows `healthy`; `docker compose logs tessera` shows the
   migration if there was one.

Refresh the Compose files themselves when the release notes say so (new settings appear in
`.env.example`).

## Rolling back

Database migrations only go forward, so rolling back means restoring the backup you took in
step 1:

```bash
# .env: TESSERA_VERSION=<the previous version>
docker compose pull
deploy/backup/restore.sh backups/tessera-<before-the-upgrade>.tar.gz
```

Edits made after the upgrade are not lost for good: they are still on the devices that made
them and sync back up once the server is running again.

## Fly.io, Railway, Render

- **Fly.io**: change the image tag in `deploy/fly/Dockerfile` (`FROM …:0.2.0`) and run
  `fly deploy`. Take a volume snapshot first: `fly volumes snapshots create <volume-id>`.
- **Railway**: change the image tag (or redeploy from the new Git tag). Volumes keep their data.
- **Render**: change the image tag in the service settings (or `render.yaml`) and deploy. Render
  takes daily disk snapshots; take a manual one before a major version.

## Desktop app

The desktop app updates itself from GitHub Releases (Settings → Desktop → Updates). Its
workspace folders carry a format version: a newer app opens older folders (and upgrades them in
place); an older app refuses a folder written by a newer format instead of damaging it.

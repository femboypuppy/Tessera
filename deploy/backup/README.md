# Back up and restore

Everything a Tessera server knows lives in its data volume (`/data`): the database with every
workspace's history, and the attachments. Back that up and you can rebuild the server anywhere.

Your notes also live on the devices that use them (the desktop app's workspace folders, the
browser's storage), so a lost server is recoverable from a device too. Backups make it painless.

## Nightly backups with cron

`backup.sh` archives the data volume into a dated `.tar.gz` and keeps the newest 14:

```bash
cd /opt/tessera
deploy/backup/backup.sh /var/backups/tessera
```

It stops the `tessera` container for a few seconds while it copies, so the database files are
consistent; clients keep working offline and sync as soon as it's back. Schedule it:

```bash
crontab -e
# 03:15 every night:
15 3 * * * cd /opt/tessera && KEEP=14 deploy/backup/backup.sh /var/backups/tessera >> /var/log/tessera-backup.log 2>&1
```

Options (environment variables): `KEEP` (how many archives to keep, default 14), `SERVICE`
(default `tessera`), `COMPOSE_DIR` (the folder with `docker-compose.yml`, default the repository
root this script is in), and `MODE`:

- `MODE=volume` (default): archive the whole volume with the container stopped. Works with every
  version of the server.
- `MODE=online`: no downtime; asks the running server for a consistent snapshot
  (`tessera-server backup`, the SQLite backup API plus attachments).

## Keep a copy elsewhere

A backup on the same disk doesn't survive the disk. Copy the folder off the machine, for example
with [restic](https://restic.net) or [rclone](https://rclone.org):

```bash
# after backup.sh in the same cron line:
rclone copy /var/backups/tessera remote:tessera-backups --max-age 48h
```

## Restore

```bash
cd /opt/tessera
deploy/backup/restore.sh /var/backups/tessera/tessera-20260923T031500Z.tar.gz
```

It stops the service, moves the current data aside inside the volume
(`/data/.before-restore-<time>`, delete it once you're happy), unpacks the backup and starts the
service again. Add `YES=1` to skip the confirmation, and `MODE=online` for an archive made with
`MODE=online`.

Restoring onto a new machine: install Tessera with the same `docker-compose.yml`, run
`docker compose up -d` once (to create the volume), then `restore.sh`.

## Without the scripts

The data volume is plain files. With the container stopped, any tool can copy it:

```bash
docker compose stop tessera
docker run --rm --volumes-from "$(docker compose ps -aq tessera)" -v "$PWD:/backup" alpine:3.22 \
  tar -czf /backup/tessera.tar.gz -C /data .
docker compose start tessera
```

On Fly.io, Railway and Render, use the platform's volume snapshots (see their guides) or run
`tessera-server backup` in the service's shell and download the file.

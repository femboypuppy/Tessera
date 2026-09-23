# Backups and restore

Your server holds everyone's work. Back it up automatically, keep a copy somewhere else, and try a
restore once so you know it works.

## What to back up

Everything lives in the data directory (`/data` in the container): the SQLite database and the
attachments. Nothing else needs saving; configuration is in your `.env` file (keep a copy of that
too).

## With the built-in command (recommended)

`tessera-server backup` writes one file with a consistent copy of the database and every
attachment, while the server keeps running:

```bash
docker exec tessera tessera-server backup /data/backups/tessera-$(date +%F).backup
```

Then copy the file off the machine (to another server, object storage, or your laptop).

### Every night with cron

On the Docker host, `crontab -e` and add:

```txt
# 03:15 every night: back up, then keep the 14 newest backups.
15 3 * * * docker exec tessera tessera-server backup /data/backups/tessera-$(date +\%F).backup && docker exec tessera sh -c 'ls -1t /data/backups/*.backup | tail -n +15 | xargs -r rm --'
```

Copy `/data/backups` somewhere else afterwards, for example with `rclone` or `restic`.

## Restore

1. Copy the backup file out of the data volume (for example into `./backups` next to
   `docker-compose.yml`), then stop the server: `docker compose down`.
2. Start from an empty data volume: remove the old one, or keep it and point the compose file at
   a new volume name.
3. Restore, then start the server:

```bash
docker compose run --rm -v "$PWD/backups:/backups" tessera tessera-server restore /backups/tessera-2026-09-23.backup
docker compose up -d
```

Clients reconnect on their own. Edits people made while the server was down are still on their
devices, and sync as soon as it's back.

## Volume snapshots

If you snapshot volumes (ZFS, LVM, your cloud provider), stop the container first or use the
built-in command: copying a live SQLite file can capture a half-written state.

## Client-side backups

Every user can also export a full **JSON backup** of a workspace from the app. See
[Import and export](../guide/import-export#backups).

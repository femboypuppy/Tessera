#!/usr/bin/env bash
# Backs up a Tessera server run with docker-compose.yml.
#
#   deploy/backup/backup.sh [backup-dir]          # default: ./backups next to docker-compose.yml
#   KEEP=30 deploy/backup/backup.sh /var/backups/tessera
#   MODE=online deploy/backup/backup.sh           # no downtime, through `tessera-server backup`
#
# MODE=volume (default) stops the tessera service for a few seconds and archives the whole data
# volume (database and attachments): always consistent, works with every server version.
# Clients keep working offline meanwhile and sync when it's back.
# MODE=online asks the running server for a consistent backup (SQLite backup API + attachments).
#
# Keeps the newest $KEEP archives (default 14). Cron example (03:15 every night):
#   15 3 * * * cd /opt/tessera && deploy/backup/backup.sh /var/backups/tessera >> /var/log/tessera-backup.log 2>&1
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose_dir="${COMPOSE_DIR:-$(cd "$here/../.." && pwd)}"
backup_dir="${1:-${BACKUP_DIR:-$compose_dir/backups}}"
keep="${KEEP:-14}"
mode="${MODE:-volume}"
service="${SERVICE:-tessera}"
helper_image="${HELPER_IMAGE:-alpine:3.22}"

mkdir -p "$backup_dir"
backup_dir="$(cd "$backup_dir" && pwd)"
# The path Docker mounts (Git Bash on Windows needs C:/… there; tar on the host does not).
mount_dir="$backup_dir"
command -v cygpath >/dev/null 2>&1 && mount_dir="$(cygpath -m "$backup_dir")"
cd "$compose_dir"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="tessera-$stamp.tar.gz"
container="$(docker compose ps --all --quiet "$service")"
if [ -z "$container" ]; then
  echo "No '$service' container here ($compose_dir). Start Tessera first." >&2
  exit 1
fi

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

case "$mode" in
  online)
    log "Online backup through the server…"
    # Written into the data volume first (the container's root filesystem is read-only).
    docker compose exec -T "$service" tessera-server backup "/data/.backup-$name"
    docker compose cp "$service:/data/.backup-$name" "$backup_dir/$name"
    docker compose exec -T "$service" rm -f "/data/.backup-$name"
    ;;
  volume)
    was_running="$(docker inspect --format '{{.State.Running}}' "$container")"
    if [ "$was_running" = "true" ]; then
      log "Stopping $service for a consistent snapshot…"
      docker compose stop "$service" >/dev/null
      trap 'log "Starting $service again"; docker compose start "$service" >/dev/null' EXIT
    fi
    log "Archiving the data volume…"
    docker run --rm --volumes-from "$container" -v "$mount_dir:/backup" "$helper_image" \
      tar -czf "/backup/$name" -C /data --exclude './.before-restore-*' --exclude './.backup-*' .
    ;;
  *)
    echo "MODE must be 'volume' or 'online'" >&2
    exit 2
    ;;
esac

# Verify the archive before pruning older ones.
if ! tar -tzf "$backup_dir/$name" >/dev/null; then
  echo "The new backup $backup_dir/$name is unreadable; older backups were kept." >&2
  exit 1
fi
size="$(du -h "$backup_dir/$name" | cut -f1)"
log "Backup written: $backup_dir/$name ($size)"

# Keep the newest $keep backups.
mapfile -t old < <(ls -1t "$backup_dir"/tessera-*.tar.gz 2>/dev/null | tail -n +"$((keep + 1))")
for file in "${old[@]}"; do
  rm -f -- "$file"
  log "Removed old backup $file"
done

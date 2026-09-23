#!/usr/bin/env bash
# Restores a Tessera backup made by backup.sh into the data volume.
#
#   deploy/backup/restore.sh backups/tessera-20260923T031500Z.tar.gz
#   MODE=online deploy/backup/restore.sh backups/tessera-….tar.gz   # a MODE=online backup
#
# It stops the service, moves the current data aside inside the volume (/data/.before-restore-*,
# delete it once you're happy), restores the archive, and starts the service again. Asks for
# confirmation unless YES=1.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose_dir="${COMPOSE_DIR:-$(cd "$here/../.." && pwd)}"
service="${SERVICE:-tessera}"
mode="${MODE:-volume}"
helper_image="${HELPER_IMAGE:-alpine:3.22}"

archive="${1:-}"
if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "Usage: $0 <backup.tar.gz>" >&2
  exit 2
fi
archive_dir="$(cd "$(dirname "$archive")" && pwd)"
# The path Docker mounts (Git Bash on Windows needs C:/… there; tar on the host does not).
mount_dir="$archive_dir"
command -v cygpath >/dev/null 2>&1 && mount_dir="$(cygpath -m "$archive_dir")"
archive_name="$(basename "$archive")"
cd "$compose_dir"

container="$(docker compose ps --all --quiet "$service")"
if [ -z "$container" ]; then
  echo "No '$service' container here ($compose_dir). Run 'docker compose up -d' once first." >&2
  exit 1
fi
tar -tzf "$archive_dir/$archive_name" >/dev/null || {
  echo "$archive is not a readable backup." >&2
  exit 1
}

if [ "${YES:-0}" != "1" ]; then
  printf 'Replace the data of %s with %s? [y/N] ' "$service" "$archive_name"
  read -r answer
  case "$answer" in y | Y | yes) ;; *) echo "Cancelled."; exit 1 ;; esac
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
echo "Stopping $service…"
docker compose stop "$service" >/dev/null
trap 'echo "Starting $service…"; docker compose start "$service" >/dev/null' EXIT

if [ "$mode" = "online" ]; then
  docker run --rm --volumes-from "$container" -v "$mount_dir:/backup:ro" "$helper_image" sh -c "
    set -e
    mkdir -p /data/.before-restore-$stamp
    find /data -mindepth 1 -maxdepth 1 ! -name '.before-restore-*' -exec mv {} /data/.before-restore-$stamp/ \;
    cp /backup/$archive_name /data/.restore.tar.gz
    chown -R 1000:1000 /data"
  docker compose run --rm --no-deps -T "$service" tessera-server restore /data/.restore.tar.gz
  docker run --rm --volumes-from "$container" "$helper_image" rm -f /data/.restore.tar.gz
else
  docker run --rm --volumes-from "$container" -v "$mount_dir:/backup:ro" "$helper_image" sh -c "
    set -e
    mkdir -p /data/.before-restore-$stamp
    find /data -mindepth 1 -maxdepth 1 ! -name '.before-restore-*' -exec mv {} /data/.before-restore-$stamp/ \;
    tar -xzf /backup/$archive_name -C /data --exclude './.before-restore-*'
    chown -R 1000:1000 /data"
fi
echo "Restored $archive_name. The previous data is in /data/.before-restore-$stamp inside the volume."

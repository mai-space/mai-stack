#!/usr/bin/env bash
set -euo pipefail

# Nightly backup for mai-stack: dumps every SQLite database via `sqlite3 .backup`
# inside its own container (safe under WAL, no need to stop services), snapshots
# Redis, and tars everything with a 7-daily + 4-weekly retention policy. Optionally
# pushes the archive off-box if BACKUP_REMOTE is set (rclone if available, else rsync).
#
# Usage:  ./deploy/backup.sh [--dry-run]
# Cron:   0 3 * * *  cd /opt/mai-stack && ./deploy/backup.sh >> /var/log/mai-backup.log 2>&1

COMPOSE_PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/mai-stack}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="${BACKUP_ROOT}/tmp-${STAMP}"
DRY_RUN="${1:-}"

cd "$COMPOSE_PROJECT_DIR"
mkdir -p "$WORK_DIR"

echo "[backup] dumping SQLite databases..."
declare -A DB_DUMPS=(
  [mai-registry]="/data/registry.db"
  [mai-project-mcp]="/data/mai.db"
  [mai-journal]="/data/journal.db"
)
for service in "${!DB_DUMPS[@]}"; do
  db_path="${DB_DUMPS[$service]}"
  out="${WORK_DIR}/${service}.db"
  if docker compose exec -T "$service" sh -c 'command -v sqlite3 >/dev/null 2>&1'; then
    docker compose exec -T "$service" sqlite3 "$db_path" ".backup '/tmp/backup.db'"
    docker compose cp "${service}:/tmp/backup.db" "$out"
    docker compose exec -T "$service" rm -f /tmp/backup.db
  else
    echo "[backup] WARNING: sqlite3 not present in ${service} image — copying the db file directly (may be inconsistent under concurrent load)"
    docker compose cp "${service}:${db_path}" "$out"
  fi
done

echo "[backup] snapshotting Redis..."
docker compose exec -T redis redis-cli SAVE >/dev/null
docker compose cp redis:/data/dump.rdb "${WORK_DIR}/redis-dump.rdb"

ARCHIVE="${BACKUP_ROOT}/mai-stack-${STAMP}.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK_DIR" .
rm -rf "$WORK_DIR"
echo "[backup] archive: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[backup] --dry-run: skipping remote push and retention pruning"
  exit 0
fi

if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "[backup] pushing to ${BACKUP_REMOTE}..."
  if command -v rclone >/dev/null 2>&1; then
    rclone copy "$ARCHIVE" "$BACKUP_REMOTE"
  else
    rsync -a "$ARCHIVE" "$BACKUP_REMOTE"
  fi
fi

echo "[backup] pruning: keep every archive from the last 7 days, plus Mondays for 4 weeks"
find "$BACKUP_ROOT" -maxdepth 1 -name 'mai-stack-*.tar.gz' -mtime +7 -mtime -28 -print | while read -r f; do
  file_date="$(basename "$f" | sed -E 's/mai-stack-([0-9]{8})-.*/\1/')"
  day_of_week="$(date -d "$file_date" +%u 2>/dev/null || echo 0)"
  if [ "$day_of_week" != "1" ]; then
    rm -f "$f"
  fi
done
find "$BACKUP_ROOT" -maxdepth 1 -name 'mai-stack-*.tar.gz' -mtime +28 -delete

echo "[backup] done"

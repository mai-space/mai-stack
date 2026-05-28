# mai-watcher — Runbook

## Purpose

Lightweight file change detector. Mounts workspace volumes read-only and uses chokidar to watch for file saves. On change: debounces (5 s default), sets `project:{id}:dirty = 1` in Redis, publishes a `project.{id}.files_changed` event. Does not trigger reindex itself — that is the dispatcher's decision (pre-task freshness check). No HTTP port.

## Key Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `REDIS_URL` | Yes | — | e.g. `redis://redis:6379` |
| `REGISTRY_URL` | Yes | — | Fetches project workspace paths on startup |
| `DEBOUNCE_MS` | No | `5000` | Debounce window in ms |
| `USE_POLLING` | No | `false` | Set `true` for network/NFS mounts |
| `POLLING_INTERVAL_MS` | No | `2000` | Only used when `USE_POLLING=true` |

## Health Check

No HTTP server. Check container status and logs:

```bash
docker compose ps mai-watcher
docker compose logs mai-watcher --tail 20
```

## Common Failure Modes

**"No projects found" on startup** — mai-registry not yet ready. The watcher retries the registry fetch with backoff. Check `docker compose logs mai-watcher`.

**File changes not detected (Docker bind mount on macOS/Linux)** — chokidar native events may not propagate through certain bind mount configurations.
Fix: set `USE_POLLING=true` in `.env` and rebuild.

**Dirty flag never cleared** — the flag is cleared after a successful reindex triggered by the dispatcher. If the dispatcher is down, dirty flags accumulate. Non-fatal; each flag clears on the next successful reindex.

## Debug Procedures

```bash
# Check dirty flag for a project
docker compose exec redis redis-cli get "project:app-a:dirty"
# → "1" = dirty, nil = clean

# Manually mark dirty for testing
docker compose exec redis redis-cli set "project:app-a:dirty" "1"

# Clear dirty flag manually
docker compose exec redis redis-cli del "project:app-a:dirty"
```

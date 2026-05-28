# mai-registry — Runbook

## Purpose

Source of truth for project metadata. Reads `projects.yml` at startup and upserts into SQLite. Exposes a REST API on port 3459. All other services query this registry for project configuration (workspace path, embedding model, allowed agents, etc.).

## Key Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `3459` | HTTP listen port |
| `DB_PATH` | Yes | — | Path to SQLite file, e.g. `/data/registry.db` |
| `CONFIG_PATH` | No | `/config/projects.yml` | YAML seed file |
| `REDIS_URL` | No | — | Used for future event pub/sub; non-fatal if absent |

## Health Check

```bash
curl -sf http://localhost:3459/health
# → { "status": "ok", "service": "mai-registry" }
```

## Common Failure Modes

**`DB_PATH` directory does not exist** — container exits on startup with a SQLite open error.
Fix: ensure the Docker volume is mounted at the parent directory.

**`projects.yml` malformed** — registry starts with zero projects and logs a YAML parse warning.
Fix: validate YAML syntax; the registry continues running and accepts manual `POST /projects` calls.

**Stale `allowed_agent_ids` after config change** — `CONFIG_PATH` is read only on startup.
Fix: `docker compose restart mai-registry` after editing `projects.yml`.

## Debug Procedures

```bash
# List all projects
curl -s http://localhost:3459/projects | jq '.[].id'

# Inspect a specific project
curl -s http://localhost:3459/projects/app-a | jq .

# Check SQLite directly
docker compose exec mai-registry sh -c \
  "sqlite3 /data/registry.db 'SELECT id, name FROM projects'"

# Force a seed re-run
docker compose restart mai-registry
```

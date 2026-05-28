# mai-project-mcp — Runbook

## Purpose

Task lifecycle engine. Manages Projects and Tasks in SQLite. Handles: task CRUD, agent lease claims with TTL, typed blocker taxonomy (SUBTASK/DECISION/CLARIFICATION/RISK/CAPABILITY/DEPENDENCY), DAG parent-child auto-resume, and typed resolve endpoints. MCP protocol over HTTP on port 3456. Internal only — not exposed to the host.

## Key Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `3456` | HTTP listen port |
| `DB_PATH` | Yes | — | Path to SQLite file, e.g. `/data/mai.db` |
| `REDIS_URL` | No | — | Pub/sub state-change events; non-fatal if absent |
| `HOST` | No | `0.0.0.0` | Bind address |

## Health Check

```bash
docker compose exec mai-project-mcp \
  curl -sf http://localhost:3456/health
# → { "status": "ok", "service": "mai-project-mcp" }
```

## Common Failure Modes

**Migration fails on a fresh volume** — rare; happens on SQLite version mismatch.
Fix: delete the Docker volume and restart. All task data is lost — only do this in dev.

**Lease TTL drift** — tasks remain IN_PROGRESS past their `lease_expires_at`.
The service does not auto-expire leases; agents use `renew_lease` to extend.
Fix: `PUT /tasks/:id { "status": "OPEN" }` to manually reset, or use the Kanban UI.

**`active_tasks` counter drift** — if the dispatcher crashes mid-claim, the Redis counter may be inflated. Symptom: agent always hits the concurrency limit.
Fix: `docker compose exec redis redis-cli set "agent:cursor-claude:active_tasks" 0`

## Debug Procedures

```bash
# List all tasks for a project
docker compose exec mai-project-mcp \
  curl -s http://localhost:3456/projects/app-a/tasks | jq '.[].status'

# Reset a stuck IN_PROGRESS task
docker compose exec mai-project-mcp \
  curl -s -X PUT http://localhost:3456/tasks/<TASK_ID> \
  -H 'Content-Type: application/json' \
  -d '{"status":"OPEN"}'

# Bulk-close all stuck blocked tasks for a project (M5)
curl -s -X POST http://localhost:3461/api/projects/app-a/bulk-close-blocked | jq .
```

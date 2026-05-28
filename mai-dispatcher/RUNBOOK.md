# mai-dispatcher — Runbook

## Purpose

The central brain of mai-stack. Public MCP gateway on port 3460. Responsibilities: agent governance (budget, rate limit, concurrency, project affinity), pre-task freshness check, Context Manifest assembly, blocker routing, and nightly reindex scheduling (M5). Local tools (Cursor, Claude Code, opencode) connect here — not directly to mai-project-mcp.

## Key Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `3460` | HTTP/MCP listen port |
| `REDIS_URL` | Yes | — | Budget ledgers, rate limits, agent state |
| `REGISTRY_URL` | Yes | — | Project config and project list for scheduler |
| `PROJECT_MCP_URL` | Yes | — | Task CRUD |
| `CODE_MCP_URL` | Yes | — | Code search + reindex |
| `MEMORY_MCP_URL` | Yes | — | Memory recall for Context Manifest |
| `CONFIG_PATH` | No | `/config/agents.yml` | Agent profiles |
| `REINDEX_TIMEOUT_MS` | No | `30000` | Max wait for pre-task reindex |

## Health Check

```bash
curl -sf http://localhost:3460/health | jq .
# → { "status": "ok", "service": "mai-dispatcher" }
```

## Common Failure Modes

**`agents_loaded: 0`** — `agents.yml` not mounted or has a syntax error.
Fix: check the `CONFIG_PATH` volume mount in `docker-compose.yml`.

**Agent stuck in HARD_PAUSE** — budget reset did not fire (Redis key did not expire). Should not happen with the 48 h TTL, but can occur after clock drift.
Fix: use the Resume button in the dashboard Agent Activity page, or:
```bash
docker compose exec redis redis-cli del "agent:cursor-claude:state"
```

**Nightly reindex not firing** — check logs for `[scheduler]` entries:
```bash
docker compose logs mai-dispatcher | grep scheduler
# → [scheduler] next nightly reindex in NNN minutes
```
The timer is recalculated on each container restart.

## Debug Procedures

```bash
# Budget status for an agent
curl -s http://localhost:3460/agents/cursor-claude/budget | jq .

# Manually resume a HARD_PAUSE agent (M5)
curl -s -X POST http://localhost:3460/agents/cursor-claude/resume | jq .

# View all agent states in Redis
docker compose exec redis redis-cli keys "agent:*:state"

# Reset concurrency counter if drifted
docker compose exec redis redis-cli set "agent:cursor-claude:active_tasks" 0

# Trigger a single project reindex directly (bypasses scheduler)
docker compose exec mai-dispatcher \
  curl -s -X POST http://mai-code-mcp:3457/reindex/app-a | jq .
```

# mai-memory-mcp — Runbook

## Purpose

Per-project persistent key-value memory for agents. Backed by Redis. Stores decisions, architectural choices, past task outcomes, and any facts agents explicitly remember. REST API on port 3458. Exposed via MCP tools: `remember`, `recall`, `forget`, `list_memories`. The dispatcher queries this during Context Manifest assembly.

## Key Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `3458` | HTTP listen port |
| `REDIS_URL` | Yes | — | e.g. `redis://redis:6379` |

## Health Check

```bash
docker compose exec mai-memory-mcp curl -sf http://localhost:3458/health
# → { "status": "ok", "service": "mai-memory-mcp" }
```

## Common Failure Modes

**Redis connection refused** — `REDIS_URL` is wrong or Redis is not healthy. Service exits on startup.
Fix: verify Redis is running (`docker compose ps redis`) and the URL is correct.

**Memories not appearing in Context Manifest** — `recall` uses keyword/substring matching, not semantic search. If the query does not overlap with stored keys, nothing is returned.
Fix: use `list_memories` MCP tool or `GET /projects/:id/memories` to inspect stored items.

## Debug Procedures

```bash
# List all memories for a project
docker compose exec mai-memory-mcp \
  curl -s "http://localhost:3458/projects/app-a/memories?limit=50" | jq .

# Recall memories matching a query
docker compose exec mai-memory-mcp \
  curl -s "http://localhost:3458/projects/app-a/memories/recall?q=rate+limiting&limit=5" | jq .

# Inspect Redis keys directly
docker compose exec redis redis-cli keys "memory:app-a:*"
```

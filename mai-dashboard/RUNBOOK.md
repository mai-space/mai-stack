# mai-dashboard — Runbook

## Purpose

React SPA control plane. Fastify backend serves the compiled React app and provides API routes that proxy to mai-project-mcp, mai-dispatcher, and mai-registry. WebSocket relay bridges Redis pub/sub to browser clients for live updates. Dashboard authentication via HMAC-SHA256 signed session cookie (enforced when `DASHBOARD_SECRET` is set). Port 3461, publicly exposed.

## Key Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `3461` | HTTP listen port |
| `REGISTRY_URL` | Yes | — | For /api/overview project list |
| `PROJECT_MCP_URL` | Yes | — | For /api/escalations, task proxies, bulk-close |
| `DISPATCHER_URL` | Yes | — | For /api/agents, agent resume proxy |
| `REDIS_URL` | Yes | — | WebSocket relay pub/sub |
| `DASHBOARD_SECRET` | No | — | If unset: auth is disabled (dev mode) |

## Health Check

```bash
curl -sf http://localhost:3461/health
# → { "status": "ok", "service": "mai-dashboard" }
```

Note: `/health` is always accessible — it is exempt from the auth middleware so Docker healthchecks continue to work.

## Common Failure Modes

**Login page not appearing / auth not enforced** — `DASHBOARD_SECRET` is not set. This is by design: auth is only enforced when the env var is non-empty. Set `DASHBOARD_SECRET` in `.env` for production use.

**WebSocket not connecting** — `REDIS_URL` not set or Redis unreachable. Live updates degrade to manual refresh; the REST API continues to work. Check logs for `[ws-relay]` errors.

**Session cookie not persisting across dashboard restarts** — by design. Cookies are signed with `DASHBOARD_SECRET`. If the secret changes, all existing sessions are invalidated immediately.

**"Upstream error" in API responses** — one of the upstream services (project-mcp, dispatcher, registry) is down. Check: `docker compose ps` and the logs of the failing service.

## Debug Procedures

```bash
# Login and capture cookie
curl -c /tmp/mai.txt -s -X POST http://localhost:3461/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"secret":"change-me"}' | jq .

# Hit an API route with the session cookie
curl -b /tmp/mai.txt -s http://localhost:3461/api/overview | jq '.[0]'

# Auth check
curl -b /tmp/mai.txt -s http://localhost:3461/auth/check | jq .

# Logout
curl -b /tmp/mai.txt -c /tmp/mai.txt \
  -s -X POST http://localhost:3461/auth/logout | jq .

# Test live WebSocket events via Redis
docker compose exec redis redis-cli publish \
  "task.test-id.state_changed" \
  '{"task_id":"test-id","project_id":"app-a","from":"OPEN","to":"IN_PROGRESS"}'
```

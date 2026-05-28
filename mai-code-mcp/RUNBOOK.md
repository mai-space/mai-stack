# mai-code-mcp — Runbook

## Purpose

Semantic code indexing. Chunks workspace files, creates embeddings (Ollama/OpenAI/Cohere), stores them in Qdrant, and exposes search and reindex REST endpoints on port 3457. Syncs with mai-registry on startup to ensure Qdrant collections exist for all registered projects.

## Key Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `3457` | HTTP listen port |
| `MAI_DEFAULT_STORE` | Yes | — | e.g. `qdrant:http://qdrant:6333` |
| `MAI_DEFAULT_MODEL` | No | `ollama:nomic-embed-text` | Embedding provider:model |
| `REGISTRY_URL` | Yes | — | e.g. `http://mai-registry:3459` |
| `OLLAMA_BASE_URL` | No | `http://host.docker.internal:11434` | Required for Ollama models |
| `OPENAI_API_KEY` | No | — | Required for `openai:` models |
| `COHERE_API_KEY` | No | — | Required for `cohere:` models |

## Health Check

```bash
docker compose exec mai-code-mcp curl -sf http://localhost:3457/health
# → { "status": "ok", "service": "mai-code-mcp" }
```

## Common Failure Modes

**Qdrant connection refused at startup** — Qdrant not yet healthy. The registry sync retries with backoff. If all retries fail, the service continues with a warning — reindex will work once Qdrant is reachable.

**Ollama not reachable** — `OLLAMA_BASE_URL` is wrong or Ollama is not running on the host. Symptom: reindex completes with 0 chunks. Check `docker compose logs mai-code-mcp`.

**Embedding dimension mismatch** — Qdrant collection was created with model A, then the model was changed to model B with a different vector size. Symptom: HTTP 422 from Qdrant on upsert.
Fix:
```bash
docker compose exec qdrant \
  curl -s -X DELETE http://localhost:6333/collections/project_app-a
docker compose exec mai-code-mcp \
  curl -s -X POST http://localhost:3457/reindex/app-a
```

## Debug Procedures

```bash
# Check reindex status
docker compose exec mai-code-mcp \
  curl -s http://localhost:3457/reindex/app-a/status | jq .

# Trigger manual reindex
docker compose exec mai-code-mcp \
  curl -s -X POST http://localhost:3457/reindex/app-a | jq .

# List Qdrant collections
docker compose exec qdrant \
  curl -s http://localhost:6333/collections | jq '.result.collections[].name'

# Check collection point count
docker compose exec qdrant \
  curl -s http://localhost:6333/collections/project_app-a | jq '.result.points_count'
```

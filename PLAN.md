# mai-stack — Product Plan

> An autonomous, multi-agent coding orchestration platform.  
> Developers define projects and tasks. Agents work them — organized, governed, and unblocked.

---

## Vision

Most AI coding tools are reactive. You prompt, they respond, you prompt again.  
mai-stack is different: it is a **persistent system** where tasks queue up, agents claim and work them autonomously, and when an agent hits a wall it names the wall — creating subtasks, asking decisions, flagging risk — rather than guessing or going silent.

You govern everything from a dashboard. The agents handle the rest.

---

## Principles

- **Agents pull work, they are never pushed to.** Local tools (Cursor, Claude Code, opencode, Junie) connect to the dispatcher and claim tasks. The system does not try to invoke them.
- **A blocked task is not a dead end.** It is a typed pause with a known resolution path.
- **Context is assembled, not assumed.** Before an agent receives a task, the dispatcher pre-fetches relevant code, memory, project state, and instructions into a single Context Manifest.
- **Hardware stays on the machine.** Ollama and all local AI tools run on the client. Docker services are stateless, portable, and lightweight.
- **Human governance is first-class.** The dashboard is not a viewer — it is a control plane. Escalations are routed there and require explicit human response.

---

## The Two Existing Foundations

### mai-space-project-mcp
Task orchestration engine. Manages Projects, Tasks, and Agents via REST API, MCP SSE, CLI, and a React Kanban dashboard. Tasks have a lifecycle (OPEN → IN_PROGRESS → DONE / BLOCKED) and are leased to agents with a TTL. Built on Fastify + SQLite + Kysely.

### mai-code-mcp
Semantic code indexing. Chunks a codebase, creates embeddings via Ollama / OpenAI / Cohere, stores them in Qdrant or ChromaDB, and exposes search via MCP. Supports incremental reindex. Agents use it to find relevant files and code before working a task.

Both exist and work. Everything below builds on and connects them.

---

## Services

### Infrastructure (no custom code)

**redis**  
Backbone for all inter-service communication. Handles: task lifecycle events (pub/sub), dirty flags for file changes, rate limit token buckets, daily budget ledgers, escalation notifications to dashboard, WebSocket relay for live UI updates.

**qdrant**  
Vector database for code embeddings. Namespaced per project via collection naming. Persistent volume. Never exposed to host — only reachable by mai-code-mcp internally.

---

### Core Services

**mai-registry** *(new)*  
Source of truth for what projects exist. Every other service is a consumer of this registry. Stores per project: name, slug, workspace path, AGENTS.md path, system prompt override, allowed agent IDs, embedding config, last indexed timestamp, index health status. Exposes a REST API. Configured initially via `projects.yml`, then managed via API. Backed by SQLite.

**mai-project-mcp** *(extend)*  
Extend the existing task lifecycle with a typed blocker system (see Blocker Taxonomy below). Tasks now form a DAG — subtasks block parents, and the dispatcher traverses this graph to prioritize work that unblocks other work. New MCP tools exposed to agents: `create_subtask`, `request_decision`, `request_clarification`, `flag_risk`, `reassign_task`.

**mai-code-mcp** *(extend)*  
Add registry awareness: on startup, reads all projects from mai-registry and ensures each has an indexed collection. Add an HTTP SSE transport mode (alongside existing stdio) so it is reachable as a networked service. Reindex is triggered externally by the dispatcher pre-task, not only by CLI.

**mai-watcher** *(new)*  
Lightweight Node.js container that mounts all workspace directories read-only and watches for file changes using chokidar. On change: debounces (5s default), publishes `project.{id}.files_changed` to Redis, sets `project.{id}.dirty = true`. Does not trigger reindex itself — that is the dispatcher's decision.

**mai-memory-mcp** *(new)*  
Per-project persistent key-value memory for agents. Backed by Redis. Stores decisions, architectural choices, past task outcomes, and any facts agents explicitly remember. Exposed via MCP tools: `remember`, `recall`, `forget`, `list_memories`. The dispatcher queries this during Context Manifest assembly, retrieving entries semantically relevant to the current task.

**mai-dispatcher** *(new — the brain)*  
The central service. Everything flows through it. Responsibilities:

1. **Agent registry** — knows all configured agent profiles (type, model provider, task type affinity, concurrency limit, daily budget, rate limit policy)
2. **Governed MCP gateway** — local tools connect here, not directly to mai-project-mcp. Every claim_task call is intercepted, checked against budget and rate limits, and either allowed, delayed (sleep), or rejected with retry_after
3. **Context Manifest assembly** — before handing a task to an agent, fetches: project AGENTS.md, relevant code chunks from mai-code-mcp, task dependencies, project state snapshot, memory recall from mai-memory-mcp, and injects agent-specific instructions
4. **Pre-task freshness check** — compares `last_indexed_at` vs `last_files_changed_at` from Redis. If stale beyond threshold, triggers incremental reindex on mai-code-mcp and holds the task in CONTEXT_PENDING until complete
5. **Blocker routing** — when an agent creates a blocker, routes it: SUBTASK auto-handled, DECISION/CLARIFICATION/RISK escalated to dashboard via Redis pub/sub
6. **Budget & rate limit enforcement** — per-agent and per-provider token buckets in Redis. Exponential backoff with jitter on 429s. Graceful shutdown (finish current task, stop claiming) when daily budget hits 90%
7. **Graph-aware scheduling** — prioritizes tasks that unblock other tasks. A subtask blocking 3 parents is scheduled ahead of isolated tasks

**mai-dashboard** *(new)*  
React application. The human's control plane. Backed by WebSocket subscriptions to Redis for live updates — no polling. Views:

- **Project Overview** — all projects, health indicators, agent activity counts
- **Kanban per project** — tasks in columns by state, blocker type badges, subtask trees, agent assignments, dependency arrows
- **Escalation Queue** — everything waiting for human input, sorted by urgency. Inline response UI for DECISION (buttons), CLARIFICATION (text input), RISK (approve/reject with notes)
- **Agent Activity** — per-agent current task, budget consumption today, rate limit state, recent history
- **Dependency Graph** — visual DAG per project, shows which tasks block others and why
- **Settings** — register projects, configure agent profiles, set budgets

---

### Client (not in Docker)

**Ollama** — runs on the host machine with GPU access. Reachable by containers via `host.docker.internal:11434`. Passed in as `OLLAMA_BASE_URL` env var. Never containerized.

**Cursor / Claude Code / opencode / Junie** — local coding tools. Connect to the dispatcher at `localhost:3460` as MCP clients. They claim tasks, receive Context Manifests, do the work, report back. Multiple instances of the same tool type can run simultaneously with different model/budget profiles.

---

## Blocker Taxonomy

The most important design decision in the system. Agents have a structured vocabulary for being stuck instead of guessing or going silent.

| Type | Meaning | Resolution |
|---|---|---|
| `SUBTASK` | Needs code written first | Dispatcher auto-creates child task, parent auto-resumes when child is DONE |
| `DECISION` | Human must choose between approaches | Escalates to dashboard, agent sleeps, user picks option, decision stored in memory |
| `CLARIFICATION` | Task description is ambiguous | Escalates with question, task description updated on response, agent resumes with new context |
| `DEPENDENCY` | Waiting on external system or other project | Links to external blocker, sets expected_resolution hint, watcher polls or webhook |
| `CAPABILITY` | Wrong agent type for this task | Dispatcher re-queues with capability tag for correct agent profile |
| `RISK` | Dangerous change, needs human review | Mandatory dashboard review gate. High severity blocks all project tasks until resolved |

Agents use new MCP tools to create these:

```
create_subtask(parent_task_id, title, description, priority?)
request_decision(task_id, question, options[])
request_clarification(task_id, question)
flag_risk(task_id, description, severity)
reassign_task(task_id, required_capability, reason)
```

The Context Manifest always ends with explicit instructions for using these tools. Agents are told: *if you cannot proceed, name what is blocking you — do not guess past a decision boundary.*

---

## Task Lifecycle (complete)

```
OPEN
  └─[dispatcher claims on behalf of agent]─▶ IN_PROGRESS
                                                  │
                          ┌───────────────────────┼───────────────────────┐
                          │                       │                       │
                    [completes]            [hits a wall]           [lease expires]
                          │                       │                       │
                        DONE             ┌────────▼────────┐            OPEN
                                         │  BLOCKER TYPE?  │        (re-queued)
                                         └────────┬────────┘
                          ┌──────────────┬─────────┼──────────────┬────────────────┐
                          │              │         │              │                │
                     SUBTASK        DECISION   CLARIFY          RISK          CAPABILITY
                          │              │         │              │                │
                    [child task    [dashboard  [dashboard   [dashboard         [re-queued
                     created,       alert,      alert,       alert,           with cap.
                     auto-blocks    agent       agent        all proj          tag for
                     parent]        sleeps]     sleeps]      tasks hold]      right agent]
                          │              │         │              │
                    [child DONE]   [user picks] [user writes] [approved/
                          │              │         │            rejected]
                          └──────────────┴─────────┴──────────────┘
                                         │
                                   IN_PROGRESS
                                  (agent resumes
                                  with new context)
```

---

## Context Manifest (what an agent actually receives)

Assembled by the dispatcher before every task handoff:

```
TASK: #42 — Implement rate limiting on /api/upload
PROJECT: app-a
AGENT: cursor-claude

═══ PROJECT CONTEXT ════════════════════════════════════════════
[from AGENTS.md + system_prompt_override in registry]
This project uses Remix with a Postgres backend.
Always check db/schema.ts before touching any data layer.
Use zod for all input validation. Tests live in __tests__/.

═══ RELEVANT CODE ══════════════════════════════════════════════
[from mai-code-mcp: semantic search on task title]
→ app/routes/api.upload.ts           similarity 0.94
→ app/middleware/auth.server.ts      similarity 0.81
→ app/utils/redis.server.ts          similarity 0.78

═══ PROJECT STATE ══════════════════════════════════════════════
Open: 12  |  Blocked: 3  |  In progress: 2
Recently completed: "Add file validation", "Migrate upload to S3"
Blocked on auth module: 2 tasks (may be related to this work)

═══ TASK DEPENDENCIES ══════════════════════════════════════════
No blockers. This task blocks: #47 Add upload analytics.

═══ MEMORY RECALL ══════════════════════════════════════════════
[from mai-memory-mcp: relevant past decisions]
• 2026-05-10: Decided to use Upstash Redis for rate limiting
• 2026-05-14: rate-limiter-flexible chosen over alternatives

═══ IF YOU CANNOT PROCEED ══════════════════════════════════════
Do NOT stop silently. Do NOT guess past a decision boundary.

  Need something built first?
  → create_subtask(parent_task_id, title, description)

  Need a human to choose between approaches?
  → request_decision(task_id, question, options[])

  Task description unclear?
  → request_clarification(task_id, question)

  Change is risky and needs review?
  → flag_risk(task_id, description, severity)

  Wrong tool for this task?
  → reassign_task(task_id, required_capability, reason)

═══ YOUR TASK ══════════════════════════════════════════════════
Implement rate limiting on /api/upload endpoint.
Priority: 20 (high). Lease TTL: 5 min (use renew_lease to extend).
```

---

## Embedding Freshness Strategy

Three complementary triggers — never rely on just one:

**Fast path — file watcher**  
mai-watcher detects file saves. Debounces 5 seconds. Sets `project.{id}.dirty = true` in Redis. Cheap, always on.

**Safe path — pre-task check**  
Dispatcher compares `last_indexed_at` vs `last_files_changed_at` before assigning any task. If delta exceeds the project's `reindex_threshold_minutes` (configurable, default 15), triggers incremental reindex on mai-code-mcp and holds task in `CONTEXT_PENDING`. Agent never receives stale context.

**Paranoid path — nightly full reindex**  
Scheduled full reindex of all projects at 3am. Catches git operations, branch switches, and anything the watcher missed.

---

## Agent Governance

### Agent Profiles (agents.yml)

```yaml
agents:
  - id: cursor-claude
    type: cursor
    model_provider: anthropic
    model: claude-sonnet-4-5
    task_types: [code, refactor, review]
    max_concurrent_tasks: 2
    budget:
      daily_usd: 5.00
      per_task_usd: 0.50
    rate_limit:
      requests_per_minute: 10
      on_429: exponential_backoff   # base 1s, max 60s, +jitter
      on_budget_90pct: graceful_shutdown

  - id: opencode-cheap
    type: opencode
    model_provider: openai
    model: gpt-4o-mini
    task_types: [boilerplate, docs, tests]
    max_concurrent_tasks: 3
    budget:
      daily_usd: 2.00
    rate_limit:
      requests_per_minute: 30
      on_429: sleep_30s

  - id: opencode-smart
    type: opencode
    model_provider: openai
    model: o3
    task_types: [architecture, hard-bugs]
    max_concurrent_tasks: 1
    budget:
      daily_usd: 15.00
      per_task_usd: 3.00
    rate_limit:
      requests_per_minute: 5
      on_429: exponential_backoff

  - id: junie
    type: junie
    model_provider: anthropic
    model: claude-opus-4-5
    task_types: [planning, architecture, review]
    max_concurrent_tasks: 1
    budget:
      daily_usd: 10.00
    rate_limit:
      requests_per_minute: 5
      on_budget_90pct: graceful_shutdown
```

### Budget State Machine

```
IDLE ──[task available + budget ok + rate ok]──▶ WORKING
WORKING ──[task done]──▶ IDLE
WORKING ──[429 received]──▶ BACKING_OFF(exponential + jitter)
BACKING_OFF ──[timer elapsed]──▶ IDLE
WORKING ──[budget > 90%]──▶ GRACEFUL_SHUTDOWN
  └─▶ finish current task, release lease, stop claiming
GRACEFUL_SHUTDOWN ──[midnight reset]──▶ IDLE
WORKING ──[budget > 100%]──▶ HARD_PAUSE (immediate)
HARD_PAUSE ──[manual resume or midnight]──▶ IDLE
```

Budget ledgers live in Redis as `budget:{provider}:{YYYY-MM-DD}` with 48h TTL. Atomic INCRBY on each task. All agents sharing a provider (e.g. multiple Anthropic agents) share one provider-level bucket in addition to their personal budgets.

---

## Project Configuration

### projects.yml (initial setup, then managed via registry API)

```yaml
projects:
  - id: app-a
    name: "App A"
    workspace: /workspaces/app-a
    agents_md: /workspaces/app-a/AGENTS.md
    system_prompt_override: |
      This project uses Remix with a Postgres backend.
      Always check db/schema.ts before touching any data layer.
    allowed_agents: [cursor-claude, opencode-cheap]
    embedding:
      model: ollama:nomic-embed-text
      reindex_threshold_minutes: 15

  - id: app-b
    name: "App B"
    workspace: /workspaces/app-b
    agents_md: /workspaces/app-b/AGENTS.md
    allowed_agents: [opencode-smart, junie]
    embedding:
      model: openai:text-embedding-3-small
      reindex_threshold_minutes: 30
```

---

## docker-compose.yml

```yaml
name: mai-stack

x-ollama: &ollama-env
  OLLAMA_BASE_URL: ${OLLAMA_BASE_URL:-http://host.docker.internal:11434}

services:

  # Infrastructure

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes: [redis-data:/data]
    networks: [mai]

  qdrant:
    image: qdrant/qdrant:latest
    restart: unless-stopped
    volumes: [qdrant-data:/qdrant/storage]
    networks: [mai]

  # Registry

  mai-registry:
    build: ./mai-registry
    restart: unless-stopped
    environment:
      PORT: 3459
      REDIS_URL: redis://redis:6379
      DB_PATH: /data/registry.db
    volumes:
      - registry-data:/data
      - ./config/projects.yml:/config/projects.yml:ro
    ports: ["3459:3459"]
    networks: [mai]
    depends_on: [redis]

  # File Watcher

  mai-watcher:
    build: ./mai-watcher
    restart: unless-stopped
    environment:
      REDIS_URL: redis://redis:6379
      REGISTRY_URL: http://mai-registry:3459
      DEBOUNCE_MS: 5000
    volumes:
      - ${WORKSPACES_PATH}:/workspaces:ro
    networks: [mai]
    depends_on: [redis, mai-registry]

  # MCP Services

  mai-project-mcp:
    build: ./mai-space-project-mcp
    restart: unless-stopped
    environment:
      PORT: 3456
      HOST: "0.0.0.0"
      MAI_DB_PATH: /data/mai.db
      REDIS_URL: redis://redis:6379
    volumes: [project-db:/data]
    networks: [mai]
    depends_on: [redis]

  mai-code-mcp:
    build: ./mai-code-mcp
    restart: unless-stopped
    environment:
      <<: *ollama-env
      PORT: 3457
      MAI_DEFAULT_STORE: "qdrant:http://qdrant:6333"
      MAI_DEFAULT_MODEL: ${EMBEDDING_MODEL:-ollama:nomic-embed-text}
      REGISTRY_URL: http://mai-registry:3459
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      COHERE_API_KEY: ${COHERE_API_KEY:-}
    volumes:
      - ${WORKSPACES_PATH}:/workspaces:ro
    networks: [mai]
    depends_on: [qdrant, mai-registry]

  mai-memory-mcp:
    build: ./mai-memory-mcp
    restart: unless-stopped
    environment:
      PORT: 3458
      REDIS_URL: redis://redis:6379
    networks: [mai]
    depends_on: [redis]

  # Dispatcher

  mai-dispatcher:
    build: ./mai-dispatcher
    restart: unless-stopped
    ports: ["3460:3460"]
    environment:
      PORT: 3460
      REDIS_URL: redis://redis:6379
      REGISTRY_URL: http://mai-registry:3459
      PROJECT_MCP_URL: http://mai-project-mcp:3456
      CODE_MCP_URL: http://mai-code-mcp:3457
      MEMORY_MCP_URL: http://mai-memory-mcp:3458
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      CONFIG_PATH: /config/agents.yml
    volumes:
      - ./config/agents.yml:/config/agents.yml:ro
      - dispatcher-data:/data
    networks: [mai]
    depends_on:
      - mai-project-mcp
      - mai-code-mcp
      - mai-memory-mcp
      - mai-registry
      - redis

  # Dashboard

  mai-dashboard:
    build: ./mai-dashboard
    restart: unless-stopped
    ports: ["3461:3461"]
    environment:
      PORT: 3461
      REGISTRY_URL: http://mai-registry:3459
      PROJECT_MCP_URL: http://mai-project-mcp:3456
      DISPATCHER_URL: http://mai-dispatcher:3460
      REDIS_URL: redis://redis:6379
      DASHBOARD_SECRET: ${DASHBOARD_SECRET}
    networks: [mai]
    depends_on: [mai-dispatcher, mai-registry, redis]

volumes:
  redis-data:
  qdrant-data:
  registry-data:
  project-db:
  dispatcher-data:

networks:
  mai:
    driver: bridge
```

---

## .env

```bash
# Hardware — never containerized
OLLAMA_BASE_URL=http://host.docker.internal:11434

# All project codebases under one root
WORKSPACES_PATH=/Users/you/projects

# Embedding provider — swap without touching compose
EMBEDDING_MODEL=ollama:nomic-embed-text
# EMBEDDING_MODEL=openai:text-embedding-3-small

# Provider keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
COHERE_API_KEY=...

# Dashboard
DASHBOARD_SECRET=change-me
```

---

## Build Order

Dependencies flow in one direction. Build and validate in this order:

```
1. redis, qdrant                  (infrastructure, no deps)
2. mai-registry                   (depends on redis)
3. mai-project-mcp                (depends on redis)
4. mai-code-mcp                   (depends on qdrant, registry)
5. mai-memory-mcp                 (depends on redis)
6. mai-watcher                    (depends on redis, registry)
7. mai-dispatcher                 (depends on all above)
8. mai-dashboard                  (depends on dispatcher, registry, redis)
```

---

## Repositories

```
mai-stack/                        ← monorepo root (docker-compose, config)
├── mai-space-project-mcp/        ← existing, extend with blocker taxonomy
├── mai-code-mcp/                 ← existing, extend with HTTP transport + registry awareness
├── mai-registry/                 ← new
├── mai-watcher/                  ← new
├── mai-memory-mcp/               ← new
├── mai-dispatcher/               ← new (largest new service)
├── mai-dashboard/                ← new
└── config/
    ├── projects.yml
    └── agents.yml
```

---

## Development Milestones

### M1 — Foundation
- Extend mai-project-mcp with typed blocker system and DAG relationships
- Stand up mai-registry with projects.yml seeding
- Verify mai-code-mcp works as a networked HTTP service
- Redis running, all services connected on mai network

Validation: create two projects, create tasks with dependencies, mark one as BLOCKED:SUBTASK, verify parent auto-resumes when child completes.

### M2 — Intelligence Layer
- Build mai-watcher with debounced dirty flags
- Build mai-memory-mcp with Redis backend
- Build mai-dispatcher context manifest assembly (registry + code search + memory)
- Pre-task freshness check and reindex trigger

Validation: edit a file in a workspace, verify dirty flag is set, claim a task via dispatcher, receive a fully assembled Context Manifest with relevant code chunks.

### M3 — Governance
- Dispatcher budget ledgers and rate limit state machine per agent profile
- Exponential backoff on 429, graceful shutdown at 90% budget
- Agent profiles loaded from agents.yml
- Local tools (Cursor, opencode) connect to dispatcher at localhost:3460

Validation: configure a $1/day budget for an agent, run tasks until limit is approached, verify graceful shutdown behaviour and budget reset at midnight.

### M4 — Human Control
- Build mai-dashboard: project overview, kanban, escalation queue, agent activity
- WebSocket subscriptions to Redis for live updates
- Inline response UI for DECISION, CLARIFICATION, RISK escalations
- Dependency graph view

Validation: trigger a DECISION blocker from an agent, watch it appear in dashboard escalation queue in real time, respond inline, verify agent resumes with decision stored in memory.

### M5 — Polish
- Dashboard auth
- Nightly full reindex scheduler in dispatcher
- Multi-project agent routing (project affinity in agent profiles)
- Dependency graph visualization
- Operational runbook and README per service

---

## What Success Looks Like

A developer opens the dashboard, creates a project, adds ten tasks with rough descriptions, and goes to make coffee. By the time they return, several tasks are done, one is waiting for a decision they need to make, one has been decomposed into subtasks by an agent that hit a dependency, and the code embeddings have stayed fresh automatically throughout. The developer clicks two buttons to resolve the decision, and work continues without them touching a terminal.

That is the product.

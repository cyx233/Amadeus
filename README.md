# Amadeus

Browser-based coding-agent platform (Claude Code, Codex, Cursor, OpenCode) with long-lived Docker sessions, self-recovery, and integrated RAG.

## Quick Start

Amadeus is multi-user. A single URL (port 3001) serves a login page; after
login the nginx gateway routes each user to their own isolated container.

```bash
cp .env.example .env
# Set JWT_SECRET (openssl rand -hex 32) and ONE of:
#   ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or AWS creds

# 1. Start the gateway + auth entrypoint
docker compose up -d

# 2. Register users (auth-gateway must be up)
./scripts/user.sh add alice           # prompts for a password

# 3. Bring up the per-user backends
docker compose -f docker-compose.yml -f docker-compose.multi.yml up -d

open http://localhost:3001            # log in as alice
```

How it fits together:
- **auth-gateway** — a lightweight auth entrypoint (reuses CloudCLI's auth
  code, none of the app runtime). Serves the login page, owns the shared user
  database, and issues the login cookie.
- **gateway (nginx)** — verifies the cookie and routes each request to
  `amadeus-<username>`; unauthenticated requests get the login page.
- **amadeus-&lt;user&gt;** — per-user backend containers, fully isolated
  (own volume), generated into `docker-compose.multi.yml` by `user.sh`
  (gitignored — it contains usernames).

Each user's container ships the coding-agent CLIs (Claude Code, Codex, Cursor,
OpenCode); sign in to a provider from the in-app settings after first launch.
Cursor and OpenCode need their own accounts/keys; OpenCode is model-neutral so
it can point at any backend (e.g. DeepSeek) you configure.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (localhost:3001)                        │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Chat/WS  │ │File Tree │ │ CodeMirror     │  │
│  └────┬─────┘ └────┬─────┘ └───────┬────────┘  │
└───────┼─────────────┼───────────────┼───────────┘
        │WebSocket    │REST           │REST
┌───────▼─────────────▼───────────────▼───────────┐
│  amadeus-<user> container                        │
│  ┌────────────────────────────────────────────┐  │
│  │ server (Express + WS)                       │  │
│  │  chat.send → DB session.provider →          │  │
│  │  spawnFns[provider] dispatch:               │  │
│  │    claude   → claude-sdk.js                  │  │
│  │    codex    → openai-codex.js                │  │
│  │    cursor   → cursor-cli.js                  │  │
│  │    opencode → opencode-cli.js                │  │
│  │  (each provider also implements IProvider:   │  │
│  │   auth/models/mcp/skills/sessions/sync)      │  │
│  ├────────────────────────────────────────────┤  │
│  │ watchdog.js (stall detection + abort)      │  │
│  ├────────────────────────────────────────────┤  │
│  │ /home/agent volume (per-user, isolated)     │  │
│  │  ├─ .amadeus/   auth.db, assets, todo, ...   │  │
│  │  │              (API keys hashed, tokens enc)│  │
│  │  ├─ .claude/ .codex/ .local/share/opencode/  │  │
│  │  │              (LLM creds, CLI-owned)        │  │
│  │  └─ .claude/skills/  (rag-query, rag-ingest) │  │
│  └────────────────────────────────────────────┘  │
│       │ curl                                     │
│  ┌────▼───────────────────────────────────────┐  │
│  │ lightrag container (RAG retrieval)         │  │
│  │  REST: /query, /documents                  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**Provider adapters** — chat/session logic is provider-agnostic. Each provider
(`server/modules/providers/list/<name>/`) implements the `IProvider` contract
(auth, models, mcp, skills, sessions, session-synchronizer); chat runs dispatch
through a provider-keyed `spawnFns` map, not per-provider branches. TaskMaster
is deliberately *outside* this — it's a task-management MCP server that any
provider's agent calls over MCP, not an agent runtime.

## Data & Privacy

Amadeus is self-hosted: **all persistent data stays on the machine you deploy
it to.** Nothing is sent to any Amadeus-operated service — there is no
telemetry, analytics, or account backend.

- **Where data lives** — each user gets an isolated container with its own
  Docker volume (`user-data-<user>`). Code, agent sessions, the SQLite auth
  database, and uploads all live in that volume on your host. Users cannot see
  each other's data.
- **Credential storage** — the two secrets Amadeus persists itself are not
  plaintext: its own `ck_` API keys are stored as SHA-256 hashes (validated by
  hashing the presented key), and git/service tokens are AES-256-GCM encrypted
  under a key derived from `JWT_SECRET` (see `server/shared/secret-crypto.ts`).
  LLM provider credentials aren't in Amadeus's DB at all — the agent CLIs own
  them in their own files (`~/.claude`, `~/.codex`, `~/.local/share/opencode`).
- **What leaves the machine** — only what *you* configure the agent to reach:
  your chosen LLM backend (Anthropic API, OpenAI, Bedrock, DeepSeek, …) and any
  tools the agent runs. Amadeus itself adds no outbound calls, with one
  exception:
- **Update check** — the sidebar polls the project's GitHub releases
  (`cyx233/Amadeus`) to show an "update available" hint. It sends no data beyond
  a plain GitHub API request. Disable it by removing the `useVersionCheck` call
  in `app/src/components/sidebar/view/Sidebar.tsx`.

You own the deployment, so you own the data. Encryption at rest (LUKS, encrypted
volumes) is a host-level concern and left to the operator.

## Key Features

| Feature | How |
|---------|-----|
| Multiple agents | Claude Code, Codex, Cursor, OpenCode behind one `IProvider` adapter contract; chat dispatches by DB session provider |
| Long-lived agent | Docker container with `restart: unless-stopped`, sessions persisted on volume |
| Session recovery | SDK `resume` by session ID; watchdog aborts stalled sessions; frontend reconnects via writer-swap |
| File + code editing | File tree + content search (ripgrep) + CodeMirror editor, real-time sync with agent workspace |
| Task management | TaskMaster as an MCP server any agent can drive |
| RAG | LightRAG (hybrid graph+vector), queried via skill — session artifacts and workspace files all indexed there |

## Session Recovery Flow

1. **Browser disconnect** → WebSocket reconnects, `reconnectSessionWriter()` swaps the writer; session continues uninterrupted.
2. **Agent process crash** → SDK iterator throws; the server can re-`query({ resume: sessionId })` from the same JSONL.
3. **Container restart** → Docker restarts it; the per-user `/home/agent` volume preserves all session state; user clicks "resume" in the UI.
4. **Hung session** → watchdog detects no messages for 5 min, aborts the session, frontend offers resume.

## Development

```bash
# Run frontend + backend in dev mode (outside docker)
cd app && npm run dev

# Just the server
cd app && npm run server:dev
```

## Configuration

See `.env.example`. Key knobs:

- `JWT_SECRET` — signs login cookies and derives the credential-encryption key (required)
- `WATCHDOG_STALL_MS` — how long before a silent session is considered stalled (default: 5 min)
- `LIGHTRAG_URL` — override if running LightRAG separately
- `AMADEUS_DATA_DIR` — backend data dir (auth.db, assets, todo, …); defaults to `~/.amadeus`
- `WORKSPACES_ROOT` — where per-user project workspaces live (default: `~/workspace`)

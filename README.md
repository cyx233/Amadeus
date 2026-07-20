# Amadeus

Browser-based Claude Code agent platform with long-lived Docker sessions, self-recovery, and integrated RAG.

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
./scripts/add-user.sh alice           # prompts for a password

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
  (own volume), generated into `docker-compose.multi.yml` by `add-user.sh`
  (gitignored — it contains usernames).

Each user's container ships the coding-agent CLIs (Claude Code, Codex,
OpenCode); sign in to a provider from the in-app settings after first launch.

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
│  amadeus container                               │
│  ┌────────────────────────────────────────────┐  │
│  │ CloudCLI server (Express + WS)             │  │
│  │  └─ claude-sdk.js → @anthropic-ai/agent-sdk│  │
│  ├────────────────────────────────────────────┤  │
│  │ watchdog.js (stall detection + abort)      │  │
│  ├────────────────────────────────────────────┤  │
│  │ ~/.claude/ volume                          │  │
│  │  ├─ projects/  (session JSONLs = resume)   │  │
│  │  └─ skills/    (rag-query, rag-ingest)     │  │
│  └────────────────────────────────────────────┘  │
│       │ curl                                     │
│  ┌────▼───────────────────────────────────────┐  │
│  │ lightrag container (RAG retrieval)         │  │
│  │  REST: /query, /documents                  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## Key Features

| Feature | How |
|---------|-----|
| Long-lived agent | Docker container with `restart: unless-stopped`, sessions persisted on volume |
| Session recovery | SDK `resume` by session ID; watchdog aborts stalled sessions; frontend reconnects via writer-swap |
| File + code editing | CloudCLI file tree + CodeMirror editor, real-time sync with agent workspace |
| RAG | LightRAG (hybrid graph+vector), queried via skill — session artifacts and workspace files all indexed there |

## Session Recovery Flow

1. **Browser disconnect** → WebSocket reconnects, `reconnectSessionWriter()` swaps the writer; session continues uninterrupted.
2. **Agent process crash** → SDK iterator throws; CloudCLI can re-`query({ resume: sessionId })` from the same JSONL.
3. **Container restart** → Docker restarts it; `~/.claude` volume preserves all session state; user clicks "resume" in the UI.
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

- `WATCHDOG_STALL_MS` — how long before a silent session is considered stalled (default: 5 min)
- `LIGHTRAG_URL` — override if running LightRAG separately

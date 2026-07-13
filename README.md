# Amadeus

Browser-based Claude Code agent platform with long-lived Docker sessions, self-recovery, and integrated RAG.

## Quick Start

```bash
cp .env.example .env
# Fill in CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY

docker compose up -d
# Open http://localhost:3001
```

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

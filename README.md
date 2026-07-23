# Amadeus

Self-hosted, multi-user web platform for coding agents — Claude Code, Codex,
Cursor, and OpenCode behind one login.

Each user gets an isolated Docker container with an editor, an integrated
terminal, git, and TaskMaster-driven task management. Sessions reconnect and
resume across browser refreshes, agent crashes, and container restarts.

## Quick Start

Amadeus is multi-user. A single URL (host port 8888) serves a login page; after
login the nginx gateway routes each user to their own isolated container.

```bash
cp .env.example .env
# Set JWT_SECRET and AMADEUS_ADMIN_TOKEN (each: openssl rand -hex 32).
# LLM credentials are NOT set here — each user signs in to a provider from the
# in-app settings after first launch (see below).

# 1. Start the gateway + auth entrypoint
docker compose up -d

# 2. Register users (auth-gateway must be up)
./scripts/user.sh add alice           # prompts for a password

# 3. Bring up the per-user backends
docker compose -f docker-compose.yml -f docker-compose.multi.yml up -d

open http://localhost:8888            # log in as alice
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
┌──────────────────────────────────────────────────────────┐
│ Browser (localhost:8888)                                 │
│                                                          │
│ Sidebar            │  Editor (CodeMirror) │ Chat / WS    │
│  projects/sessions │ ─────────────────────┴──────────    │
│  file tree         │  Terminal · Tasks (bottom panel)    │
│  git panel         │                                     │
│                    split panes, all resizable            │
└──────────────────────────────────────────────────────────┘
                   │
  REST + WebSocket · /ws (chat) · /shell (terminal)
                   ▼
┌──────────────────────────────────────────────────────────┐
│ amadeus-<user> container                                 │
│                                                          │
│ server (Express + WS)                                    │
│   chat.send → DB session.provider →                      │
│   spawnFns[provider] dispatch:                           │
│     claude → claude-sdk.js   codex → openai-codex.js     │
│     cursor → cursor-cli.js   opencode → opencode-cli.js  │
│   (each also implements IProvider:                       │
│    auth/models/mcp/skills/sessions/sync)                 │
├──────────────────────────────────────────────────────────┤
│ chat-run-registry                                        │
│   seq-numbered event buffer + chat.subscribe replay      │
│   → reconnect / resume                                   │
├──────────────────────────────────────────────────────────┤
│ /home/agent volume (per-user, isolated)                  │
│   .amadeus/   auth.db, assets, todo …                    │
│               (API keys hashed, tokens encrypted)        │
│   .claude/ .codex/ .local/share/opencode/                │
│               (LLM creds, CLI-owned)                     │
└──────────────────────────────────────────────────────────┘
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
| Multi-user | One login URL; nginx routes each user to their own isolated `amadeus-<user>` container (own volume, `restart: unless-stopped`, CPU/RAM caps) |
| Session reconnect/resume | `chat-run-registry` buffers seq-numbered events; `chat.subscribe` replays what a reconnecting client missed — survives refreshes, crashes, and restarts |
| File + code editing | File tree + content search (ripgrep) + CodeMirror editor, real-time sync with agent workspace |
| Image attachments | Paste or drag images into the chat composer; uploaded and sent to the agent |
| Integrated terminal | Full pty shell in the bottom panel over a `/shell` WebSocket, scoped to the project |
| Git | Status/diff, stage, commit (with AI-generated messages), branch, fetch/pull/push from a sidebar panel |
| Task management | TaskMaster as an MCP server any agent can drive, with a built-in PRD editor and task board |
| Skills & MCP | Discover provider-native skills; read/write per-provider MCP server config from the UI |
| Command palette | `⌘K` / `Ctrl-K` fuzzy launcher for actions, files, and sessions |
| Voice | Optional push-to-talk STT + TTS proxied to any OpenAI-compatible audio backend |
| Notifications | Web Push on run finish/failure, so you can leave a long run and get pinged |
| Browser automation | Optional `browser-use` MCP sessions the agent can drive |
| Mobile / PWA | Installable (`display: standalone`) with a responsive mobile layout |

## Session Recovery Flow

A live run is tracked in the in-memory `chat-run-registry`: every outbound event
gets a monotonically increasing `seq` and is buffered. On (re)connect a client
sends `chat.subscribe` with its `lastSeq`, and the server re-attaches the stream
and replays exactly the events it missed — so recovery is provider-independent.

1. **Browser disconnect / refresh** → the new socket re-subscribes; the still-running stream re-attaches and buffered events replay from `lastSeq`.
2. **Agent process crash** → the runtime throws; the run is closed with a terminal event, and the session can be re-run with `resume` from the provider's own transcript.
3. **Container restart** → Docker restarts it; the per-user `/home/agent` volume preserves all session state; the user resumes from history in the UI.
4. **Buffer overflow / long absence** → if a client's `lastSeq` predates the buffer (bounded per run), it falls back to an authoritative REST history refresh.

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
- `AMADEUS_ADMIN_TOKEN` — authorizes account creation via `scripts/user.sh` (required for multi-user)
- `AMADEUS_DATA_DIR` — backend data dir (auth.db, assets, todo, …); defaults to `~/.amadeus`
- `WORKSPACES_ROOT` — where per-user project workspaces live (default: `~/workspace`)
- `CONTEXT_WINDOW` / `VITE_CONTEXT_WINDOW` — max tokens per session for the context meter (default: 160000)
- `AMADEUS_SHELL_CMD` — command the integrated terminal launches (default: `exec bash`; dev can point it at the host)
- `VOICE_API_BASE_URL` / `VOICE_API_KEY` / `VOICE_STT_MODEL` / `VOICE_TTS_MODEL` / `VOICE_TTS_VOICE` — optional voice backend defaults (also settable per-user in-app)
- `CLOUDCLI_BROWSER_USE_*` — optional browser-automation limits (API URL, max sessions per owner, session TTL)

## Roadmap

- **Working memory** — a per-session `trajectory` table (tools, files, and
  commands touched each turn) is scaffolded; wiring it into a cross-session
  memory the agent can recall is in progress.

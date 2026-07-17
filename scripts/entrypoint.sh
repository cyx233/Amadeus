#!/bin/bash
set -e

APP=/opt/cloudcli

mkdir -p ~/.claude/projects ~/.cloudcli ~/workspace

# Sync bundled RAG skills into the home volume (image is source of truth).
# Volume shadows the image's ~/.claude, so seed from /opt on every start.
mkdir -p ~/.claude/skills
cp -r /opt/cloudcli-skills/. ~/.claude/skills/

git config --global --add safe.directory '*'

# Optional local hook — dev mounts one to install host-forwarding shims,
# Bedrock creds, etc. Absent in multi mode.
[ -f /home/agent/entrypoint-local.sh ] && . /home/agent/entrypoint-local.sh

# Configure TaskMaster MCP server (task-master-mcp is the stdio server bin;
# `task-master --serve` was wrong — that flag doesn't exist).
node -e "
  const f = require('fs'), p = require('path');
  const cfg = p.join(process.env.HOME, '.claude.json');
  const j = f.existsSync(cfg) ? JSON.parse(f.readFileSync(cfg,'utf8')) : {};
  j.mcpServers = j.mcpServers || {};
  j.mcpServers['task-master-ai'] = { command: 'task-master-mcp', args: [] };
  f.writeFileSync(cfg, JSON.stringify(j, null, 2));
"

# Platform mode (SKIP_AUTH): seed a user so the DB isn't empty
cd "$APP"
if [ "${VITE_IS_PLATFORM}" = "true" ]; then
  # Boot server briefly to create schema
  node dist-server/server/index.js &
  PID=$!
  for i in $(seq 1 15); do
    sqlite3 ~/.cloudcli/auth.db "SELECT 1 FROM users LIMIT 1;" 2>/dev/null && break
    sleep 1
  done
  # Always ensure a user exists
  HASH=$(head -c 32 /dev/urandom | base64)
  sqlite3 ~/.cloudcli/auth.db "INSERT OR IGNORE INTO users (username, password_hash, has_completed_onboarding) VALUES ('user', '$HASH', 1);"
  kill $PID 2>/dev/null; wait $PID 2>/dev/null || true
fi

# Start server (foreground)
exec node dist-server/server/index.js

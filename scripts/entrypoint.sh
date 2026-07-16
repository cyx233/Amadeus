#!/bin/bash
set -e

mkdir -p ~/.claude/projects ~/.cloudcli

# Restore gitconfig from persistent volume (survives container recreation)
[ -f ~/.cloudcli/.gitconfig ] && cp ~/.cloudcli/.gitconfig ~/.gitconfig
git config --global --add safe.directory '*'

[ -f /home/agent/entrypoint-local.sh ] && . /home/agent/entrypoint-local.sh

# Configure TaskMaster MCP server if not already set
if ! grep -q "task-master-ai" ~/.claude.json 2>/dev/null; then
  node -e "
    const f = require('fs'), p = require('path');
    const cfg = p.join(process.env.HOME, '.claude.json');
    const j = f.existsSync(cfg) ? JSON.parse(f.readFileSync(cfg,'utf8')) : {};
    j.mcpServers = j.mcpServers || {};
    j.mcpServers['task-master-ai'] = { command: 'task-master', args: ['--serve'] };
    f.writeFileSync(cfg, JSON.stringify(j, null, 2));
  "
fi

# Platform mode (SKIP_AUTH): seed a user so the DB isn't empty
cd ~/cloudcli-src
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

# Save gitconfig to persistent volume on shutdown
save_gitconfig() { [ -f ~/.gitconfig ] && cp ~/.gitconfig ~/.cloudcli/.gitconfig; }
trap save_gitconfig TERM INT

# Start server (foreground, but not exec — so trap fires)
node dist-server/server/index.js &
wait $!

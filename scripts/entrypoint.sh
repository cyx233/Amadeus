#!/bin/bash
set -e

mkdir -p ~/.claude/projects ~/.cloudcli

# Configure AWS credential_process to read the mounted creds file
if [ -f ~/.aws/creds.json ]; then
  mkdir -p ~/.aws
  cat > ~/.aws/config << 'AWSCFG'
[default]
region = us-west-2
credential_process = cat /home/agent/.aws/creds.json
AWSCFG
  echo "[entrypoint] AWS configured (credential_process → mounted file)"
fi

# Seed Claude settings for Bedrock (only on first boot)
if [ ! -f ~/.claude/settings.json ]; then
  cat > ~/.claude/settings.json << 'SETTINGS'
{
  "env": { "AWS_REGION": "us-west-2" },
  "model": "us.anthropic.claude-sonnet-4-20250514-v1:0"
}
SETTINGS
  echo "[entrypoint] Seeded Claude settings (Bedrock)"
fi

# Seed a default user so VITE_IS_PLATFORM=true (no-login mode) works.
# The server creates the DB schema on first boot, so we start it briefly first.
cd ~/cloudcli-src

# If no user exists, insert one directly
if ! sqlite3 ~/.cloudcli/auth.db "SELECT 1 FROM users LIMIT 1;" 2>/dev/null | grep -q 1; then
  # Start server briefly to init DB schema
  node dist-server/server/index.js &
  PID=$!
  for i in $(seq 1 15); do
    sqlite3 ~/.cloudcli/auth.db "SELECT 1 FROM users LIMIT 1;" 2>/dev/null && break
    sleep 1
  done
  kill $PID 2>/dev/null; wait $PID 2>/dev/null || true

  # Insert admin user with onboarding completed
  HASH='REDACTED'
  sqlite3 ~/.cloudcli/auth.db "INSERT OR IGNORE INTO users (username, password_hash, has_completed_onboarding) VALUES ('admin', '$HASH', 1);"
  echo "[entrypoint] Seeded default admin user"
fi

# Start server (foreground)
exec node dist-server/server/index.js

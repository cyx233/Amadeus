#!/bin/bash
set -e

mkdir -p ~/.claude/projects ~/.cloudcli

# Configure AWS credential_process to read the mounted creds file
if [ -f ~/.aws/creds.json ]; then
  export AWS_CONFIG_FILE=/tmp/aws-config
  cat > "$AWS_CONFIG_FILE" << 'AWSCFG'
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

# Platform mode (SKIP_AUTH): seed a user so the DB isn't empty
cd ~/cloudcli-src
if [ "${VITE_IS_PLATFORM}" = "true" ]; then
  node dist-server/server/index.js &
  PID=$!
  for i in $(seq 1 15); do
    sqlite3 ~/.cloudcli/auth.db "SELECT 1 FROM users LIMIT 1;" 2>/dev/null | grep -q 1 && break
    sleep 1
  done
  if ! sqlite3 ~/.cloudcli/auth.db "SELECT 1 FROM users LIMIT 1;" 2>/dev/null | grep -q 1; then
    HASH=$(head -c 32 /dev/urandom | base64)
    sqlite3 ~/.cloudcli/auth.db "INSERT OR IGNORE INTO users (username, password_hash, has_completed_onboarding) VALUES ('user', '$HASH', 1);"
  fi
  kill $PID 2>/dev/null; wait $PID 2>/dev/null || true
fi

# Start server (foreground)
exec node dist-server/server/index.js

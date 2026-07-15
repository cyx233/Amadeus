#!/bin/bash
set -e

mkdir -p ~/.claude/projects ~/.cloudcli

# Use ASBX claude binary if mounted at /opt/claude-toolbox
if [ -d /opt/claude-toolbox/bin ]; then
  export PATH="/opt/claude-toolbox/bin:$PATH"
  export HOME_TOOLBOX=/opt/claude-toolbox

  # Seed settings with awsCredentialExport pointing to mounted creds
  if [ ! -f ~/.claude/settings.json ] && [ -f ~/.aws/creds.json ]; then
    cat > ~/.claude/settings.json << 'SETTINGS'
{
  "env": { "AWS_REGION": "us-west-2" },
  "model": "global.anthropic.claude-sonnet-4-20250514-v1:0",
  "awsCredentialExport": "cat /home/agent/.aws/creds.json"
}
SETTINGS
    echo "[entrypoint] Claude configured (ASBX binary + Bedrock)"
  fi
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

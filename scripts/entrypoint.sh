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

# Start server (foreground) — users register on first visit
cd ~/cloudcli-src
exec node dist-server/server/index.js

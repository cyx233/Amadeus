#!/bin/bash
set -e

mkdir -p ~/.claude/projects

# Seed settings.json on first boot (the baked-in copy has Bedrock model
# routing without host-specific paths like awsCredentialExport)
if [ ! -f ~/.claude/settings.json ]; then
  cp ~/claude-settings-seed.json ~/.claude/settings.json
fi

# Start session watchdog in background
node ~/watchdog.js &

# Start CloudCLI web server (foreground)
cd ~/cloudcli-src
exec node dist-server/server/index.js

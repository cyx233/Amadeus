#!/bin/bash
set -e

# Ensure persistent dirs exist on the volume
mkdir -p ~/.claude/scripts ~/.claude/notes ~/.claude/projects

# Start the session watchdog in background
node ~/watchdog.js &
WATCHDOG_PID=$!

# Start CloudCLI web server (foreground — container lifecycle tied to this)
cd ~/cloudcli-src
exec node dist-server/server/index.js

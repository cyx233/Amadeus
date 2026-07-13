#!/bin/bash
set -e

mkdir -p ~/.claude/projects

# Start CloudCLI web server (foreground)
cd ~/cloudcli-src
exec node dist-server/server/index.js

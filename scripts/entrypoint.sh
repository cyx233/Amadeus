#!/bin/bash
set -e

mkdir -p ~/.claude/projects ~/.cloudcli

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

  # Insert admin user (password irrelevant in platform mode, but valid bcrypt hash for "admin")
  HASH='REDACTED'
  sqlite3 ~/.cloudcli/auth.db "INSERT OR IGNORE INTO users (username, password_hash) VALUES ('admin', '$HASH');"
  echo "[entrypoint] Seeded default admin user"
fi

# Start server (foreground)
exec node dist-server/server/index.js

#!/bin/bash
# Add a new Amadeus user with container-level isolation.
# Usage: ./scripts/add-user.sh <username> [password]
#
# Creates: workspace dir, docker compose service, nginx route, htpasswd entry.

set -e

USERNAME="${1:?Usage: $0 <username> [password]}"
PASSWORD="${2:-}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-./workspaces}"
COMPOSE_FILE="docker-compose.users.yml"
HTPASSWD_FILE="gateway/htpasswd"
ROUTES_FILE="gateway/user-routes.conf"

# Prompt for password if not given
if [ -z "$PASSWORD" ]; then
  read -s -p "Password for ${USERNAME}: " PASSWORD; echo
fi

# Create workspace
mkdir -p "${WORKSPACE_ROOT}/${USERNAME}"

# Create compose file if it doesn't exist
if [ ! -f "$COMPOSE_FILE" ]; then
  cat > "$COMPOSE_FILE" << 'HEADER'
services:
  gateway:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "127.0.0.1:3001:3001"
    volumes:
      - ./gateway/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./gateway/htpasswd:/etc/nginx/htpasswd:ro
      - ./gateway/user-routes.conf:/etc/nginx/user-routes.conf:ro
    depends_on: []

HEADER
  echo "volumes:" >> "$COMPOSE_FILE"
fi

# Add user container to compose
cat >> "$COMPOSE_FILE" << EOF

  amadeus-${USERNAME}:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    container_name: amadeus-${USERNAME}
    volumes:
      - claude-data-${USERNAME}:/home/agent/.claude
      - ${WORKSPACE_ROOT}/${USERNAME}:/home/agent/workspace
    environment:
      # No API keys injected — users configure their own in the web UI (Settings)
      - DISABLE_AUTOUPDATER=1
      - WORKSPACES_ROOT=/home/agent/workspace
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

EOF

# Add volume
echo "  claude-data-${USERNAME}:" >> "$COMPOSE_FILE"

# Add gateway dependency
sed -i.bak "s/depends_on: \[\]/depends_on: [amadeus-${USERNAME}]/" "$COMPOSE_FILE" 2>/dev/null || true
rm -f "${COMPOSE_FILE}.bak"

# Add htpasswd entry (uses openssl for portability)
mkdir -p gateway
HASH=$(openssl passwd -apr1 "$PASSWORD")
echo "${USERNAME}:${HASH}" >> "$HTPASSWD_FILE"

# Add nginx route
echo "    ${USERNAME}    \"amadeus-${USERNAME}:3001\";" >> "$ROUTES_FILE"

# Update nginx.conf to include the routes file
sed -i.bak 's|# include /etc/nginx/user-routes.conf;|include /etc/nginx/user-routes.conf;|' gateway/nginx.conf 2>/dev/null || true
rm -f gateway/nginx.conf.bak

echo ""
echo "[+] User '${USERNAME}' created"
echo "    Workspace: ${WORKSPACE_ROOT}/${USERNAME}"
echo "    Container: amadeus-${USERNAME}"
echo ""
echo "Start:"
echo "  docker compose -f docker-compose.users.yml up -d"
echo ""
echo "Access: http://localhost:3001 (login as ${USERNAME})"

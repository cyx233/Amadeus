#!/bin/bash
# Add a new Amadeus user with container-level isolation.
# Usage: ./scripts/add-user.sh <username> [password]
#
# Adds: service to docker-compose.yml, nginx route, htpasswd entry, workspace dir.

set -e

USERNAME="${1:?Usage: $0 <username> [password]}"
PASSWORD="${2:-}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-./workspaces}"
HTPASSWD_FILE="gateway/htpasswd"
ROUTES_FILE="gateway/user-routes.conf"

# Prompt for password if not given
if [ -z "$PASSWORD" ]; then
  read -s -p "Password for ${USERNAME}: " PASSWORD; echo
fi

# Create workspace
mkdir -p "${WORKSPACE_ROOT}/${USERNAME}"
mkdir -p gateway

# Add htpasswd entry
HASH=$(openssl passwd -apr1 "$PASSWORD")
echo "${USERNAME}:${HASH}" >> "$HTPASSWD_FILE"

# Add nginx route mapping
echo "    ${USERNAME}    \"amadeus-${USERNAME}:3001\";" >> "$ROUTES_FILE"

# Enable the include in nginx.conf if not already
sed -i.bak 's|# include /etc/nginx/user-routes.conf;|include /etc/nginx/user-routes.conf;|' gateway/nginx.conf 2>/dev/null || true
rm -f gateway/nginx.conf.bak

# Append service + volume to docker-compose.yml (before the volumes: section)
sed -i.bak "/^volumes:/i\\
\\
  amadeus-${USERNAME}:\\
    build:\\
      context: .\\
      dockerfile: Dockerfile\\
      args:\\
        SKIP_AUTH: \"false\"\\
    restart: unless-stopped\\
    container_name: amadeus-${USERNAME}\\
    volumes:\\
      - claude-data-${USERNAME}:/home/agent/.claude\\
      - ${WORKSPACE_ROOT}/${USERNAME}:/home/agent/workspace\\
    environment:\\
      - DISABLE_AUTOUPDATER=1\\
      - WORKSPACES_ROOT=/home/agent/workspace\\
      - NODE_ENV=production\\
    healthcheck:\\
      test: [\"CMD\", \"curl\", \"-sf\", \"http://localhost:3001/api/health\"]\\
      interval: 30s\\
      timeout: 5s\\
      retries: 3\\
      start_period: 15s\\
    depends_on:\\
      lightrag:\\
        condition: service_healthy\\
    profiles: [\"multi\"]\\
" docker-compose.yml
rm -f docker-compose.yml.bak

# Add volume declaration
echo "  claude-data-${USERNAME}:" >> docker-compose.yml

echo ""
echo "[+] User '${USERNAME}' added"
echo "    Workspace: ${WORKSPACE_ROOT}/${USERNAME}"
echo "    Container: amadeus-${USERNAME}"
echo ""
echo "Start multi-user mode:"
echo "  docker compose --profile multi up -d"
echo ""
echo "Access: http://localhost:3001 (login as ${USERNAME})"

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python3-setuptools \
    curl git jq ripgrep sqlite3 tree vim-tiny \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code@latest && npm cache clean --force

# Non-root user
RUN useradd -m -s /bin/bash agent

# Install CloudCLI (the web UI)
COPY --chown=agent:agent app/ /home/agent/cloudcli-src/
WORKDIR /home/agent/cloudcli-src
USER agent
RUN npm ci --omit=dev && npm run build 2>/dev/null || true

# RAG skills
COPY --chown=agent:agent skills/ /home/agent/.claude/skills/

# Entrypoint
COPY --chown=agent:agent scripts/entrypoint.sh /home/agent/entrypoint.sh
RUN chmod +x /home/agent/entrypoint.sh

WORKDIR /home/agent
EXPOSE 3001

ENTRYPOINT ["/home/agent/entrypoint.sh"]

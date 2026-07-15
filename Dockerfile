FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python3-setuptools \
    curl git jq ripgrep sqlite3 tree vim-tiny \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI + TaskMaster globally
RUN npm install -g @anthropic-ai/claude-code@latest task-master-ai && npm cache clean --force

# Non-root user with workspace mount point
RUN useradd -m -s /bin/bash agent \
    && mkdir -p /home/agent/workspace \
    && chown agent:agent /home/agent/workspace

# Install CloudCLI (the web UI)
COPY --chown=agent:agent app/ /home/agent/cloudcli-src/
WORKDIR /home/agent/cloudcli-src
USER agent
# VITE_IS_PLATFORM=true skips login (single-user mode)
ARG SKIP_AUTH=true
RUN VITE_IS_PLATFORM=${SKIP_AUTH} npm ci && VITE_IS_PLATFORM=${SKIP_AUTH} npm run build && npm prune --omit=dev && npm cache clean --force

# RAG skills
COPY --chown=agent:agent skills/ /home/agent/.claude/skills/

# Entrypoint
COPY --chown=agent:agent scripts/entrypoint.sh /home/agent/entrypoint.sh
RUN chmod +x /home/agent/entrypoint.sh

WORKDIR /home/agent
EXPOSE 3001

ENTRYPOINT ["/home/agent/entrypoint.sh"]

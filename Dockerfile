FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python3-setuptools \
    ca-certificates curl git jq ripgrep sqlite3 tree vim-tiny \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI + TaskMaster globally
RUN npm install -g @anthropic-ai/claude-code@latest task-master-ai && npm cache clean --force

# Non-root user. /home/agent is a single mounted volume at runtime, so app
# code and entrypoint live in /opt (outside the volume) to avoid being shadowed.
RUN useradd -m -s /bin/bash agent

# Install CloudCLI (the web UI) under /opt
COPY --chown=agent:agent app/ /opt/cloudcli/
WORKDIR /opt/cloudcli
USER agent
# VITE_IS_PLATFORM=true skips login (single-user mode)
ARG SKIP_AUTH=true
RUN VITE_IS_PLATFORM=${SKIP_AUTH} npm ci && VITE_IS_PLATFORM=${SKIP_AUTH} npm run build && npm prune --omit=dev && npm cache clean --force

# RAG skills — copied into the home volume's skills dir at startup by entrypoint
COPY --chown=agent:agent skills/ /opt/cloudcli-skills/

# Entrypoint
COPY --chown=agent:agent scripts/entrypoint.sh /opt/entrypoint.sh
USER root
RUN chmod +x /opt/entrypoint.sh
USER agent

WORKDIR /home/agent
EXPOSE 3001

ENTRYPOINT ["/opt/entrypoint.sh"]

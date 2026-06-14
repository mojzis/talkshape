FROM node:26-bookworm

# System packages required by OpenCASCADE (headless) and general tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    libgl1-mesa-glx libglib2.0-0 \
    git curl \
  && rm -rf /var/lib/apt/lists/*

# Python packages (system-wide — every project shares the same CAD kernel)
RUN pip3 install --break-system-packages \
    build123d \
    b3d-validate \
    cairosvg \
    trimesh

# Non-root user (UID 1000 to match host user for mounted files like .credentials.json)
RUN userdel -r node && useradd -m -s /bin/bash -u 1000 claude
RUN mkdir -p /home/claude/.claude/skills && chown -R claude:claude /home/claude/.claude

# Claude Code CLI (native binary, installed as claude user)
USER claude
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root

# App directory
WORKDIR /workspace

# Copy and install server dependencies
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --production

# Copy server source
COPY server/ ./server/

# Projects directory (will be mounted over at runtime)
RUN mkdir -p /workspace/projects && chown -R claude:claude /workspace

USER claude
ENV PATH="/home/claude/.local/bin:$PATH"

EXPOSE 3000

CMD ["node", "server/index.js"]

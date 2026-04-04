# TalkShape

Conversational 3D modelling app — browser UI around Claude Agent SDK + build123d.

## Stack

- **Server:** Express.js (`server/index.js`), SSE for chat, WebSocket for file watching
- **Frontend:** Vanilla HTML/JS/CSS in `server/public/`, Three.js via CDN, no build step
- **Runtime:** Docker container with Node.js 20 + Python 3.12 + build123d
- **CAD skill:** Volume-mounted from `skill/` to `~/.claude/skills/build123d/` in container

## Key points

- Projects live in `projects/` — each has a thin `CLAUDE.md` and build123d Python scripts + outputs
- Claude runs with `permissionMode: "acceptEdits"` inside the container (Docker is the sandbox)
- The build123d skill handles all CAD logic — this repo is just the web shell
- `b3d_validate` provides geometry/printability validation
- No per-project venvs — build123d is installed system-wide in the Docker image

## Auth

Host's `~/.claude/.credentials.json` is mounted read-only into the container — no API key needed, uses existing Claude login.

## Running

```
docker compose up --build
```

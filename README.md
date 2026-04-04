# TalkShape

Conversational 3D modelling with Claude and build123d. A browser UI for designing 3D-printable objects through chat — type what you want, Claude writes parametric build123d Python, and the result appears as an interactive 3D preview.

## Quick start

```bash
# 1. Ensure you're logged in to Claude
claude login

# 2. Clone the build123d skill into the skill directory
git clone https://github.com/you/claude-build123d-skill skill/

# 3. Start the app
./start.sh
# or: docker compose up --build

# 4. Open in browser
open http://localhost:3000
```

Auth uses your existing Claude login (`~/.claude/.credentials.json` is mounted read-only into the container).

## How it works

- **Chat pane** (middle) — SSE stream from Claude via the Agent SDK. Multi-turn conversations persist within a session.
- **3D preview pane** (right) — Three.js STL viewer, auto-reloads via WebSocket when files change. Wireframe previews below.
- **File browser** (left) — Browse project files, download individual files or ZIP the whole project.
- **Docker container** — Node.js server + Python/build123d runtime, Claude runs with full file access inside the container.

## Features

- **Project management** — Create, switch, and delete projects from the browser
- **Multi-turn conversations** — Claude remembers context within a session
- **Sketch upload** — Attach images (📎 button or paste) and ask Claude to build from them
- **Download/export** — Download STL, STEP, Python scripts, or ZIP the entire project
- **Validation feedback** — build123d validation results shown with color-coded badges
- **Responsive** — Works on desktop, tablet, and mobile. Respects dark/light mode.

## Project structure

```
server/          Express server + frontend (vanilla HTML/JS/CSS, no build step)
skill/           build123d skill (volume-mounted into container)
projects/        Per-project directories (Python scripts, STEP/STL outputs)
docs/plans/      Build plans (3 phases)
start.sh         Convenience startup script
```

## Prerequisites

- **Docker** and Docker Compose
- **Claude CLI** logged in (`claude login`)
- **build123d skill** cloned into `skill/` directory

## Configuration

| Setting | Default | How to change |
|---------|---------|---------------|
| Port | 3000 | Set `PORT` env var or edit `docker-compose.yml` |
| Memory limit | 4 GB | Edit `mem_limit` in `docker-compose.yml` |
| CPU limit | 2 cores | Edit `cpus` in `docker-compose.yml` |
| Max concurrent chats | 2 | Edit `MAX_CONCURRENT_CHATS` in `server/index.js` |
| Chat timeout | 5 min | Edit `CHAT_TIMEOUT_MS` in `server/index.js` |

## Troubleshooting

**Container won't start**
- Check Docker is running: `docker info`
- Check credentials exist: `ls ~/.claude/.credentials.json`
- Check port 3000 isn't in use: `lsof -i :3000`

**build123d import errors**
- The Docker image installs build123d system-wide. If you see import errors, rebuild: `docker compose build --no-cache`

**Models not appearing in viewer**
- Check the browser console for WebSocket connection errors
- Ensure the project has a `.stl` file (check the file browser)
- Try clicking "Reset View" in the viewer toolbar

**Sessions lost after restart**
- Sessions are in-memory only. They're lost when the Docker container restarts. Projects and files persist.

## Dependencies

- Docker
- Claude CLI logged in (`claude login`)

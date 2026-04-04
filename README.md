# TalkShape

Conversational 3D modelling with Claude and build123d. A browser UI for designing 3D-printable objects through chat — type what you want, Claude writes parametric build123d Python, and the result appears as an interactive 3D preview.

## Quick start

```bash
docker compose up --build
```

Open `http://localhost:3000` in a browser.

Auth uses your existing Claude login (`~/.claude/.credentials.json` is mounted read-only into the container).

## How it works

- **Chat pane** (left) — SSE stream from Claude via the Agent SDK
- **3D preview pane** (right) — Three.js STL viewer, auto-reloads via WebSocket when files change
- **Docker container** — Node.js server + Python/build123d runtime, Claude runs with full file access inside the container

## Project structure

```
server/          Express server + frontend (vanilla HTML/JS/CSS, no build step)
skill/           build123d skill (volume-mounted into container)
projects/        Per-project directories (Python scripts, STEP/STL outputs)
docs/plans/      Build plans (3 phases)
```

## Dependencies

- Docker
- Claude CLI logged in (`claude login`)

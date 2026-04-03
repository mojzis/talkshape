# TalkShape

**Conversational 3D modelling with Claude and build123d.**

A lightweight web interface for designing 3D-printable objects with Claude and build123d. Runs on a home server, accessible from any browser on the local network.

## What this is

This wraps the existing **claude-build123d** ecosystem in a browser UI so people who don't use Claude Code can still design and iterate on 3D models through conversation. The user types what they want, Claude writes parametric build123d Python, and the result appears as an interactive 3D preview — all in one screen.

## What it builds on

This project does not reinvent any of the CAD tooling. It is a thin web shell around existing pieces:

- **The build123d skill** (`claude-build123d-skill` repo) — SKILL.md, API catalogue, worked examples, render_preview.py. Installed as a proper Claude Code skill at `~/.claude/skills/build123d/` inside the container (volume-mounted for live editing), loaded on demand via the Agent SDK's `settingSources: ["user", "project"]`.
- **b3d_validate** — geometry validation (3-tier) and printability checks (overhangs, wall thickness, small features). Installed as a pip package alongside build123d. Reports use `[ERR]/[WARN]` tags designed for LLM consumption.
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — the Node.js SDK that runs Claude Code sessions programmatically.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Docker container                           │
│                                             │
│  ┌──────────────────────────────────┐       │
│  │  Express server (Node.js)       │       │
│  │  - POST /api/chat  (SSE stream) │       │
│  │  - GET  /api/projects           │       │
│  │  - WS   /ws  (file watcher)     │       │
│  └──────────┬───────────────────────┘       │
│             │ spawns                        │
│  ┌──────────▼───────────────────────┐       │
│  │  Claude Agent SDK session       │       │
│  │  - cwd = /workspace/projects/X  │       │
│  │  - settingSources: [user,project]│       │
│  │  - loads skill from             │       │
│  │    ~/.claude/skills/build123d/  │       │
│  │  - writes .py, runs python,     │       │
│  │    exports .step/.stl,          │       │
│  │    runs render_preview.py,      │       │
│  │    runs b3d_validate            │       │
│  └──────────────────────────────────┘       │
│                                             │
│  Python: build123d, b3d_validate, cairosvg  │
│  Shared: /workspace/projects/               │
└─────────────────────────────────────────────┘
         │
         │  http://192.168.x.x:3000
         ▼
┌─────────────────────────────────────────────┐
│  Browser (any device on LAN)               │
│                                             │
│  ┌──────────────┐  ┌────────────────────┐  │
│  │  Chat pane   │  │  3D preview pane   │  │
│  │  (left)      │  │  (right)           │  │
│  │              │  │                    │  │
│  │  SSE stream  │  │  Three.js STL      │  │
│  │  from Claude │  │  auto-reloads      │  │
│  │              │  │  via WebSocket     │  │
│  │              │  ├────────────────────┤  │
│  │              │  │  Render previews   │  │
│  │              │  │  (wireframe PNGs)  │  │
│  └──────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Key design decisions

**SSE for chat, WebSocket for files.** Chat is request-response (user sends message, Claude streams back). File watching is push (new STL appears → browser reloads viewer). Two different patterns, two different transports.

**Docker as the sandbox.** Claude gets `permissionMode: "acceptEdits"` inside the container — full freedom to write files, run Python, execute bash. The container itself is the security boundary. No need for nested sandboxing on a trusted home network.

**The skill does all the heavy lifting.** The build123d skill (SKILL.md + API catalogue + examples + render_preview.py) is volume-mounted into the Docker image at `~/.claude/skills/build123d/` and loaded on demand via `settingSources: ["user", "project"]`. It handles everything: how to write build123d code, export conventions, validation workflow, preview generation, parametric style. b3d_validate is pip-installed alongside build123d. A one-line per-project CLAUDE.md just says "this is a TalkShape project, the build123d skill is installed."

**build123d installed system-wide.** Python and build123d are installed once in the Docker image, not per-project. There's no reason for per-project virtual environments — every project uses the same CAD kernel. This keeps project directories clean (just Python scripts, STEP/STL outputs, and a thin CLAUDE.md) and avoids complexity that family members would never want to manage.

**Three.js STL viewer.** Simplest thing that works. STL is the universal 3D printing format, Three.js STLLoader is ~40 lines of setup, orbit controls for rotation. No build step, CDN imports. We can upgrade to STEP/glTF viewing later if needed.

## Tech stack

- **Server:** Express.js, `@anthropic-ai/claude-agent-sdk`, `ws`, `chokidar`
- **Frontend:** Vanilla HTML/CSS/JS, Three.js (CDN), no build step
- **Runtime:** Docker (Node.js 20 + Python 3.12 + build123d + cairosvg)
- **Prerequisites:** Docker, an Anthropic API key

## Build plan

The project is built in three phases, each producing a usable result:

1. **Phase 1** — Chat + live STL preview. Type a description, watch Claude build it, see the 3D model.
2. **Phase 2** — Render previews + file browser. See Claude's wireframe views, browse project files, validation feedback visible in chat.
3. **Phase 3** — Project management + multi-session. Pick or create projects, maintain separate conversations, family-ready polish.

See `plan/PHASE-1.md`, `plan/PHASE-2.md`, `plan/PHASE-3.md` for detailed build instructions.

## Repository name

`talkshape`

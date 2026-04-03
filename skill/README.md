# build123d Skill

This directory should contain the `claude-build123d-skill` repository.

Clone it here:

```bash
git clone <claude-build123d-skill-repo-url> skill/
```

At runtime, docker-compose mounts this directory read-only into the container at `~/.claude/skills/build123d/`. Changes to skill files on the host are reflected immediately — no rebuild needed.

Expected contents:
- `SKILL.md` — skill definition loaded by Claude Code
- `scripts/render_preview.py` — orthographic wireframe renderer
- `references/api_catalogue.md` — build123d API reference
- `references/examples.md` — worked parametric examples

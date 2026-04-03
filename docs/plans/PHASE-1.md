# Phase 1 — Chat + Live STL Preview

**Goal:** Type a description in the browser, watch Claude stream its response, see the 3D model appear in a side panel. One screen, one Docker command to start.

**Tangible result:** A family member opens `http://<server>:3000`, types "make me a phone stand", and watches the STL model appear and rotate in the browser while Claude explains what it built.

---

## Step 1: Docker environment

Create a Dockerfile that bundles Node.js and Python with build123d in a single image.

```
Dockerfile
```

Base: `node:20-bookworm`

System packages needed:
- `python3`, `python3-pip`, `python3-venv`
- `libgl1-mesa-glx`, `libglib2.0-0` — required by OpenCASCADE even headless
- `git`, `curl`

Python packages (install with `--break-system-packages`):
- `build123d`
- `b3d_validate` — geometry validation and printability checks (install from the b3d_validate repo/package)
- `cairosvg` — for SVG-to-PNG conversion in the render preview script
- `trimesh` — for optional mesh validation in b3d_validate

Global npm package:
- `@anthropic-ai/claude-code` — the CLI, which the Agent SDK spawns internally

Create a non-root user `claude`, WORKDIR `/workspace`.

**Prepare the skill mount point in the image:**
```dockerfile
# Create the skills directory — the actual skill files are mounted at runtime
RUN mkdir -p /home/claude/.claude/skills
```
The skill content is NOT copied into the image. Instead, docker-compose mounts the skill repo directly to the discovery path. This way you can edit the skill on the host and changes are live immediately — no rebuild, no restart.

Also create a `docker-compose.yml`:
- Mount `./skill` to `/home/claude/.claude/skills/build123d` (read-only — the build123d skill, mounted directly to the Claude Code skill discovery path)
- Mount `./projects` to `/workspace/projects`
- Pass `ANTHROPIC_API_KEY` from environment
- Expose port 3000
- Resource limits: `mem_limit: 4g`, `cpus: 2`

Note: build123d and b3d_validate are installed system-wide in the image. render_preview.py lives inside the skill (mounted read-only). No separate tools directory needed. Project directories stay clean — just Python scripts, model outputs, and a one-line CLAUDE.md.

Verify the image builds and `python3 -c "from build123d import *; print('ok')"` works inside it.

---

## Step 2: Project CLAUDE.md template

Create a default `CLAUDE.md` that gets placed in every new project directory. This is **not** the skill — the skill (SKILL.md + API catalogue + examples + file template + render_preview.py) is installed at the user level and loaded on demand. b3d_validate is a pip package, importable directly.

The CLAUDE.md is just a one-liner to establish context:
```
This is a TalkShape CAD project. The build123d skill is installed — use it for all 3D modelling work.
```

That's it. Export conventions, validation workflow, render preview, parametric coding style — all handled by the skill. b3d_validate is `import`-able directly since it's pip-installed.

Also create a bare `projects/.gitkeep` and a sample project `projects/demo/` with the CLAUDE.md in it.

---

## Step 3: Express server — basic structure

Initialize the Node.js project inside a `server/` directory:

```
server/
  package.json
  index.js
  public/
    index.html
    style.css
    app.js
    vendor/       (Three.js files, or use CDN — prefer CDN for simplicity)
```

Dependencies: `express`, `ws`, `@anthropic-ai/claude-agent-sdk`, `chokidar`

The server (`index.js`) should:

1. Serve `public/` as static files
2. Serve `/projects/` as static files with `Cache-Control: no-cache` for `.stl`, `.step`, `.png`, `.svg` extensions
3. Provide `POST /api/chat` endpoint (SSE streaming — details in step 4)
4. Provide `GET /api/projects` endpoint that returns a list of project directory names
5. Set up a WebSocket server on the same HTTP server (details in step 5)
6. Listen on port 3000

---

## Step 4: Chat endpoint with Claude Agent SDK

The `POST /api/chat` endpoint receives `{ message, projectDir }` and streams Claude's response via Server-Sent Events.

```javascript
// Pseudocode for the endpoint
app.post('/api/chat', async (req, res) => {
  const { message, projectDir } = req.body;
  const projectPath = path.resolve('./projects', projectDir);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const msg of query({
      prompt: message,
      options: {
        cwd: projectPath,
        allowedTools: ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permissionMode: "acceptEdits",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "You are running inside a sandboxed Docker container for CAD design."
        },
        settingSources: ["user", "project"],
        maxTurns: 50,
      }
    })) {
      // Handle different message types
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            res.write(`data: ${JSON.stringify({ type: 'text', content: block.text })}\n\n`);
          }
          if (block.type === "tool_use") {
            res.write(`data: ${JSON.stringify({ type: 'tool', tool: block.name, input: summarizeInput(block.input) })}\n\n`);
          }
        }
      }
      if (msg.type === "result") {
        res.write(`data: ${JSON.stringify({ type: 'done', cost: msg.total_cost_usd, duration: msg.duration_ms })}\n\n`);
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  }
  res.end();
});
```

Important details:
- `summarizeInput` should truncate long tool inputs (e.g., file writes) to avoid flooding the SSE stream. Show the filename and first/last few lines, not the full content.
- `settingSources: ["user", "project"]` loads **both** the user-level skill (from `~/.claude/skills/build123d/`) and the project-level CLAUDE.md. The `"Skill"` entry in `allowedTools` enables Claude to invoke the skill on demand.
- No session management in phase 1. Each chat message is a fresh session. Multi-turn comes in phase 3.

---

## Step 5: WebSocket file watcher

Use chokidar to watch `./projects/` for new/changed `.stl`, `.png`, and `.svg` files. Broadcast changes over the WebSocket to all connected clients.

```javascript
const watcher = chokidar.watch('./projects', {
  ignored: (filePath, stats) => {
    if (stats?.isDirectory()) return false;
    return stats?.isFile() && !/\.(stl|png|svg|step)$/i.test(filePath);
  },
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 }
});

watcher.on('add', filePath => broadcast({ type: 'file-added', path: relative(filePath) }));
watcher.on('change', filePath => broadcast({ type: 'file-changed', path: relative(filePath) }));
```

The `awaitWriteFinish` is critical — STL files from build123d are written incrementally and we don't want to trigger a reload on a half-written file.

---

## Step 6: Frontend — HTML layout

Single-page layout with two panes:

```
┌─────────────────────────────────────────────────┐
│  TalkShape                      [project: demo] │
├───────────────────────┬─────────────────────────┤
│                       │                         │
│  Chat pane            │  3D Preview pane        │
│                       │                         │
│  Scrollable message   │  Three.js canvas        │
│  history              │  (orbit controls)       │
│                       │                         │
│                       │                         │
│                       │                         │
│                       │                         │
├───────────────────────┤                         │
│  [type message...] ⏎  │                         │
└───────────────────────┴─────────────────────────┘
```

Keep styling minimal — a CSS grid or flexbox two-column layout. Dark background for the 3D pane. Light or dark for chat, whichever is simpler.

Chat messages should render:
- User messages (right-aligned or distinct background)
- Claude's text (left-aligned, rendered as markdown — use a tiny markdown renderer or just `white-space: pre-wrap` for phase 1)
- Tool use indicators (collapsed by default — "Used tool: Write model.py" as a small muted line)
- Cost/duration at the end of each response

---

## Step 7: Frontend — Three.js STL viewer

Load Three.js and STLLoader from CDN (use import maps or direct script tags):
- `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`
- `https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/STLLoader.js`
- `https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js`

The viewer needs:
- A scene with a directional light + ambient light
- MeshPhongMaterial (a neutral color like `#4fc3f7` or `#8ecae6`)
- OrbitControls for mouse/touch rotation
- Auto-fit camera: after loading STL, compute the bounding box, position camera to fit
- A grid helper on the XY plane for spatial reference
- A function `loadSTL(url)` that clears the current mesh and loads a new one

Wire up the WebSocket: when a `file-changed` or `file-added` event arrives for a `.stl` file in the current project, call `loadSTL('/projects/' + path + '?t=' + Date.now())`. The cache-busting query string ensures the browser fetches the new version.

---

## Step 8: Wire it all together

The frontend `app.js` should:
1. On page load, fetch `GET /api/projects`, show the first one (or "demo") as active
2. When the user submits a message, POST to `/api/chat` with the message and project name, then read the SSE stream and append to the chat pane
3. Connect the WebSocket to `ws://host:3000/ws` and listen for file events
4. When an STL file event arrives for the current project, reload the viewer

---

## Step 9: Test the full loop

Start the Docker container, open the browser, and verify this sequence works:

1. Type "create a simple box, 50mm x 30mm x 20mm"
2. Claude's response streams into the chat pane
3. Claude writes a Python script, runs it, exports model.stl
4. The WebSocket fires, the STL viewer loads and displays the box
5. Type "add rounded corners with 3mm fillet"
6. Claude modifies the script, re-exports
7. The viewer updates with the filleted box

Also verify error cases:
- What happens if the Python script fails? Claude should see the error and retry.
- What happens if the user sends a non-CAD message? Claude should respond normally.

---

## Files at the end of Phase 1

```
talkshape/
├── Dockerfile
├── docker-compose.yml
├── server/
│   ├── package.json
│   ├── index.js
│   └── public/
│       ├── index.html
│       ├── style.css
│       └── app.js
├── skill/                    (git clone of claude-build123d-skill, mounted → ~/.claude/skills/build123d/)
│   ├── SKILL.md
│   ├── scripts/
│   │   └── render_preview.py
│   └── references/
│       ├── api_catalogue.md
│       └── examples.md
├── projects/
│   └── demo/
│       └── CLAUDE.md
└── plan/
    ├── OVERVIEW.md
    ├── PHASE-1.md
    ├── PHASE-2.md
    └── PHASE-3.md
```

# Phase 2 — Render Previews, File Browser, Validation

**Prerequisite:** Phase 1 complete and working — chat + live STL preview in browser.

**Goal:** Surface the full design feedback loop in the UI. The user sees Claude's wireframe preview images, can browse project files, and sees validation results highlighted in the chat.

**Tangible result:** After Claude builds a model, the right pane shows both the interactive 3D STL view and the wireframe preview composite PNG. Validation warnings appear as annotated badges in the chat. The user can click on any project file to view it.

---

## Step 1: Render preview display

The `render_preview.py` script (already built) produces a composite PNG with multiple orthographic wireframe views. Claude runs it as part of its workflow (instructed by CLAUDE.md). The browser just needs to display the result.

**Backend changes:**
- The file watcher (chokidar) already watches for `.png` files. No server changes needed.

**Frontend changes:**
- Below the Three.js canvas, add a "Wireframe Preview" section
- When a `.png` file event arrives (e.g., `model_preview.png` or `preview_composite.png`), display it as an `<img>` tag
- Make it clickable to open full-size in a lightbox or new tab (the composites can be dense)
- Show a timestamp: "Preview generated 3s ago"

The right pane layout becomes:

```
┌─────────────────────────┐
│  3D STL Viewer          │
│  (Three.js, ~60% height)│
├─────────────────────────┤
│  Wireframe Preview      │
│  (PNG image, ~40% height│
│   or collapsible)       │
└─────────────────────────┘
```

Make both sections resizable or collapsible. If no preview PNG exists yet, show a placeholder ("No preview yet — Claude will generate one after building").

---

## Step 2: File browser panel

Add a collapsible file browser to the left side or as a tab alongside the chat.

**Backend — new endpoint:**

```
GET /api/projects/:name/files
```

Returns a recursive directory listing of the project directory as JSON:
```json
[
  { "name": "model.py", "type": "file", "size": 1234, "modified": "2026-04-03T12:00:00Z" },
  { "name": "model.stl", "type": "file", "size": 56789, "modified": "2026-04-03T12:00:01Z" },
  { "name": "model.step", "type": "file", "size": 23456, "modified": "2026-04-03T12:00:01Z" },
  { "name": "preview_composite.png", "type": "file", "size": 8901, "modified": "2026-04-03T12:00:02Z" },
  { "name": "CLAUDE.md", "type": "file", "size": 450, "modified": "2026-04-03T09:00:00Z" }
]
```

Keep it flat (no recursive subdirectories for now). Filter out `__pycache__`, `.pyc`, and other noise.

**Backend — file content endpoint:**

```
GET /api/projects/:name/file?path=model.py
```

Returns the raw file content. For text files (`.py`, `.md`, `.txt`, `.json`), return as `text/plain`. For binary files, return the appropriate MIME type. Add a safeguard: reject paths with `..` or absolute paths.

**Frontend:**
- A file list (not a tree — flat is fine) showing filenames with icons:
  - 🐍 `.py` files
  - 🧊 `.stl` files
  - 📐 `.step` files
  - 🖼️ `.png`/`.svg` files
  - 📄 everything else
- Clicking a `.py` or `.md` file opens its content in a simple code viewer (a `<pre>` tag with syntax highlighting is fine — use Prism.js from CDN or just monospace with no highlighting)
- Clicking a `.stl` file loads it in the Three.js viewer
- Clicking a `.png`/`.svg` file shows it in the preview pane
- The file list refreshes automatically when the WebSocket reports file changes
- Show file sizes in human-readable format

---

## Step 3: Validation feedback in chat

The CLAUDE.md instructs Claude to run `b3d_validate.full_check()` and include the output. This already appears as text in Claude's chat response. But we can make it more visible.

**Frontend — message parsing:**
- When rendering Claude's text in the chat, scan for validation markers:
  - `[ERR]` lines → render with a red background/badge
  - `[WARN]` lines → render with a yellow/amber background/badge  
  - `[OK]` or `[PASS]` lines → render with a green badge
- This is a simple regex on the rendered text — no backend changes needed
- Wrap detected validation lines in a `<div class="validation-line validation-err">` (or warn/ok) for styling

**Optional enhancement:** Collapse tool-use messages by default but show validation results expanded. The chat rendering priority should be:
1. Claude's explanation text — always visible
2. Validation results — visible, color-coded
3. Tool use (file writes, bash commands) — collapsed, click to expand

---

## Step 4: Chat improvements

Phase 1 had bare-minimum chat. Improve it:

**Markdown rendering:**
- Add a lightweight markdown renderer. Options:
  - `marked` (from CDN, ~10KB) — handles code blocks, bold, links
  - Or `snarkdown` (~1KB) — even simpler
- Render Claude's text blocks through the markdown renderer
- Code blocks should have a monospace font and light background

**Tool use display:**
- Show tool calls as collapsible sections:
  ```
  ▶ Wrote model.py (24 lines)
  ▶ Ran: python model.py
  ▶ Ran: python /workspace/tools/render_preview.py model.step --composite
  ```
- Clicking expands to show the full input/output
- For `Write` tool calls, show a diff-like view or at least the filename and line count
- For `Bash` tool calls, show the command and a truncated output

**Scroll behavior:**
- Auto-scroll to bottom as new messages arrive
- Stop auto-scrolling if the user scrolls up (they're reading history)
- Resume auto-scrolling when they scroll back to bottom

**Input improvements:**
- Shift+Enter for newline, Enter to send
- Disable the input while Claude is responding
- Show a "Claude is thinking..." indicator during the response

---

## Step 5: Better STL viewer

Small improvements to the Three.js viewer:

- **Axes helper** — show X/Y/Z axes in a corner so the user knows orientation
- **Bounding box dimensions** — display the model size (e.g., "80 × 60 × 10 mm") below the viewer
- **Reset view button** — re-centers the camera to fit the model
- **Background** — subtle gradient or solid dark gray, not black
- **Screenshot** — a button that calls `renderer.domElement.toDataURL()` and downloads the image (nice for sharing)

---

## Step 6: Loading states and error handling

- When the chat is waiting for Claude, show a typing indicator
- When the STL viewer is loading a file, show a spinner in the viewer pane
- If Claude's session errors out, show the error message in the chat with a "Retry" button
- If the Docker container can't reach the Anthropic API, show a clear error on page load
- Add a health check endpoint `GET /api/health` that confirms the server is running and the API key is set

---

## Step 7: Test the full loop

Verify this sequence:

1. Open the browser, see the chat + viewer + file browser
2. Type "design a cylindrical enclosure, 60mm diameter, 40mm tall, 2mm wall, with a snap-fit lid"
3. Watch Claude stream its response with tool-use indicators
4. See the STL appear in the 3D viewer
5. See the wireframe preview PNG appear below
6. See validation results color-coded in the chat (green for OK, yellow for any wall thickness warnings)
7. Click on `model.py` in the file browser, see the parametric Python code
8. Type "make the walls 3mm thick and add ventilation holes"
9. See the viewer and preview update

---

## Files changed/added in Phase 2

```
server/
  index.js              (add /api/projects/:name/files, /api/projects/:name/file endpoints)
  public/
    index.html          (add file browser panel, wireframe preview section)
    style.css           (validation badges, file browser styling, improved layout)
    app.js              (markdown rendering, tool-use collapsing, file browser logic,
                         wireframe preview display, scroll behavior, validation parsing)
```

No changes to Docker, skill files, or tools.

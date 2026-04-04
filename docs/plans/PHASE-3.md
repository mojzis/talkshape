# Phase 3 — Project Management, Multi-Turn Sessions, Polish

**Status: IMPLEMENTED**

**Prerequisite:** Phase 2 complete — chat, STL viewer, wireframe previews, file browser, validation display all working.

**Goal:** Make it usable by the whole family without hand-holding. Multiple projects, persistent conversation history within a session, project creation from the browser, and rough edges smoothed.

**Tangible result:** A family member can create a new project called "cookie-cutter", have a multi-turn conversation with Claude to design it, come back later and continue where they left off, all without touching a terminal.

---

## Step 1: Project management

**Backend — new endpoints:**

```
POST /api/projects          { name: "cookie-cutter" }
  → Creates /workspace/projects/cookie-cutter/
  → Copies the default CLAUDE.md template into it
  → Returns { name, created: true }

DELETE /api/projects/:name
  → Moves to /workspace/projects/.trash/:name-:timestamp  (soft delete, not rm -rf)
  → Returns { name, deleted: true }
```

Validation:
- Project names: lowercase alphanumeric + hyphens only, max 50 chars
- Reject names that already exist (for create) or don't exist (for delete)
- Reject reserved names: `demo`, `.trash`

**Frontend:**
- Replace the static project selector from Phase 1 with a dropdown + "New Project" button
- "New Project" opens a simple modal: text input for the name, Create button
- Project list refreshes from `GET /api/projects`
- Switching projects:
  - Clears the chat history
  - Loads the file browser for the new project
  - Loads any existing STL from the new project into the viewer
  - Loads any existing preview PNG

---

## Step 2: Multi-turn conversation sessions

Phase 1 treated every message as a fresh Claude session. This phase adds conversation continuity using the Agent SDK's session resume mechanism.

**Backend changes:**

Store session state per project in memory (a simple Map):

```javascript
// In-memory session store
const sessions = new Map();  // projectDir → { sessionId, conversationHistory }
```

Modify `POST /api/chat`:
- If a session exists for this project, include `resume: { sessionId }` in the query options
- Capture `session_id` from the result message and store it
- Also keep a lightweight conversation history (just user messages and Claude's text responses, not full tool calls) for display purposes

**New endpoints:**

```
GET /api/projects/:name/history
  → Returns the stored conversation history for the current session
  → [ { role: "user", text: "make a box" }, { role: "assistant", text: "..." }, ... ]

DELETE /api/projects/:name/session
  → Clears the session for this project (starts fresh)
  → Returns { cleared: true }
```

**Frontend:**
- On project switch, fetch `/api/projects/:name/history` and populate the chat pane
- Add a "New Conversation" button (calls DELETE session, clears chat)
- Show session info at the top of the chat: "Conversation started 2h ago · 5 messages"

**Important caveats:**
- Sessions are in-memory only — they're lost when the Docker container restarts. This is fine for a home server. If persistence matters later, save session IDs to a JSON file in the project directory.
- The Claude Agent SDK's session resume relies on Anthropic's server-side session storage (if available for the V1 API) or requires replaying the conversation. Check the SDK docs for the exact mechanism. If session resume isn't supported, fall back to passing a condensed conversation history as part of the prompt.
- Be mindful of context window limits. If the conversation gets very long (20+ turns), Claude will handle compaction internally, but the stored history for display should still keep all messages.

---

## Step 3: Sketch upload

The sketch-to-model workflow was researched in a previous conversation. Add basic image upload support:

**Backend:**
- Add `POST /api/projects/:name/upload` endpoint
  - Accepts multipart form data with an image file
  - Saves to the project directory as `sketch.png` (or `sketch-{timestamp}.png`)
  - Returns the filename

- Modify the chat endpoint to accept an optional `imageFile` parameter
  - If present, prepend the image to the prompt so Claude can see it
  - The Agent SDK should support this via the prompt format (check docs — it may need to be passed as a multi-part content array)

**Frontend:**
- Add a 📎 button next to the chat input
- Clicking it opens a file picker for images (`.png`, `.jpg`, `.jpeg`)
- Selected image shows as a thumbnail above the input before sending
- The image is uploaded first, then the message is sent referencing it
- Alternative: support paste from clipboard (common for screenshots)

**CLAUDE.md update:**
- Add instructions: "When the user provides a sketch or image, study it carefully. Describe what you see back to the user, ask clarifying questions about dimensions and features, then build the model."

---

## Step 4: Download / export

Users will want to download their models for 3D printing.

**Frontend:**
- Add download buttons to the file browser for key file types:
  - 📥 STL — for 3D printing
  - 📥 STEP — for further CAD editing
  - 📥 Python script — to run elsewhere or modify
- Clicking triggers a download via the existing static file serving (`/projects/:name/model.stl`)
- Add a "Download All" button that fetches a ZIP (new backend endpoint)

**Backend:**

```
GET /api/projects/:name/download
  → Creates a ZIP of the project directory (excluding __pycache__, .pyc)
  → Returns it as application/zip with Content-Disposition header
```

Use `archiver` npm package, or shell out to `zip` (already in the Docker image).

---

## Step 5: Error recovery and resilience

- **Chat retry:** If a response errors out mid-stream, show a "Retry" button that resends the last user message
- **Container restart:** On server start, scan `projects/` and rebuild the file watcher. Sessions will be lost (acceptable), but projects and files persist.
- **API key check:** On startup, make a cheap API call (or just verify the key format) and log clearly if it's missing or invalid
- **Rate limiting:** Add basic rate limiting to `/api/chat` — at most 2 concurrent Claude sessions (the Agent SDK probably serializes internally, but protect against runaway tabs)
- **Timeout:** Set a maximum response time (5 minutes?) for Claude sessions. Kill and report if exceeded.

---

## Step 6: UI polish

- **Responsive layout:** Make the two-pane layout stack vertically on mobile/tablet (chat on top, viewer below). CSS media queries.
- **Dark/light mode:** Respect `prefers-color-scheme` media query. Three.js background adapts.
- **Keyboard shortcuts:**
  - `Ctrl+Enter` or `Cmd+Enter` to send message
  - `Escape` to cancel current response (if possible via AbortController on the fetch)
- **Model info bar:** Below the viewer, show: filename, file size, triangle count (from Three.js geometry), bounding box dimensions
- **Favicon:** A simple 3D cube icon
- **Page title:** Updates to show the current project name: "cookie-cutter — TalkShape"

---

## Step 7: README and startup script

Write a `README.md` for the repo with:
- What this is (one paragraph)
- Screenshot of the interface
- Prerequisites: Docker, Anthropic API key
- Quick start:
  ```bash
  git clone https://github.com/you/talkshape
  cd talkshape
  echo "ANTHROPIC_API_KEY=sk-..." > .env
  docker compose up
  # Open http://localhost:3000
  ```
- How to add the build123d skill files (git clone into `skill/`)
- How to add the tools (render_preview.py, b3d_validate — git clone or copy into `tools/`)
- Configuration options (port, resource limits)
- Troubleshooting: common Docker/build123d issues

Also create a `start.sh` convenience script:
```bash
#!/bin/bash
if [ ! -f .env ]; then
  echo "Create a .env file with ANTHROPIC_API_KEY=sk-..." && exit 1
fi
docker compose up --build
```

---

## Files changed/added in Phase 3

```
server/
  index.js              (project CRUD, session management, upload, download endpoints,
                         rate limiting, health checks)
  public/
    index.html          (project picker modal, upload button, download buttons,
                         responsive layout, dark mode)
    style.css           (responsive breakpoints, dark/light themes, polish)
    app.js              (project management, session history, image upload,
                         keyboard shortcuts, model info display)

projects/
  .trash/               (soft-delete target)

README.md               (user-facing documentation)
start.sh                (convenience startup script)
```

---

## What "done" looks like

A family member who has never used Claude Code can:
1. Open the browser on their phone/laptop
2. Create a project called "phone-stand"
3. Type "I want a phone stand that holds my phone at 60 degrees, fits on my desk"
4. Watch Claude design it, see the 3D model rotate in the viewer, see wireframe previews
5. Say "make it wider" or "add a cable hole in the back"
6. See the model update
7. Upload a napkin sketch and say "something like this"
8. Download the STL and send it to the 3D printer
9. Come back tomorrow and continue the conversation

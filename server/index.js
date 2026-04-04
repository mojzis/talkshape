import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { watch } from "chokidar";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdir, stat, readFile, mkdir, rename, writeFile, access } from "fs/promises";
import { resolve, relative, join, extname, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createReadStream } from "fs";
import multer from "multer";
import archiver from "archiver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

const PROJECTS_DIR = resolve(__dirname, "..", "projects");

// --- In-memory session store ---

const sessions = new Map(); // projectDir → { sessionId, history: [], startedAt }
let activeChatCount = 0;
const MAX_CONCURRENT_CHATS = 2;
const CHAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// --- Middleware ---

app.use(express.json());

// Static: frontend
app.use(express.static(join(__dirname, "public")));

// Static: project files (with no-cache for CAD outputs)
app.use(
  "/projects",
  (req, res, next) => {
    const ext = extname(req.path).toLowerCase();
    if ([".stl", ".step", ".png", ".svg"].includes(ext)) {
      res.setHeader("Cache-Control", "no-cache");
    }
    next();
  },
  express.static(PROJECTS_DIR)
);

// --- API: list projects ---

app.get("/api/projects", async (req, res) => {
  try {
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
    res.json(dirs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: create project ---

const RESERVED_NAMES = new Set(["demo", ".trash", "node_modules", "__pycache__"]);
const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_CLAUDE_MD =
  "This is a TalkShape CAD project. The build123d skill is installed — use it for all 3D modelling work.\n";

app.post("/api/projects", async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "name is required" });
  }
  if (name.length > 50) {
    return res.status(400).json({ error: "name must be 50 chars or fewer" });
  }
  if (!PROJECT_NAME_RE.test(name)) {
    return res
      .status(400)
      .json({ error: "name must be lowercase alphanumeric + hyphens, starting with a letter or digit" });
  }
  if (RESERVED_NAMES.has(name)) {
    return res.status(400).json({ error: `"${name}" is a reserved name` });
  }

  const projectPath = resolve(PROJECTS_DIR, name);
  try {
    await stat(projectPath);
    return res.status(409).json({ error: `project "${name}" already exists` });
  } catch {
    // Does not exist — good
  }

  try {
    await mkdir(projectPath, { recursive: true });
    await writeFile(join(projectPath, "CLAUDE.md"), DEFAULT_CLAUDE_MD);
    res.json({ name, created: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: delete project (soft delete) ---

app.delete("/api/projects/:name", async (req, res) => {
  const { name } = req.params;
  if (name.includes("..") || name.includes("/")) {
    return res.status(400).json({ error: "invalid project name" });
  }

  const projectPath = resolve(PROJECTS_DIR, name);
  try {
    await stat(projectPath);
  } catch {
    return res.status(404).json({ error: `project "${name}" not found` });
  }

  try {
    const trashDir = resolve(PROJECTS_DIR, ".trash");
    await mkdir(trashDir, { recursive: true });
    const trashDest = resolve(trashDir, `${name}-${Date.now()}`);
    await rename(projectPath, trashDest);
    // Clear any in-memory session
    sessions.delete(name);
    res.json({ name, deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: health check ---

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// --- API: project files listing ---

const FILTERED_NAMES = new Set(["__pycache__", ".pyc"]);

app.get("/api/projects/:name/files", async (req, res) => {
  const { name } = req.params;
  if (name.includes("..") || name.includes("/")) {
    return res.status(400).json({ error: "invalid project name" });
  }

  const projectPath = resolve(PROJECTS_DIR, name);
  try {
    await stat(projectPath);
  } catch {
    return res.status(404).json({ error: `project "${name}" not found` });
  }

  try {
    const entries = await readdir(projectPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (FILTERED_NAMES.has(entry.name)) continue;
      if (entry.name.endsWith(".pyc")) continue;
      if (entry.isDirectory()) continue; // flat listing only

      const filePath = resolve(projectPath, entry.name);
      const fileStat = await stat(filePath);
      files.push({
        name: entry.name,
        type: "file",
        size: fileStat.size,
        modified: fileStat.mtime.toISOString(),
      });
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: project file content ---

const MIME_MAP = {
  ".py": "text/plain",
  ".md": "text/plain",
  ".txt": "text/plain",
  ".json": "text/plain",
  ".toml": "text/plain",
  ".yaml": "text/plain",
  ".yml": "text/plain",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".stl": "application/octet-stream",
  ".step": "application/octet-stream",
  ".stp": "application/octet-stream",
};

app.get("/api/projects/:name/file", async (req, res) => {
  const { name } = req.params;
  const filePath = req.query.path;

  if (name.includes("..") || name.includes("/")) {
    return res.status(400).json({ error: "invalid project name" });
  }
  if (!filePath || filePath.includes("..") || isAbsolute(filePath) || filePath.includes("/")) {
    return res.status(400).json({ error: "invalid file path" });
  }

  const fullPath = resolve(PROJECTS_DIR, name, filePath);
  // Ensure resolved path is within project directory
  const projectPath = resolve(PROJECTS_DIR, name);
  if (!fullPath.startsWith(projectPath + "/")) {
    return res.status(400).json({ error: "invalid file path" });
  }

  try {
    await stat(fullPath);
  } catch {
    return res.status(404).json({ error: "file not found" });
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "no-cache");

  try {
    const content = await readFile(fullPath);
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: session history ---

app.get("/api/projects/:name/history", (req, res) => {
  const { name } = req.params;
  if (name.includes("..") || name.includes("/")) {
    return res.status(400).json({ error: "invalid project name" });
  }
  const session = sessions.get(name);
  res.json({
    history: session?.history || [],
    startedAt: session?.startedAt || null,
    messageCount: session?.history?.length || 0,
  });
});

app.delete("/api/projects/:name/session", (req, res) => {
  const { name } = req.params;
  if (name.includes("..") || name.includes("/")) {
    return res.status(400).json({ error: "invalid project name" });
  }
  sessions.delete(name);
  res.json({ cleared: true });
});

// --- API: sketch upload ---

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(png|jpg|jpeg|gif|webp)$/i;
    cb(null, allowed.test(file.originalname));
  },
});

app.post("/api/projects/:name/upload", upload.single("image"), async (req, res) => {
  const { name } = req.params;
  if (name.includes("..") || name.includes("/")) {
    return res.status(400).json({ error: "invalid project name" });
  }

  const projectPath = resolve(PROJECTS_DIR, name);
  try {
    await stat(projectPath);
  } catch {
    return res.status(404).json({ error: `project "${name}" not found` });
  }

  if (!req.file) {
    return res.status(400).json({ error: "no image file provided" });
  }

  const ext = extname(req.file.originalname).toLowerCase() || ".png";
  const filename = `sketch-${Date.now()}${ext}`;
  const dest = resolve(projectPath, filename);

  try {
    await writeFile(dest, req.file.buffer);
    res.json({ filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: download project as ZIP ---

app.get("/api/projects/:name/download", async (req, res) => {
  const { name } = req.params;
  if (name.includes("..") || name.includes("/")) {
    return res.status(400).json({ error: "invalid project name" });
  }

  const projectPath = resolve(PROJECTS_DIR, name);
  try {
    await stat(projectPath);
  } catch {
    return res.status(404).json({ error: `project "${name}" not found` });
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.zip"`);

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err) => res.status(500).json({ error: err.message }));
  archive.pipe(res);
  archive.glob("**/*", {
    cwd: projectPath,
    ignore: ["__pycache__/**", "*.pyc"],
  });
  archive.finalize();
});

// --- API: chat (SSE) ---

/** Truncate long tool inputs for the SSE stream. */
function summarizeInput(input) {
  if (!input) return input;
  if (typeof input === "string") {
    if (input.length > 300) {
      const lines = input.split("\n");
      return `(${lines.length} lines) ${input.slice(0, 150)}…\n…${input.slice(-100)}`;
    }
    return input;
  }
  // Object — pick useful keys, truncate content/command
  const summary = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 300) {
      const lines = value.split("\n");
      summary[key] = `(${lines.length} lines) ${value.slice(0, 150)}…`;
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

app.post("/api/chat", async (req, res) => {
  const { message, projectDir } = req.body;

  if (!message || !projectDir) {
    return res.status(400).json({ error: "message and projectDir are required" });
  }

  // Path traversal protection
  if (projectDir.includes("..") || projectDir.includes("/")) {
    return res.status(400).json({ error: "invalid projectDir" });
  }

  // Rate limiting
  if (activeChatCount >= MAX_CONCURRENT_CHATS) {
    return res.status(429).json({ error: "Too many concurrent sessions. Please wait and try again." });
  }

  const projectPath = resolve(PROJECTS_DIR, projectDir);

  try {
    await stat(projectPath);
  } catch {
    return res.status(404).json({ error: `project "${projectDir}" not found` });
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  activeChatCount++;

  // Timeout via AbortController
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), CHAT_TIMEOUT_MS);

  // Session resume
  const session = sessions.get(projectDir);
  const queryOptions = {
    cwd: projectPath,
    allowedTools: ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "acceptEdits",
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        "You are running inside a sandboxed Docker container for CAD design. " +
        "The user is talking to you through a web chat interface. " +
        "When they ask for 3D models, use the build123d skill.",
    },
    settingSources: ["user", "project"],
    maxTurns: 50,
    abortController,
  };

  // If we have a prior session, try to resume it
  if (session?.sessionId) {
    queryOptions.resume = session.sessionId;
  }

  // Track assistant text for history
  let assistantText = "";

  try {
    for await (const msg of query({ prompt: message, options: queryOptions })) {
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            assistantText += block.text;
            res.write(
              `data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`
            );
          }
          if (block.type === "tool_use") {
            res.write(
              `data: ${JSON.stringify({
                type: "tool",
                tool: block.name,
                input: summarizeInput(block.input),
              })}\n\n`
            );
          }
        }
      }
      if (msg.type === "result") {
        // Capture session ID for resume
        const sessionId = msg.session_id || session?.sessionId;
        const existing = sessions.get(projectDir);
        const history = existing?.history || [];
        history.push({ role: "user", text: message, ts: Date.now() });
        if (assistantText) {
          history.push({ role: "assistant", text: assistantText, ts: Date.now() });
        }
        sessions.set(projectDir, {
          sessionId,
          history,
          startedAt: existing?.startedAt || Date.now(),
        });

        res.write(
          `data: ${JSON.stringify({
            type: "done",
            cost: msg.total_cost_usd,
            duration: msg.duration_ms,
            subtype: msg.subtype,
          })}\n\n`
        );
      }
    }
  } catch (err) {
    const errorMsg = abortController.signal.aborted
      ? "Response timed out after 5 minutes."
      : err.message;
    res.write(
      `data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`
    );
  } finally {
    clearTimeout(timeout);
    activeChatCount--;
  }
  res.end();
});

// --- WebSocket: file watcher ---

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

const watcher = watch(PROJECTS_DIR, {
  ignored: (filePath, stats) => {
    if (stats?.isDirectory()) return false;
    return stats?.isFile() && !/\.(stl|png|svg|step)$/i.test(filePath);
  },
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
});

watcher.on("add", (filePath) => {
  broadcast({ type: "file-added", path: relative(PROJECTS_DIR, filePath) });
});
watcher.on("change", (filePath) => {
  broadcast({ type: "file-changed", path: relative(PROJECTS_DIR, filePath) });
});

// --- Startup checks ---

async function checkCredentials() {
  const credPath = join(process.env.HOME || "/home/claude", ".claude", ".credentials.json");
  try {
    await access(credPath);
    console.log("✓ Claude credentials found");
  } catch {
    console.warn("⚠ Claude credentials not found at", credPath);
    console.warn("  Auth may fail. Ensure ~/.claude/.credentials.json is mounted.");
  }
}

// --- Start ---

const PORT = process.env.PORT || 3000;
checkCredentials().then(() => {
  server.listen(PORT, () => {
    console.log(`TalkShape server listening on http://0.0.0.0:${PORT}`);
  });
});

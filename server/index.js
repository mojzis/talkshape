import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { watch } from "chokidar";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdir, stat, readFile } from "fs/promises";
import { resolve, relative, join, extname, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

const PROJECTS_DIR = resolve(__dirname, "..", "projects");

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

// --- API: health check ---

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", apiKeySet: !!process.env.ANTHROPIC_API_KEY });
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
          append:
            "You are running inside a sandboxed Docker container for CAD design. " +
            "The user is talking to you through a web chat interface. " +
            "When they ask for 3D models, use the build123d skill.",
        },
        settingSources: ["user", "project"],
        maxTurns: 50,
      },
    })) {
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
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
    res.write(
      `data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`
    );
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

// --- Start ---

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TalkShape server listening on http://0.0.0.0:${PORT}`);
});

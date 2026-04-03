import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { watch } from "chokidar";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdir, stat } from "fs/promises";
import { resolve, relative, join, extname } from "path";
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

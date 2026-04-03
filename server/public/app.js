import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ─── State ───────────────────────────────────────────────────────────────────

let currentProject = "demo";
let isSending = false;

// ─── DOM refs ────────────────────────────────────────────────────────────────

const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const projectSelect = document.getElementById("project-select");
const viewerEl = document.getElementById("viewer");
const viewerStatus = document.getElementById("viewer-status");

// ─── Three.js setup ─────────────────────────────────────────────────────────

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
camera.position.set(80, 80, 80);

const renderer = new THREE.WebGLRenderer({ antialias: true });
viewerEl.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

// Lights
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(50, 100, 80);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

// Grid
const grid = new THREE.GridHelper(200, 20, 0x444444, 0x333333);
grid.rotation.x = Math.PI / 2; // XY plane
scene.add(grid);

// Material for loaded meshes
const material = new THREE.MeshPhongMaterial({
  color: 0x4fc3f7,
  specular: 0x222222,
  shininess: 40,
});

let currentMesh = null;
const stlLoader = new STLLoader();

function resizeViewer() {
  const w = viewerEl.clientWidth;
  const h = viewerEl.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("resize", resizeViewer);
resizeViewer();
animate();

/** Load an STL from URL, replace the current mesh, auto-fit camera. */
function loadSTL(url) {
  viewerStatus.textContent = "Loading model...";
  stlLoader.load(
    url,
    (geometry) => {
      if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.geometry.dispose();
      }
      geometry.computeBoundingBox();
      geometry.center();

      currentMesh = new THREE.Mesh(geometry, material);
      scene.add(currentMesh);

      // Auto-fit camera
      const box = geometry.boundingBox;
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const fitDistance = maxDim * 1.8;

      camera.position.set(fitDistance, fitDistance, fitDistance);
      controls.target.set(0, 0, 0);
      controls.update();

      viewerStatus.textContent = `Model loaded — ${(size.x).toFixed(1)} x ${(size.y).toFixed(1)} x ${(size.z).toFixed(1)} mm`;
    },
    undefined,
    (err) => {
      viewerStatus.textContent = "Failed to load model";
      console.error("STL load error:", err);
    }
  );
}

// ─── Chat ────────────────────────────────────────────────────────────────────

function addMessage(type, content) {
  const el = document.createElement("div");
  el.className = `message message-${type}`;
  el.textContent = content;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

async function sendMessage(text) {
  if (!text.trim() || isSending) return;

  isSending = true;
  sendBtn.disabled = true;
  chatInput.disabled = true;

  addMessage("user", text);

  // Create the assistant message element for streaming
  const assistantEl = addMessage("assistant", "");
  let assistantText = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, projectDir: currentProject }),
    });

    if (!res.ok) {
      const err = await res.json();
      addMessage("error", `Error: ${err.error || res.statusText}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6);
        if (!jsonStr) continue;

        let data;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (data.type === "text") {
          assistantText += data.content;
          assistantEl.textContent = assistantText;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } else if (data.type === "tool") {
          const toolLabel = formatToolUse(data.tool, data.input);
          addMessage("tool", toolLabel);
        } else if (data.type === "done") {
          const parts = [];
          if (data.cost != null) parts.push(`Cost: $${data.cost.toFixed(4)}`);
          if (data.duration != null) parts.push(`Duration: ${(data.duration / 1000).toFixed(1)}s`);
          if (parts.length) addMessage("info", parts.join(" | "));
        } else if (data.type === "error") {
          addMessage("error", `Error: ${data.message}`);
        }
      }
    }

    // Remove empty assistant bubble if no text was received
    if (!assistantText) {
      assistantEl.remove();
    }
  } catch (err) {
    addMessage("error", `Network error: ${err.message}`);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
}

function formatToolUse(tool, input) {
  if (!input) return `Used tool: ${tool}`;
  if (typeof input === "string") return `Used tool: ${tool} — ${input.slice(0, 100)}`;
  // Object: show file_path or command if present
  const file = input.file_path || input.path || input.pattern || "";
  const cmd = input.command ? input.command.slice(0, 80) : "";
  const detail = file || cmd || JSON.stringify(input).slice(0, 100);
  return `Used tool: ${tool} — ${detail}`;
}

// ─── Form handling ───────────────────────────────────────────────────────────

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value;
  chatInput.value = "";
  sendMessage(text);
});

// Enter to send, Shift+Enter for newline
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

// ─── Project selector ────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const res = await fetch("/api/projects");
    const projects = await res.json();

    projectSelect.innerHTML = "";
    for (const name of projects) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      projectSelect.appendChild(opt);
    }

    if (projects.includes("demo")) {
      projectSelect.value = "demo";
    } else if (projects.length > 0) {
      projectSelect.value = projects[0];
    }
    currentProject = projectSelect.value;
  } catch (err) {
    console.error("Failed to load projects:", err);
  }
}

projectSelect.addEventListener("change", () => {
  currentProject = projectSelect.value;
  viewerStatus.textContent = "No model loaded";
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh = null;
  }
});

// ─── WebSocket: file watcher ─────────────────────────────────────────────────

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    const { type, path } = data;
    if ((type === "file-added" || type === "file-changed") && path) {
      // Only reload if file is in the current project
      const projectPrefix = currentProject + "/";
      if (path.startsWith(projectPrefix) && path.toLowerCase().endsWith(".stl")) {
        loadSTL(`/projects/${path}?t=${Date.now()}`);
      }
    }
  });

  ws.addEventListener("close", () => {
    // Auto-reconnect after 2 seconds
    setTimeout(connectWebSocket, 2000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

loadProjects();
connectWebSocket();
chatInput.focus();

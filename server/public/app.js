import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ─── State ───────────────────────────────────────────────────────────────────

let currentProject = "demo";
let isSending = false;
let lastMessageText = "";
let userScrolledUp = false;
let previewTimestamp = null;
let previewTimerInterval = null;

// ─── DOM refs ────────────────────────────────────────────────────────────────

const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const projectSelect = document.getElementById("project-select");
const viewerEl = document.getElementById("viewer");
const viewerStatus = document.getElementById("viewer-status");
const fileListEl = document.getElementById("file-list");
const fileBrowserToggle = document.getElementById("file-browser-toggle");
const wireframeImg = document.getElementById("wireframe-img");
const wireframePlaceholder = document.getElementById("wireframe-placeholder");
const wireframeTimestamp = document.getElementById("wireframe-timestamp");
const resetViewBtn = document.getElementById("reset-view-btn");
const screenshotBtn = document.getElementById("screenshot-btn");
const fileModal = document.getElementById("file-modal");
const fileModalTitle = document.getElementById("file-modal-title");
const fileModalBody = document.getElementById("file-modal-body");
const fileModalClose = document.getElementById("file-modal-close");

// ─── Markdown setup ─────────────────────────────────────────────────────────

if (window.marked) {
  marked.setOptions({ breaks: true, gfm: true });
}

// ─── Three.js setup ─────────────────────────────────────────────────────────

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
camera.position.set(80, 80, 80);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
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

// Axes helper
const axesHelper = new THREE.AxesHelper(30);
scene.add(axesHelper);

// Material for loaded meshes
const material = new THREE.MeshPhongMaterial({
  color: 0x4fc3f7,
  specular: 0x222222,
  shininess: 40,
});

let currentMesh = null;
let currentBoundingBox = null;
const stlLoader = new STLLoader();

function resizeViewer() {
  const w = viewerEl.clientWidth;
  const h = viewerEl.clientHeight;
  if (w === 0 || h === 0) return;
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

/** Fit camera to current model bounding box */
function fitCameraToModel() {
  if (!currentMesh) return;
  const box = new THREE.Box3().setFromObject(currentMesh);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitDistance = maxDim * 1.8;
  camera.position.set(fitDistance, fitDistance, fitDistance);
  controls.target.set(0, 0, 0);
  controls.update();
}

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

      // Store bounding box info
      const box = geometry.boundingBox;
      const size = new THREE.Vector3();
      box.getSize(size);
      currentBoundingBox = size;

      fitCameraToModel();

      viewerStatus.textContent = `${size.x.toFixed(1)} \u00d7 ${size.y.toFixed(1)} \u00d7 ${size.z.toFixed(1)} mm`;
    },
    undefined,
    (err) => {
      viewerStatus.textContent = "Failed to load model";
      console.error("STL load error:", err);
    }
  );
}

// ─── Viewer toolbar ─────────────────────────────────────────────────────────

resetViewBtn.addEventListener("click", () => {
  fitCameraToModel();
});

screenshotBtn.addEventListener("click", () => {
  // Render one frame to ensure buffer is current
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL("image/png");
  const link = document.createElement("a");
  link.download = `talkshape-${currentProject}-${Date.now()}.png`;
  link.href = dataUrl;
  link.click();
});

// ─── Smart auto-scroll ──────────────────────────────────────────────────────

messagesEl.addEventListener("scroll", () => {
  const threshold = 50;
  const atBottom = messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - threshold;
  userScrolledUp = !atBottom;
});

function scrollToBottom() {
  if (!userScrolledUp) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// ─── Validation parsing ─────────────────────────────────────────────────────

function applyValidationBadges(html) {
  // Wrap lines containing [ERR], [WARN], [OK], [PASS] in styled spans
  return html.replace(
    /^(.*\[ERR\].*)$/gm,
    '<div class="validation-err">$1</div>'
  ).replace(
    /^(.*\[WARN\].*)$/gm,
    '<div class="validation-warn">$1</div>'
  ).replace(
    /^(.*\[(OK|PASS)\].*)$/gm,
    '<div class="validation-ok">$1</div>'
  );
}

// ─── Chat ────────────────────────────────────────────────────────────────────

function addMessage(type, content) {
  const el = document.createElement("div");
  el.className = `message message-${type}`;

  if (type === "assistant" && content) {
    el.innerHTML = renderMarkdown(content);
  } else {
    el.textContent = content;
  }

  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function addToolMessage(tool, input) {
  const el = document.createElement("div");
  el.className = "message message-tool";

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = formatToolSummary(tool, input);
  details.appendChild(summary);

  const detail = document.createElement("div");
  detail.className = "tool-detail";
  detail.textContent = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  details.appendChild(detail);

  el.appendChild(details);
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function addThinkingIndicator() {
  const el = document.createElement("div");
  el.className = "message message-thinking";
  el.id = "thinking-indicator";
  el.innerHTML = 'Claude is thinking<span class="thinking-dots"></span>';
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function removeThinkingIndicator() {
  const el = document.getElementById("thinking-indicator");
  if (el) el.remove();
}

function renderMarkdown(text) {
  let html;
  if (window.marked) {
    html = marked.parse(text);
  } else {
    // Fallback: basic escaping and pre-wrap
    html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = `<p>${html}</p>`;
  }
  return applyValidationBadges(html);
}

function formatToolSummary(tool, input) {
  if (!input) return `${tool}`;

  if (tool === "Write" || tool === "Edit") {
    const file = (typeof input === "object" ? input.file_path || input.path : "") || "";
    const name = file.split("/").pop() || file;
    if (typeof input === "object" && typeof input.content === "string") {
      const lines = input.content.split("\n").length;
      return `Wrote ${name} (${lines} lines)`;
    }
    return `${tool}: ${name}`;
  }

  if (tool === "Bash") {
    const cmd = typeof input === "object" ? input.command : String(input);
    return `Ran: ${(cmd || "").slice(0, 80)}`;
  }

  if (tool === "Read") {
    const file = (typeof input === "object" ? input.file_path || input.path : String(input)) || "";
    return `Read ${file.split("/").pop() || file}`;
  }

  // Generic
  const file = typeof input === "object" ? (input.file_path || input.path || input.pattern || "") : "";
  const detail = file || (typeof input === "string" ? input.slice(0, 60) : JSON.stringify(input).slice(0, 60));
  return `${tool}: ${detail}`;
}

async function sendMessage(text) {
  if (!text.trim() || isSending) return;

  isSending = true;
  sendBtn.disabled = true;
  chatInput.disabled = true;
  lastMessageText = text;
  userScrolledUp = false;

  addMessage("user", text);
  addThinkingIndicator();

  // Create the assistant message element for streaming
  const assistantEl = document.createElement("div");
  assistantEl.className = "message message-assistant";
  let assistantText = "";
  let assistantAdded = false;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, projectDir: currentProject }),
    });

    if (!res.ok) {
      removeThinkingIndicator();
      const err = await res.json();
      addErrorMessage(`Error: ${err.error || res.statusText}`);
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
          removeThinkingIndicator();
          assistantText += data.content;
          if (!assistantAdded) {
            messagesEl.appendChild(assistantEl);
            assistantAdded = true;
          }
          assistantEl.innerHTML = renderMarkdown(assistantText);
          scrollToBottom();
        } else if (data.type === "tool") {
          removeThinkingIndicator();
          addToolMessage(data.tool, data.input);
        } else if (data.type === "done") {
          removeThinkingIndicator();
          const parts = [];
          if (data.cost != null) parts.push(`Cost: $${data.cost.toFixed(4)}`);
          if (data.duration != null) parts.push(`Duration: ${(data.duration / 1000).toFixed(1)}s`);
          if (parts.length) addMessage("info", parts.join(" | "));
        } else if (data.type === "error") {
          removeThinkingIndicator();
          addErrorMessage(`Error: ${data.message}`);
        }
      }
    }

    // Remove empty assistant bubble if no text was received
    if (!assistantText && assistantAdded) {
      assistantEl.remove();
    }
  } catch (err) {
    removeThinkingIndicator();
    addErrorMessage(`Network error: ${err.message}`);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
}

function addErrorMessage(text) {
  const el = document.createElement("div");
  el.className = "message message-error";

  const msgSpan = document.createElement("div");
  msgSpan.textContent = text;
  el.appendChild(msgSpan);

  const retryBtn = document.createElement("button");
  retryBtn.className = "retry-btn";
  retryBtn.textContent = "Retry";
  retryBtn.addEventListener("click", () => {
    if (lastMessageText && !isSending) {
      sendMessage(lastMessageText);
    }
  });
  el.appendChild(retryBtn);

  messagesEl.appendChild(el);
  scrollToBottom();
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

// ─── File browser ────────────────────────────────────────────────────────────

const FILE_ICONS = {
  ".py": "\ud83d\udc0d",
  ".stl": "\ud83e\uddca",
  ".step": "\ud83d\udcd0",
  ".stp": "\ud83d\udcd0",
  ".png": "\ud83d\uddbc\ufe0f",
  ".svg": "\ud83d\uddbc\ufe0f",
  ".jpg": "\ud83d\uddbc\ufe0f",
  ".jpeg": "\ud83d\uddbc\ufe0f",
  ".md": "\ud83d\udcc4",
};
const DEFAULT_ICON = "\ud83d\udcc4";

function getFileIcon(name) {
  const ext = "." + name.split(".").pop().toLowerCase();
  return FILE_ICONS[ext] || DEFAULT_ICON;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadFileList() {
  try {
    const res = await fetch(`/api/projects/${currentProject}/files`);
    if (!res.ok) return;
    const files = await res.json();

    fileListEl.innerHTML = "";
    for (const file of files) {
      const item = document.createElement("div");
      item.className = "file-item";
      item.dataset.name = file.name;

      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.textContent = getFileIcon(file.name);

      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = file.name;
      name.title = file.name;

      const size = document.createElement("span");
      size.className = "file-size";
      size.textContent = formatFileSize(file.size);

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(size);

      item.addEventListener("click", () => handleFileClick(file.name));
      fileListEl.appendChild(item);
    }
  } catch (err) {
    console.error("Failed to load file list:", err);
  }
}

async function handleFileClick(fileName) {
  const ext = "." + fileName.split(".").pop().toLowerCase();

  // Highlight active file
  for (const el of fileListEl.querySelectorAll(".file-item")) {
    el.classList.toggle("active", el.dataset.name === fileName);
  }

  if (ext === ".stl") {
    loadSTL(`/projects/${currentProject}/${fileName}?t=${Date.now()}`);
  } else if (ext === ".png" || ext === ".svg") {
    showWireframePreview(`/projects/${currentProject}/${fileName}?t=${Date.now()}`);
  } else {
    // Text file — show in modal
    try {
      const res = await fetch(`/api/projects/${currentProject}/file?path=${encodeURIComponent(fileName)}`);
      if (!res.ok) return;
      const text = await res.text();
      fileModalTitle.textContent = fileName;
      fileModalBody.textContent = text;
      fileModal.style.display = "flex";
    } catch (err) {
      console.error("Failed to load file:", err);
    }
  }
}

// File browser collapse toggle
fileBrowserToggle.addEventListener("click", () => {
  const app = document.getElementById("app");
  const collapsed = app.classList.toggle("file-browser-collapsed");
  fileBrowserToggle.innerHTML = collapsed ? "&rsaquo;" : "&lsaquo;";
  // Resize viewer after layout change
  setTimeout(resizeViewer, 250);
});

// File modal close
fileModalClose.addEventListener("click", () => {
  fileModal.style.display = "none";
});
fileModal.addEventListener("click", (e) => {
  if (e.target === fileModal) fileModal.style.display = "none";
});

// ─── Wireframe preview ──────────────────────────────────────────────────────

function showWireframePreview(url) {
  wireframeImg.src = url;
  wireframeImg.style.display = "block";
  wireframePlaceholder.style.display = "none";
  wireframeTimestamp.style.display = "block";
  previewTimestamp = Date.now();
  updatePreviewTimestamp();
}

function updatePreviewTimestamp() {
  if (!previewTimestamp) return;
  const seconds = Math.floor((Date.now() - previewTimestamp) / 1000);
  if (seconds < 5) {
    wireframeTimestamp.textContent = "Preview generated just now";
  } else if (seconds < 60) {
    wireframeTimestamp.textContent = `Preview generated ${seconds}s ago`;
  } else {
    const minutes = Math.floor(seconds / 60);
    wireframeTimestamp.textContent = `Preview generated ${minutes}m ago`;
  }
}

// Update timestamp every 5 seconds
previewTimerInterval = setInterval(updatePreviewTimestamp, 5000);

wireframeImg.addEventListener("click", () => {
  if (wireframeImg.src) {
    window.open(wireframeImg.src, "_blank");
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
    currentBoundingBox = null;
  }
  // Reset wireframe preview
  wireframeImg.style.display = "none";
  wireframePlaceholder.style.display = "block";
  wireframeTimestamp.style.display = "none";
  previewTimestamp = null;
  // Reload file list
  loadFileList();
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
      const projectPrefix = currentProject + "/";
      if (!path.startsWith(projectPrefix)) return;

      const fileName = path.slice(projectPrefix.length);
      const lowerPath = path.toLowerCase();

      if (lowerPath.endsWith(".stl")) {
        loadSTL(`/projects/${path}?t=${Date.now()}`);
      }

      if (lowerPath.endsWith(".png")) {
        showWireframePreview(`/projects/${path}?t=${Date.now()}`);
      }

      // Refresh file list on any file change
      loadFileList();
    }
  });

  ws.addEventListener("close", () => {
    setTimeout(connectWebSocket, 2000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

// ─── Health check ────────────────────────────────────────────────────────────

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (!data.apiKeySet) {
      const banner = document.createElement("div");
      banner.id = "health-banner";
      banner.textContent = "Warning: ANTHROPIC_API_KEY is not set. Chat will not work.";
      document.body.insertBefore(banner, document.getElementById("app"));
    }
  } catch {
    // Server not reachable — will show errors in chat
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

loadProjects().then(() => loadFileList());
connectWebSocket();
checkHealth();
chatInput.focus();

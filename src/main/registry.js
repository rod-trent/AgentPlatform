"use strict";

const fs   = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { app } = require("electron");

// ── Data directory ────────────────────────────────────────────────────────────
// Stored in Documents/AIAgentPlatform — visible to users, survives reinstalls.

const DATA_DIR     = path.join(app.getPath("documents"), "AIAgentPlatform");
const REGISTRY_FILE = path.join(DATA_DIR, "agent_registry.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Write-lock (prevents concurrent writes on the same event-loop tick) ───────
let _writing = false;

function _writeFile(data) {
  if (_writing) return; // drop if already mid-write (rare; next IPC call will persist)
  _writing = true;
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), "utf-8");
  } finally {
    _writing = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function loadRegistry() {
  ensureDataDir();
  if (!fs.existsSync(REGISTRY_FILE)) return [];
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveRegistry(registry) {
  ensureDataDir();
  _writeFile(registry);
}

/** Create a new agent and append it to the registry. Returns the created agent. */
function createAgent(payload) {
  const now = new Date().toISOString();
  const agent = {
    id:          uuidv4(),
    name:        (payload.name || "Unnamed").trim(),
    description: (payload.description || "").trim(),
    type:        payload.type === "script" ? "script" : "prompt",
    enabled:     true,
    schedule:    payload.schedule || "*/10 * * * *",
    // Prompt fields
    provider:     payload.provider     || "xai",
    model:        payload.model        || "",
    temperature:  payload.temperature  ?? 0.7,
    systemPrompt: payload.systemPrompt || "",
    userPrompt:   payload.userPrompt   || "",
    // Script fields
    command:    payload.command    || "",
    scriptPath: payload.scriptPath || "",
    args:       Array.isArray(payload.args) ? payload.args : [],
    timeoutMs:  payload.timeoutMs  || 30_000,
    // Runtime state (managed by worker)
    lastRun:    null,
    lastStatus: "idle",
    lastResult: null,
    // Metadata
    createdAt: now,
    updatedAt: now,
  };

  const registry = loadRegistry();
  registry.push(agent);
  saveRegistry(registry);
  return agent;
}

/** Merge updates into an existing agent. Returns the updated agent or null. */
function updateAgent(id, updates) {
  const registry = loadRegistry();
  const idx = registry.findIndex(a => a.id === id);
  if (idx === -1) return null;
  registry[idx] = { ...registry[idx], ...updates, id, updatedAt: new Date().toISOString() };
  saveRegistry(registry);
  return registry[idx];
}

/** Remove an agent by id. */
function deleteAgent(id) {
  const registry = loadRegistry();
  saveRegistry(registry.filter(a => a.id !== id));
}

/** Quick status/result update used by the worker after each run. */
function recordRun(id, status, result) {
  updateAgent(id, {
    lastRun:    new Date().toISOString(),
    lastStatus: status,
    lastResult: result ? String(result).slice(0, 1000) : null,
  });
}

module.exports = {
  DATA_DIR,
  loadRegistry,
  saveRegistry,
  createAgent,
  updateAgent,
  deleteAgent,
  recordRun,
};

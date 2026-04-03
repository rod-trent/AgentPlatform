"use strict";

const cron         = require("node-cron");
const { execFile } = require("child_process");
const { loadRegistry, updateAgent, recordRun } = require("./registry");
const { runPromptAgent }                       = require("./grokClient");

// ── State ─────────────────────────────────────────────────────────────────────

/** Map<agentId, CronTask>  — the authoritative record of what is scheduled. */
const activeTasks   = new Map();

/** Set<agentId>  — guards against overlapping runs of the same agent. */
const runningAgents = new Set();

/** Reference to the BrowserWindow, for pushing status events to the renderer. */
let _win = null;

/** Full settings object — needed by runPromptAgent to pick the right provider/key. */
let _settings = null;

// ── Internal helpers ──────────────────────────────────────────────────────────

function _push(channel, payload) {
  if (_win && !_win.isDestroyed()) {
    _win.webContents.send(channel, payload);
  }
}

function _log(msg) {
  const ts = new Date().toISOString();
  console.log(`[worker ${ts}] ${msg}`);
}

function _runScriptAgent(agent) {
  return new Promise((resolve, reject) => {
    const args = [
      ...(agent.scriptPath ? [agent.scriptPath] : []),
      ...(Array.isArray(agent.args) ? agent.args : []),
    ];
    const cmd     = agent.command || "python";
    const timeout = agent.timeoutMs || 30_000;

    execFile(cmd, args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else     resolve((stdout || stderr || "(no output)").trim());
    });
  });
}

async function _executeAgent(agentId) {
  if (runningAgents.has(agentId)) {
    _log(`[${agentId}] skipped — previous run still in progress`);
    return;
  }

  // Re-read the agent fresh from disk so we always have the latest prompts/settings.
  const registry = loadRegistry();
  const agent    = registry.find(a => a.id === agentId);
  if (!agent || !agent.enabled) return;

  runningAgents.add(agentId);
  const started = Date.now();

  // Tell the UI we're running
  updateAgent(agentId, { lastStatus: "running" });
  _push("agent:statusChanged", { id: agentId, status: "running", timestamp: new Date().toISOString() });

  let status = "success";
  let result = "";

  try {
    if (agent.type === "prompt") {
      result = await runPromptAgent(agent, _settings);
    } else if (agent.type === "script") {
      result = await _runScriptAgent(agent);
    }
  } catch (err) {
    status = "error";
    result = err.message || String(err);
    _log(`[${agent.name}] error: ${result}`);
  }

  const duration = Date.now() - started;
  recordRun(agentId, status, result);
  _push("agent:runComplete", { id: agentId, status, result, duration, timestamp: new Date().toISOString() });
  _log(`[${agent.name}] ${status} in ${duration}ms`);

  runningAgents.delete(agentId);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Call once at startup, passing the BrowserWindow reference for push events. */
function init(win) {
  _win = win;
}

/** Update the settings used for LLM API calls. Call whenever settings change. */
function setSettings(settings) {
  _settings = settings;
  // Propagate to the LLM client so it re-creates its cached clients
  const llm = require("./grokClient");
  llm.configure(settings);
}

/**
 * Rebuild the entire cron schedule from the current registry.
 * Stops orphaned tasks and adds/updates tasks as needed.
 */
function rebuildSchedule() {
  const agents = loadRegistry();

  // Stop tasks for agents that are gone or disabled
  for (const [id, task] of activeTasks) {
    const agent = agents.find(a => a.id === id);
    if (!agent || !agent.enabled) {
      task.stop();
      activeTasks.delete(id);
    }
  }

  // Add / update tasks for enabled agents
  for (const agent of agents) {
    if (!agent.enabled) continue;

    const existing = activeTasks.get(agent.id);
    // Only reschedule if the expression changed (avoid unnecessary churn)
    if (existing && existing._expr === agent.schedule) continue;
    if (existing) existing.stop();

    if (!cron.validate(agent.schedule)) {
      _log(`[${agent.name}] invalid cron expression "${agent.schedule}" — skipped`);
      continue;
    }

    const task = cron.schedule(
      agent.schedule,
      () => _executeAgent(agent.id),
      { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    );
    task._expr = agent.schedule; // stash for change-detection above
    activeTasks.set(agent.id, task);
    _log(`[${agent.name}] scheduled "${agent.schedule}"`);
  }
}

/** Immediately execute a single agent, regardless of its schedule. */
function triggerAgent(agentId) {
  _executeAgent(agentId);
}

/** Stop all scheduled tasks (e.g., on app quit or worker stop). */
function stopAll() {
  for (const task of activeTasks.values()) task.stop();
  activeTasks.clear();
  _log("All tasks stopped");
}

/** How many agents are currently scheduled. */
function scheduledCount() {
  return activeTasks.size;
}

/** Is a given agent currently mid-run? */
function isRunning(agentId) {
  return runningAgents.has(agentId);
}

module.exports = { init, setSettings, rebuildSchedule, triggerAgent, stopAll, scheduledCount, isRunning };

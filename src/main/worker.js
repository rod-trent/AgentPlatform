"use strict";

const cron               = require("node-cron");
const { execFile }       = require("child_process");
const { Notification }   = require("electron");
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

/**
 * Resolve template variables in a prompt string.
 * Supported: {{date}}, {{time}}, {{datetime}}, {{dayOfWeek}},
 *            {{year}}, {{month}}, {{day}}, {{lastResult}},
 *            {{env:VAR_NAME}}
 */
function resolveVariables(text, context) {
  if (!text) return text;
  const now  = new Date();
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  return text
    .replace(/\{\{date\}\}/gi,       now.toLocaleDateString())
    .replace(/\{\{time\}\}/gi,       now.toLocaleTimeString())
    .replace(/\{\{datetime\}\}/gi,   now.toLocaleString())
    .replace(/\{\{dayOfWeek\}\}/gi,  days[now.getDay()])
    .replace(/\{\{year\}\}/gi,       String(now.getFullYear()))
    .replace(/\{\{month\}\}/gi,      String(now.getMonth() + 1).padStart(2, "0"))
    .replace(/\{\{day\}\}/gi,        String(now.getDate()).padStart(2, "0"))
    .replace(/\{\{lastResult\}\}/gi, context?.lastResult || "")
    .replace(/\{\{env:([^}]+)\}\}/gi, (_, name) => process.env[name.trim()] || "");
}

/**
 * Determine whether a chain should fire based on chainCondition.
 * Condition values: "success" (default), "always", "error", "contains:<keyword>"
 */
function _chainShouldFire(agent, status, result) {
  const cond = (agent.chainCondition || "success").trim();
  if (cond === "always")  return true;
  if (cond === "success") return status === "success";
  if (cond === "error")   return status === "error";
  if (cond.startsWith("contains:")) {
    const keyword = cond.slice("contains:".length).trim().toLowerCase();
    return keyword.length > 0 && typeof result === "string" && result.toLowerCase().includes(keyword);
  }
  return status === "success";
}

/** Send a native Windows toast notification (if the system supports it). */
function _notify(title, body, type) {
  if (!_settings?.notificationsEnabled) return;
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title,
      body,
      // urgency maps to Windows notification level
      urgency: type === "error" ? "critical" : "normal",
    });
    n.show();
  } catch (err) {
    _log(`notification error: ${err.message}`);
  }
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

/**
 * Execute a single agent by ID.
 * @param {string} agentId
 * @param {string|null} chainedInput  If set, overrides the agent's userPrompt for this run.
 */
async function _executeAgent(agentId, chainedInput = null) {
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
      // Build effective agent: chained input overrides userPrompt, then resolve variables
      const context = { lastResult: chainedInput || agent.lastResult || "" };
      const effectiveAgent = {
        ...agent,
        systemPrompt: resolveVariables(agent.systemPrompt, context),
        userPrompt:   resolveVariables(
          chainedInput != null ? String(chainedInput) : agent.userPrompt,
          context
        ),
      };
      result = await runPromptAgent(effectiveAgent, _settings);
    } else if (agent.type === "script") {
      result = await _runScriptAgent(agent);
    }
  } catch (err) {
    status = "error";
    result = err.message || String(err);
    _log(`[${agent.name}] error: ${result}`);
  }

  // Append powered-by footer to successful outputs
  if (status === "success" && result) {
    result = `${result}\n\n---\n✦ *${agent.name}* is Powered by the **AI Agent Platform**`;
  }

  const duration = Date.now() - started;
  recordRun(agentId, status, result, duration);
  _push("agent:runComplete", { id: agentId, status, result, duration, timestamp: new Date().toISOString() });
  _log(`[${agent.name}] ${status} in ${duration}ms`);

  // Windows toast notification
  if (status === "success") {
    _notify("AI Agent Platform", `✓ ${agent.name} completed`, "success");
  } else {
    _notify("AI Agent Platform", `✗ ${agent.name} failed`, "error");
  }

  runningAgents.delete(agentId);

  // ── Agent chaining ─────────────────────────────────────────────────────────
  // Fire chained agents based on chainCondition (default: success only)
  if (Array.isArray(agent.chainTo) && agent.chainTo.length && _chainShouldFire(agent, status, result)) {
    for (const chainId of agent.chainTo) {
      _log(`[${agent.name}] chaining to ${chainId} (condition: ${agent.chainCondition || "success"})`);
      // Small delay so the UI can update before the next run starts
      setTimeout(() => _executeAgent(chainId, result), 300);
    }
  }
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

/**
 * Run an agent config directly without it being saved — used for the Test feature.
 * Returns { status, result }.
 */
async function testAgentConfig(config, settings) {
  const effectiveSettings = settings || _settings;
  let status = "success";
  let result = "";
  try {
    if (config.type === "prompt") {
      result = await runPromptAgent(config, effectiveSettings);
    } else if (config.type === "script") {
      result = await _runScriptAgent(config);
    } else {
      result = "(unknown agent type)";
    }
  } catch (err) {
    status = "error";
    result = err.message || String(err);
  }
  return { status, result };
}

module.exports = {
  init, setSettings, rebuildSchedule, triggerAgent, stopAll,
  scheduledCount, isRunning, testAgentConfig,
};

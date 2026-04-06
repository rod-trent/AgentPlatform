"use strict";

const fs   = require("fs");
const path = require("path");
const { DATA_DIR } = require("./registry");

const HISTORY_DIR  = path.join(DATA_DIR, "history");
const MAX_ENTRIES  = 50;

function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function historyFile(agentId) {
  return path.join(HISTORY_DIR, `${agentId}.json`);
}

/** Load history entries for an agent. Returns [] if none. */
function loadHistory(agentId) {
  ensureHistoryDir();
  const file = historyFile(agentId);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Append a new run result to an agent's history file (newest first, capped at MAX_ENTRIES). */
function appendHistory(agentId, status, result) {
  ensureHistoryDir();
  const entries = loadHistory(agentId);
  entries.unshift({
    timestamp: new Date().toISOString(),
    status,
    result: result ? String(result).slice(0, 50_000) : null,
  });
  // Keep only the most recent MAX_ENTRIES
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  try {
    fs.writeFileSync(historyFile(agentId), JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    console.error(`[history] failed to write ${agentId}: ${err.message}`);
  }
}

/** Delete history file when an agent is deleted. */
function deleteHistory(agentId) {
  const file = historyFile(agentId);
  if (fs.existsSync(file)) {
    try { fs.unlinkSync(file); } catch {}
  }
}

module.exports = { loadHistory, appendHistory, deleteHistory };

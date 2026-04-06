"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * window.agentAPI — the only surface exposed to the renderer.
 *
 * All invoke calls return Promises.
 * Push subscriptions register a callback; call removeAllListeners to clean up.
 */
contextBridge.exposeInMainWorld("agentAPI", {

  // ── Registry ──────────────────────────────────────────────────────────────
  listAgents:   ()           => ipcRenderer.invoke("agents:list"),
  createAgent:  (data)       => ipcRenderer.invoke("agents:create",  data),
  updateAgent:  (data)       => ipcRenderer.invoke("agents:update",  data),
  deleteAgent:  (id)         => ipcRenderer.invoke("agents:delete",  { id }),
  toggleAgent:  (id, enabled)=> ipcRenderer.invoke("agents:toggle",  { id, enabled }),
  runNow:       (id)         => ipcRenderer.invoke("agents:runNow",  { id }),

  // ── Test (run without saving) ─────────────────────────────────────────────
  testAgent:    (config)     => ipcRenderer.invoke("agents:test", config),

  // ── Run history ───────────────────────────────────────────────────────────
  getAgentHistory: (id)      => ipcRenderer.invoke("agents:getHistory", { id }),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings:  ()     => ipcRenderer.invoke("settings:get"),
  saveSettings: (data) => ipcRenderer.invoke("settings:set", data),
  getProviders: ()     => ipcRenderer.invoke("settings:getProviders"),

  // ── Worker ────────────────────────────────────────────────────────────────
  startWorker:     ()        => ipcRenderer.invoke("worker:start"),
  stopWorker:      ()        => ipcRenderer.invoke("worker:stop"),
  getWorkerStatus: ()        => ipcRenderer.invoke("worker:status"),

  // ── App info ──────────────────────────────────────────────────────────────
  getVersion:   () => ipcRenderer.invoke("app:getVersion"),

  // ── Import / Export ───────────────────────────────────────────────────────
  exportAgents: (ids) => ipcRenderer.invoke("agents:export", { ids }),
  importAgents: () => ipcRenderer.invoke("agents:import"),

  // ── Shell ─────────────────────────────────────────────────────────────────
  openDataDir:              ()           => ipcRenderer.invoke("shell:openDataDir"),
  openFilePicker:           ()           => ipcRenderer.invoke("shell:openFilePicker"),
  openMarkdownInBrowser:    (md, title)  => ipcRenderer.invoke("shell:openMarkdownInBrowser", { markdown: md, title }),

  // ── Clipboard ─────────────────────────────────────────────────────────────
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),

  // ── Agent Packs ───────────────────────────────────────────────────────────
  fetchAgentPacks: (url)  => ipcRenderer.invoke("packs:fetch",  { url }),
  importAgentPack: (pack) => ipcRenderer.invoke("packs:import", { pack }),

  // ── Push events (main → renderer) ────────────────────────────────────────
  onStatusChanged:  (cb) => ipcRenderer.on("agent:statusChanged", (_e, d) => cb(d)),
  onRunComplete:    (cb) => ipcRenderer.on("agent:runComplete",   (_e, d) => cb(d)),
  onWorkerStatus:   (cb) => ipcRenderer.on("worker:status",       (_e, d) => cb(d)),
  onAgentsUpdated:  (cb) => ipcRenderer.on("agents:updated",      (_e, d) => cb(d)),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});

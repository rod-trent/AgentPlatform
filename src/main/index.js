"use strict";

// Suppress the punycode deprecation warning emitted by transitive dependencies
// (openai SDK → whatwg-url → punycode). Overriding emitWarning is the only
// reliable way — process.on("warning") doesn't suppress the default output.
const _origEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const msg = typeof warning === "string" ? warning : (warning?.message || "");
  if (msg.includes("punycode")) return;
  _origEmitWarning(warning, ...args);
};

const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, shell, dialog, safeStorage,
} = require("electron");
const path = require("path");
const fs   = require("fs");
const zlib = require("zlib");
const cron = require("node-cron");

const registry   = require("./registry");
const history    = require("./history");
const worker     = require("./worker");
const webhook    = require("./webhook");
const llmClient  = require("./grokClient");
const { PROVIDERS } = llmClient;

// ── Single-instance lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  }
});

// ── Settings file ─────────────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(registry.DATA_DIR, "settings.json");

// ── API key encryption (safeStorage — OS keychain-backed) ────────────────────
const ENC_PREFIX = "enc:";

function encryptApiKey(plain) {
  if (!plain) return plain;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(plain).toString("base64");
    }
  } catch { /* fall through — store plaintext */ }
  return plain;
}

function decryptApiKey(stored) {
  if (!stored) return stored;
  if (!stored.startsWith(ENC_PREFIX)) return stored; // already plaintext (migration)
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), "base64"));
    }
  } catch { /* corrupted — return empty */ }
  return "";
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE))
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {}
  // Return defaults on first run — migrate legacy apiKey if present
  return {};
}

function saveSettingsFile(data) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Build the full normalised settings object, merging stored config with
 * env-var fallbacks (GROK_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY).
 */
function buildEffectiveSettings() {
  const stored = loadSettings();

  // Migrate legacy single-key format
  if (stored.apiKey && !stored.providers) {
    stored.providers = { xai: { apiKey: stored.apiKey } };
    delete stored.apiKey;
  }

  const providers = stored.providers || {};

  // Decrypt stored API keys (handles both enc: and legacy plaintext)
  for (const [id, cfg] of Object.entries(providers)) {
    if (cfg.apiKey) providers[id] = { ...cfg, apiKey: decryptApiKey(cfg.apiKey) };
  }

  // Env-var fallbacks (never overwrite an explicitly stored key)
  const envDefaults = {
    xai:       process.env.GROK_API_KEY      || process.env.XAI_API_KEY || "",
    openai:    process.env.OPENAI_API_KEY    || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
  };
  for (const [id, envKey] of Object.entries(envDefaults)) {
    if (envKey && !providers[id]?.apiKey) {
      providers[id] = { ...(providers[id] || {}), apiKey: envKey };
    }
  }

  return {
    defaultProvider:       stored.defaultProvider       || "xai",
    minimizeToTray:        stored.minimizeToTray        !== false, // default true
    notificationsEnabled:  stored.notificationsEnabled  !== false, // default true
    packsUrl:              stored.packsUrl              || "https://raw.githubusercontent.com/rod-trent/AgentPlatform/main/packs/index.json",
    webhookEnabled:        stored.webhookEnabled        || false,
    webhookPort:           stored.webhookPort           || 7171,
    providers,
  };
}

function hasAnyApiKey() {
  const s = buildEffectiveSettings();
  return Object.values(s.providers).some(p => p.apiKey);
}

// ── Icon generator ────────────────────────────────────────────────────────────
// Renders a gradient rounded-square with a robot face — matches the in-app
// brand logo.  Works at any size; used for both the tray and the window icon.

// Shared CRC-32 table (PNG chunk integrity)
const _CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function _crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = _CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function _pngChunk(type, data) {
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
  const tp  = Buffer.from(type, "ascii");
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(_crc32(Buffer.concat([tp, data])), 0);
  return Buffer.concat([len, tp, data, crc]);
}

function buildRobotIconPng(size) {
  // Raw RGBA scanlines: each row = 1 filter byte + size×4 bytes
  const raw = Buffer.alloc(size * (1 + size * 4));
  const cr  = Math.max(2, Math.round(size * 0.15)); // corner radius

  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // PNG filter: None
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;

      // Rounded-corner alpha mask
      const edgeX = Math.max(0, cr - x, x - (size - 1 - cr));
      const edgeY = Math.max(0, cr - y, y - (size - 1 - cr));
      if (edgeX > 0 && edgeY > 0 && edgeX * edgeX + edgeY * edgeY > cr * cr) {
        raw[i + 3] = 0; // transparent corner
        continue;
      }

      // Diagonal gradient: #60cdff (top-left) → #8e64ff (bottom-right)
      const t    = (x + y) / (2 * (size - 1));
      raw[i]     = Math.round(0x60 + t * (0x8e - 0x60)); // R
      raw[i + 1] = Math.round(0xcd + t * (0x64 - 0xcd)); // G
      raw[i + 2] = 0xff;                                  // B
      raw[i + 3] = 0xff;                                  // A (fully opaque)

      // Robot face elements — draw in white over the gradient
      const fx = x / size, fy = y / size;

      // Eyes: two circles
      const eyeR = 0.085;
      if (Math.hypot(fx - 0.33, fy - 0.44) < eyeR ||
          Math.hypot(fx - 0.67, fy - 0.44) < eyeR) {
        raw[i] = raw[i + 1] = raw[i + 2] = 0xff;
        continue;
      }

      // Mouth: filled rectangle
      if (fx >= 0.27 && fx <= 0.73 && fy >= 0.63 && fy <= 0.70) {
        raw[i] = raw[i + 1] = raw[i + 2] = 0xff;
        continue;
      }

      // Antenna (only meaningful at ≥ 24 px)
      if (size >= 24) {
        // Ball at tip
        if (Math.hypot(fx - 0.5, fy - 0.10) < 0.055) {
          raw[i] = raw[i + 1] = raw[i + 2] = 0xff;
          continue;
        }
        // Stem
        if (Math.abs(fx - 0.5) < 0.028 && fy > 0.13 && fy < 0.24) {
          raw[i] = raw[i + 1] = raw[i + 2] = 0xff;
          continue;
        }
      }
    }
  }

  // Encode as RGBA PNG (color-type 6)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit-depth=8, RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    _pngChunk("IHDR", ihdr),
    _pngChunk("IDAT", zlib.deflateSync(raw)),
    _pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Icon cache — generated once per size, reused thereafter
const _iconCache = new Map();
function getAppIcon(size) {
  if (!_iconCache.has(size)) {
    // Prefer a hand-crafted .ico / .png in assets/ if the user placed one
    const assetPath = path.join(
      process.resourcesPath || path.join(__dirname, "../../"),
      "assets", size <= 32 ? "tray.png" : "icon.png"
    );
    if (fs.existsSync(assetPath)) {
      _iconCache.set(size, nativeImage.createFromPath(assetPath));
    } else {
      _iconCache.set(size, nativeImage.createFromBuffer(buildRobotIconPng(size)));
    }
  }
  return _iconCache.get(size);
}

function createTrayIcon() {
  return getAppIcon(32);
}

// ── App state ─────────────────────────────────────────────────────────────────
let mainWindow   = null;
let tray         = null;
let isQuitting   = false;
let workerActive = false;

// ── BrowserWindow ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1180,
    height: 820,
    minWidth:  900,
    minHeight: 620,
    backgroundColor: "#0f0f17",
    icon: getAppIcon(256),
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
      // Only allow file:// pages to talk IPC
      additionalArguments: [],
    },
    title: "AI Agent Platform",
    show:  false,
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => {
    // When launched at Windows startup, stay hidden in the tray (if minimizeToTray is on)
    const wasLaunchedAtStartup = app.getLoginItemSettings().wasOpenedAtLogin;
    const settings = buildEffectiveSettings();
    if (wasLaunchedAtStartup && settings.minimizeToTray) {
      // Window stays hidden; tray is available to open it
      return;
    }
    mainWindow.show();
  });

  // Close → hide to tray (if enabled) or quit
  mainWindow.on("close", (e) => {
    if (!isQuitting && buildEffectiveSettings().minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Pass the window reference to the worker so it can push events
  worker.init(mainWindow);
}

// ── System tray ───────────────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(createTrayIcon());

  const showAbout = () => dialog.showMessageBox(mainWindow, {
    type:    "info",
    icon:    getAppIcon(64),
    title:   "About AI Agent Platform",
    message: "AI Agent Platform",
    detail:  `Version ${app.getVersion()}\n\nMulti-provider AI automation for Windows.\n\nCopyright © 2025 Rod Trent`,
    buttons: ["OK"],
  });

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: "Open AI Agent Platform",
      click: () => { mainWindow?.show(); mainWindow?.focus(); },
    },
    { type: "separator" },
    {
      label: workerActive ? "Stop Scheduler" : "Start Scheduler",
      click: () => workerActive ? _stopWorker() : _startWorker(),
    },
    { type: "separator" },
    { label: "About", click: showAbout },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        worker.stopAll();
        webhook.stop();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(buildMenu());
  tray.setToolTip("AI Agent Platform");
  tray.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });

  // Rebuild menu when worker state changes so Start/Stop label stays correct
  app.on("worker-state-changed", () => tray.setContextMenu(buildMenu()));
}

// ── Worker start/stop ─────────────────────────────────────────────────────────
function _startWorker() {
  if (!hasAnyApiKey()) {
    return { ok: false, error: "No API keys configured. Open Settings and add at least one provider key." };
  }
  const settings = buildEffectiveSettings();
  worker.setSettings(settings);
  worker.rebuildSchedule();
  workerActive = true;
  app.emit("worker-state-changed");
  mainWindow?.webContents.send("worker:status", { running: true, scheduledCount: worker.scheduledCount() });
  return { ok: true };
}

function _stopWorker() {
  worker.stopAll();
  workerActive = false;
  app.emit("worker-state-changed");
  mainWindow?.webContents.send("worker:status", { running: false, scheduledCount: 0 });
  return { ok: true };
}

// ── Markdown → HTML converter (no external dependencies) ─────────────────────
function buildMarkdownHtml(markdown, title) {
  // Escape HTML entities first, then selectively un-escape for markdown
  function esc(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  const lines = markdown.split("\n");
  let html = "";
  let inCode = false;
  let inUl   = false;
  let inOl   = false;

  function closeList() {
    if (inUl) { html += "</ul>\n"; inUl = false; }
    if (inOl) { html += "</ol>\n"; inOl = false; }
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      if (inCode) { html += "</code></pre>\n"; inCode = false; }
      else        { closeList(); html += "<pre><code>"; inCode = true; }
      continue;
    }
    if (inCode) { html += esc(line) + "\n"; continue; }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      closeList(); html += "<hr/>\n"; continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      closeList();
      const level = h[1].length;
      html += `<h${level}>${inlineFormat(esc(h[2]))}</h${level}>\n`;
      continue;
    }

    // Unordered list
    const ul = line.match(/^[ \t]*[-*+]\s+(.*)/);
    if (ul) {
      if (!inUl) { closeList(); html += "<ul>\n"; inUl = true; }
      html += `<li>${inlineFormat(esc(ul[1]))}</li>\n`;
      continue;
    }

    // Ordered list
    const ol = line.match(/^[ \t]*\d+\.\s+(.*)/);
    if (ol) {
      if (!inOl) { closeList(); html += "<ol>\n"; inOl = true; }
      html += `<li>${inlineFormat(esc(ol[1]))}</li>\n`;
      continue;
    }

    // Blank line → close lists / paragraph break
    if (line.trim() === "") {
      closeList();
      html += "<br/>\n";
      continue;
    }

    closeList();
    html += `<p>${inlineFormat(esc(line))}</p>\n`;
  }
  if (inCode) html += "</code></pre>\n";
  closeList();

  function inlineFormat(s) {
    return s
      // Bold+italic
      .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
      // Bold
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Links (URLs already escaped)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  body{font-family:"Segoe UI",system-ui,sans-serif;font-size:15px;line-height:1.7;
       max-width:820px;margin:40px auto;padding:0 24px;color:#1a1a2e;background:#f7f8fc}
  h1,h2,h3,h4{font-weight:600;margin:1.4em 0 0.4em;color:#0d0d1a}
  h1{font-size:2em;border-bottom:2px solid #dee2e6;padding-bottom:0.3em}
  h2{font-size:1.5em;border-bottom:1px solid #dee2e6;padding-bottom:0.2em}
  h3{font-size:1.25em}
  p{margin:0.6em 0}
  ul,ol{margin:0.6em 0;padding-left:1.8em}
  li{margin:0.25em 0}
  pre{background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.5}
  code{font-family:"Cascadia Code","Fira Code",Consolas,monospace}
  p code,li code{background:#e8eaf0;padding:2px 5px;border-radius:4px;font-size:0.9em;color:#d63031}
  strong{font-weight:600}em{font-style:italic}
  a{color:#0078d4;text-decoration:none}a:hover{text-decoration:underline}
  hr{border:none;border-top:1px solid #dee2e6;margin:1.5em 0}
  .meta{font-size:12px;color:#888;margin-bottom:24px;padding-bottom:12px;border-bottom:1px solid #dee2e6}
</style>
</head>
<body>
<div class="meta">Generated by AI Agent Platform · ${new Date().toLocaleString()}</div>
${html}
</body>
</html>`;
}

/** Fetch JSON from a URL using Node's built-in https/http. Follows one redirect. */
function _fetchJson(url, _redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? require("https") : require("http");
    const headers = {
      "User-Agent": "AI-Agent-Platform/1.0",
      "Accept":     "application/vnd.github.v3+json, application/json, */*",
    };
    mod.get(url, { headers }, (res) => {
      // Follow redirects (301/302/307/308), but only once
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && _redirectCount < 3) {
        res.resume();
        resolve(_fetchJson(res.headers.location, _redirectCount + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume(); return;
      }
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("Invalid JSON in response")); }
      });
    }).on("error", reject);
  });
}

// ── Webhook management ────────────────────────────────────────────────────────
function _applyWebhookSettings(settings) {
  if (settings.webhookEnabled) {
    webhook.start(settings.webhookPort, (agentId) => {
      worker.setSettings(buildEffectiveSettings());
      worker.triggerAgent(agentId);
    });
  } else {
    webhook.stop();
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
function registerIpcHandlers() {
  // Guard: only accept messages from our own renderer page
  function guard(event) {
    return event.senderFrame?.url?.startsWith("file://");
  }

  // Agents
  ipcMain.handle("agents:list", (e) => {
    if (!guard(e)) return [];
    return registry.loadRegistry();
  });

  ipcMain.handle("agents:create", (e, data) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    if (!cron.validate(data.schedule || ""))
      return { success: false, error: "Invalid cron expression." };
    if (!data.name?.trim())
      return { success: false, error: "Name is required." };
    const existing = registry.loadRegistry().find(a => a.name === data.name.trim());
    if (existing)
      return { success: false, error: `An agent named "${data.name.trim()}" already exists.` };

    const agent = registry.createAgent(data);
    if (workerActive) worker.rebuildSchedule();
    mainWindow?.webContents.send("agents:updated", registry.loadRegistry());
    return { success: true, agent };
  });

  ipcMain.handle("agents:update", (e, data) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    if (data.schedule && !cron.validate(data.schedule))
      return { success: false, error: "Invalid cron expression." };

    const { id, ...updates } = data;
    const agent = registry.updateAgent(id, updates);
    if (!agent) return { success: false, error: "Agent not found." };
    if (workerActive) worker.rebuildSchedule();
    mainWindow?.webContents.send("agents:updated", registry.loadRegistry());
    return { success: true, agent };
  });

  ipcMain.handle("agents:delete", (e, { id }) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    registry.deleteAgent(id);
    if (workerActive) worker.rebuildSchedule();
    mainWindow?.webContents.send("agents:updated", registry.loadRegistry());
    mainWindow?.webContents.send("worker:status", { running: workerActive, scheduledCount: worker.scheduledCount() });
    return { success: true };
  });

  ipcMain.handle("agents:toggle", (e, { id, enabled }) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    const agent = registry.updateAgent(id, { enabled });
    if (!agent) return { success: false, error: "Agent not found." };
    if (workerActive) worker.rebuildSchedule();
    mainWindow?.webContents.send("agents:updated", registry.loadRegistry());
    mainWindow?.webContents.send("worker:status", { running: workerActive, scheduledCount: worker.scheduledCount() });
    return { success: true, agent };
  });

  ipcMain.handle("agents:runNow", (e, { id }) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    if (!hasAnyApiKey()) return { success: false, error: "No API key configured. Open Settings." };
    worker.setSettings(buildEffectiveSettings());
    worker.triggerAgent(id);
    return { success: true };
  });

  // Test an agent config without saving it
  ipcMain.handle("agents:test", async (e, config) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    if (!hasAnyApiKey() && config.type === "prompt")
      return { success: false, error: "No API key configured. Open Settings." };
    worker.setSettings(buildEffectiveSettings());
    const { status, result } = await worker.testAgentConfig(config, buildEffectiveSettings());
    return { success: true, status, result };
  });

  // Get run history for a single agent
  ipcMain.handle("agents:getHistory", (e, { id }) => {
    if (!guard(e)) return [];
    return history.loadHistory(id);
  });

  // Get aggregated analytics for all agents
  ipcMain.handle("agents:getAnalytics", (e) => {
    if (!guard(e)) return {};
    const agents = registry.loadRegistry();
    const result = {};
    for (const agent of agents) {
      const entries = history.loadHistory(agent.id);
      const total      = entries.length;
      const successes  = entries.filter(en => en.status === "success").length;
      const durations  = entries.map(en => en.duration).filter(d => d > 0);
      const avgDuration = durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
      result[agent.id] = {
        name:         agent.name,
        type:         agent.type,
        total,
        successes,
        failures:     total - successes,
        successRate:  total ? Math.round((successes / total) * 100) : null,
        avgDuration,
        lastRun:      agent.lastRun,
        lastStatus:   agent.lastStatus,
      };
    }
    return result;
  });

  // Open markdown text as a pretty HTML page in the default browser
  ipcMain.handle("shell:openMarkdownInBrowser", async (e, { markdown, title }) => {
    if (!guard(e)) return { success: false };
    const os   = require("os");
    const html  = buildMarkdownHtml(markdown || "", title || "Agent Output");
    const tmpFile = path.join(os.tmpdir(), `agent-output-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, "utf-8");
    await shell.openExternal(`file://${tmpFile}`);
    return { success: true };
  });

  // Read clipboard text
  ipcMain.handle("clipboard:read", (e) => {
    if (!guard(e)) return "";
    const { clipboard } = require("electron");
    return clipboard.readText();
  });

  // Fetch agent packs index from a URL
  ipcMain.handle("packs:fetch", async (e, { url } = {}) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    const packsUrl = url || buildEffectiveSettings().packsUrl;
    try {
      const data = await _fetchJson(packsUrl);
      const packs = Array.isArray(data) ? data : (data?.packs || []);
      return { success: true, packs };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Agent Store: list available agents from GitHub Samples
  ipcMain.handle("store:fetch", async (e) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    try {
      const data = await _fetchJson(
        "https://api.github.com/repos/rod-trent/AgentPlatform/contents/Samples"
      );
      const files = Array.isArray(data)
        ? data.filter(f => f.type === "file" && f.name.toLowerCase().endsWith(".json"))
        : [];
      return { success: true, files };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Agent Store: fetch a single agent file by its download_url
  ipcMain.handle("store:getAgent", async (e, { url }) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    if (!url || !url.startsWith("https://")) return { success: false, error: "Invalid URL." };
    try {
      const data = await _fetchJson(url);
      let agentList = [];
      if (Array.isArray(data))    agentList = data;
      else if (data?.agents)      agentList = data.agents;
      else if (data?.name)        agentList = [data];
      return { success: true, agents: agentList };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Import all agents from a pack object { agents: [...] }
  ipcMain.handle("packs:import", (e, { pack }) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };
    if (!pack?.agents?.length) return { success: false, error: "Pack contains no agents." };

    const existing     = registry.loadRegistry();
    const existingNames = new Set(existing.map(a => a.name.toLowerCase()));
    let imported = 0;
    const skipped = [];

    for (const raw of pack.agents) {
      if (!raw?.name?.trim()) { skipped.push("(unnamed)"); continue; }
      if (existingNames.has(raw.name.trim().toLowerCase())) {
        skipped.push(raw.name.trim()); continue;
      }
      registry.createAgent(raw);
      existingNames.add(raw.name.trim().toLowerCase());
      imported++;
    }

    if (workerActive) worker.rebuildSchedule();
    const updated = registry.loadRegistry();
    mainWindow?.webContents.send("agents:updated", updated);
    mainWindow?.webContents.send("worker:status", { running: workerActive, scheduledCount: worker.scheduledCount() });
    return { success: true, imported, skipped };
  });

  // Settings
  ipcMain.handle("settings:get", (e) => {
    if (!guard(e)) return {};
    const s = buildEffectiveSettings();
    // Mask API keys — never expose raw values to the renderer
    const maskedProviders = {};
    for (const [id, cfg] of Object.entries(s.providers)) {
      const key = cfg.apiKey || "";
      maskedProviders[id] = {
        ...cfg,
        apiKey:       key ? "••••••••" : "",
        apiKeyIsSet:  !!key,
        // Include the first 8 + last 4 chars so users can verify which key is set
        apiKeyHint:   key.length > 12 ? key.slice(0, 8) + "…" + key.slice(-4) : (key ? "••••••••" : ""),
      };
    }
    // Read run-at-startup state directly from Windows (source of truth)
    const runAtStartup = app.getLoginItemSettings().openAtLogin;
    return {
      defaultProvider:      s.defaultProvider,
      minimizeToTray:       s.minimizeToTray,
      notificationsEnabled: s.notificationsEnabled,
      packsUrl:             s.packsUrl,
      runAtStartup,
      webhookEnabled:       s.webhookEnabled,
      webhookPort:          s.webhookPort,
      providers: maskedProviders,
    };
  });

  ipcMain.handle("settings:set", (e, data) => {
    if (!guard(e)) return { success: false };
    const current = loadSettings();
    // Migrate legacy format
    if (current.apiKey && !current.providers) {
      current.providers = { xai: { apiKey: current.apiKey } };
      delete current.apiKey;
    }
    if (data.defaultProvider) current.defaultProvider = data.defaultProvider;
    if (typeof data.minimizeToTray === "boolean") current.minimizeToTray = data.minimizeToTray;
    if (typeof data.notificationsEnabled === "boolean") current.notificationsEnabled = data.notificationsEnabled;
    if (typeof data.packsUrl === "string" && data.packsUrl) current.packsUrl = data.packsUrl;
    if (typeof data.runAtStartup === "boolean") {
      // Apply immediately to the Windows Run registry key
      app.setLoginItemSettings({ openAtLogin: data.runAtStartup });
    }
    if (typeof data.webhookEnabled === "boolean") current.webhookEnabled = data.webhookEnabled;
    if (typeof data.webhookPort === "number" && data.webhookPort > 0) current.webhookPort = data.webhookPort;
    if (data.providers) {
      current.providers = current.providers || {};
      for (const [id, cfg] of Object.entries(data.providers)) {
        if (!current.providers[id]) current.providers[id] = {};
        // Only overwrite the key if the user actually typed a new one (not a masked placeholder)
        if (cfg.apiKey && !cfg.apiKey.startsWith("••")) {
          // Encrypt before storing
          current.providers[id].apiKey = encryptApiKey(cfg.apiKey);
        }
        if (cfg.baseUrl !== undefined) current.providers[id].baseUrl = cfg.baseUrl;
      }
    }
    saveSettingsFile(current);
    // Push updated settings into the worker/client immediately
    const effective = buildEffectiveSettings();
    worker.setSettings(effective);
    // Apply webhook changes
    _applyWebhookSettings(effective);
    return { success: true };
  });

  // Expose provider definitions to the renderer (no secrets, just metadata)
  ipcMain.handle("settings:getProviders", (e) => {
    if (!guard(e)) return {};
    return Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, p]) => [id, {
        name:        p.name,
        baseUrl:     p.baseUrl,
        requiresKey: p.requiresKey,
        models:      p.models,
      }])
    );
  });

  // Worker
  ipcMain.handle("worker:start",  (e) => guard(e) ? _startWorker()  : { ok: false });
  ipcMain.handle("worker:stop",   (e) => guard(e) ? _stopWorker()   : { ok: false });
  ipcMain.handle("worker:status", (e) => {
    if (!guard(e)) return { running: false, scheduledCount: 0 };
    return { running: workerActive, scheduledCount: worker.scheduledCount() };
  });

  // App info
  ipcMain.handle("app:getVersion", (e) => {
    if (!guard(e)) return "";
    return app.getVersion();
  });

  // Export agents to a user-chosen JSON file
  ipcMain.handle("agents:export", async (e, { ids } = {}) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };

    const all = registry.loadRegistry();
    const agents = ids?.length ? all.filter(a => ids.includes(a.id)) : all;
    if (!agents.length) return { success: false, error: "No agents to export." };

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Export Agents",
      defaultPath: `ai-agents-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };

    // Strip volatile runtime state — export only the definition fields
    const exportable = agents.map(({ id, name, description, type, enabled, schedule,
      provider, model, temperature, systemPrompt, userPrompt,
      command, scriptPath, args, timeoutMs, chainTo, chainCondition, createdAt }) => ({
      id, name, description, type, enabled, schedule,
      provider, model, temperature, systemPrompt, userPrompt,
      command, scriptPath, args, timeoutMs,
      chainTo: chainTo || [], chainCondition: chainCondition || "success", createdAt,
    }));

    const payload = {
      exportedBy:  "AI Agent Platform",
      version:     app.getVersion(),
      exportedAt:  new Date().toISOString(),
      agents:      exportable,
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return { success: true, count: exportable.length, filePath };
  });

  // Import agents from a JSON file previously exported by this app
  ipcMain.handle("agents:import", async (e) => {
    if (!guard(e)) return { success: false, error: "Unauthorized" };

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Import Agents",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths.length) return { success: false, canceled: true };

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePaths[0], "utf-8"));
    } catch {
      return { success: false, error: "Could not read file. Make sure it is a valid JSON export." };
    }

    // Accept either the envelope format { agents: [...] } or a bare array
    const incoming = Array.isArray(parsed) ? parsed : parsed?.agents;
    if (!Array.isArray(incoming) || !incoming.length) {
      return { success: false, error: "No agents found in the selected file." };
    }

    const existing = registry.loadRegistry();
    const existingNames = new Set(existing.map(a => a.name.toLowerCase()));

    let imported = 0;
    const skipped = [];

    for (const raw of incoming) {
      if (!raw?.name?.trim()) { skipped.push("(unnamed)"); continue; }
      if (existingNames.has(raw.name.trim().toLowerCase())) {
        skipped.push(raw.name.trim()); continue;
      }
      registry.createAgent(raw);
      existingNames.add(raw.name.trim().toLowerCase());
      imported++;
    }

    if (workerActive) worker.rebuildSchedule();
    const updated = registry.loadRegistry();
    mainWindow?.webContents.send("agents:updated", updated);
    mainWindow?.webContents.send("worker:status", { running: workerActive, scheduledCount: worker.scheduledCount() });

    return { success: true, imported, skipped };
  });

  // Shell
  ipcMain.handle("shell:openDataDir", (e) => {
    if (!guard(e)) return;
    shell.openPath(registry.DATA_DIR);
  });

  ipcMain.handle("shell:openFilePicker", async (e) => {
    if (!guard(e)) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [
        { name: "Scripts", extensions: ["py", "js", "ts", "bat", "cmd", "ps1", "sh", "exe"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

// ── Native application menu ───────────────────────────────────────────────────
function createAppMenu() {
  const showAboutMenu = () => dialog.showMessageBox({
    type:    "info",
    icon:    getAppIcon(64),
    title:   "About AI Agent Platform",
    message: "AI Agent Platform",
    detail:  `Version ${app.getVersion()}\n\nMulti-provider AI automation for Windows.\n\nCopyright © 2025 Rod Trent`,
    buttons: ["OK"],
  });

  const template = [
    {
      label: "Help",
      submenu: [
        { label: `About AI Agent Platform v${app.getVersion()}`, click: showAboutMenu },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Seed provider settings into worker/client at startup
  const effectiveSettings = buildEffectiveSettings();
  worker.setSettings(effectiveSettings);
  _applyWebhookSettings(effectiveSettings);

  createAppMenu();
  registerIpcHandlers();
  createWindow();
  createTray();
});

// Keep running in the tray when all windows are closed
app.on("window-all-closed", (e) => {
  if (!isQuitting) e.preventDefault();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

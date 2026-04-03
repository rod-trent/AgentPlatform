"use strict";

// ── State ─────────────────────────────────────────────────────────────────────
let agents          = [];
let workerActive    = false;
let formType        = "prompt";
let editingAgentId  = null;   // non-null when the sidebar is in edit mode
let PROVIDERS     = {};          // keyed by providerId, populated on init
let activeSettingsProvider = ""; // which chip is selected in the settings dialog

// ── Bootstrap ─────────────────────────────────────────────────────────────────
(async function init() {
  // Load providers first — everything else depends on them
  PROVIDERS = await window.agentAPI.getProviders();

  const [agentList, status] = await Promise.all([
    window.agentAPI.listAgents(),
    window.agentAPI.getWorkerStatus(),
  ]);

  agents       = agentList;
  workerActive = status.running;

  populateFormProviders();
  updateWorkerPill(status.running, status.scheduledCount);
  renderAgentList();

  // Push subscriptions from main process
  window.agentAPI.onStatusChanged(({ id, status: s }) => patchAgent(id, { lastStatus: s }));

  window.agentAPI.onRunComplete(({ id, status: s, result }) => {
    patchAgent(id, { lastStatus: s, lastResult: result });
    const a = agents.find(x => x.id === id);
    toast(
      s === "error" ? `✗ ${a?.name}: failed` : `✓ ${a?.name}: done`,
      s === "error" ? "error" : "success",
    );
  });

  window.agentAPI.onWorkerStatus(({ running, scheduledCount }) => {
    workerActive = running;
    updateWorkerPill(running, scheduledCount);
  });
})();

// ── Provider helpers ──────────────────────────────────────────────────────────

/** Populate the provider dropdown and model list in the Add-Agent form. */
function populateFormProviders() {
  const sel = document.getElementById("f-provider");
  if (!sel) return;
  sel.innerHTML = Object.entries(PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${p.name}</option>`)
    .join("");
  // Set default to first provider
  if (sel.options.length) onProviderChange();
}

/** Called when the agent-form provider dropdown changes. */
function onProviderChange() {
  const providerId = document.getElementById("f-provider")?.value;
  const provider   = PROVIDERS[providerId];
  const modelSel   = document.getElementById("f-model");
  const customWrap = document.getElementById("f-model-custom-wrap");

  if (!provider || !modelSel) return;

  const hasKnownModels = provider.models && provider.models.length > 0;
  modelSel.innerHTML = hasKnownModels
    ? provider.models.map(m => `<option value="${m}">${m}</option>`).join("")
      + `<option value="__custom__">Other…</option>`
    : `<option value="__custom__">Enter model name…</option>`;

  modelSel.onchange = () => {
    customWrap.style.display = modelSel.value === "__custom__" ? "" : "none";
  };
  customWrap.style.display = hasKnownModels ? "none" : "";
}

function getSelectedModel() {
  const modelSel = document.getElementById("f-model");
  if (!modelSel) return "";
  if (modelSel.value === "__custom__") {
    return document.getElementById("f-model-custom")?.value.trim() || "";
  }
  return modelSel.value;
}

// ── Worker pill ───────────────────────────────────────────────────────────────
function updateWorkerPill(running, count) {
  workerActive = running;
  const pill     = document.getElementById("worker-pill");
  const label    = document.getElementById("worker-label");
  const btnIcon  = document.getElementById("worker-btn-icon");
  const btnLabel = document.getElementById("worker-btn-label");
  if (!pill) return;

  if (running) {
    pill.classList.add("running");
    label.textContent    = count ? `Running — ${count} scheduled` : "Running";
    btnIcon.textContent  = "⏹";
    btnLabel.textContent = "Stop";
  } else {
    pill.classList.remove("running");
    label.textContent    = "Scheduler Stopped";
    btnIcon.textContent  = "▶";
    btnLabel.textContent = "Start";
  }
}

document.getElementById("btn-toggle-worker").addEventListener("click", async () => {
  if (workerActive) {
    await window.agentAPI.stopWorker();
    toast("Scheduler stopped.", "info");
  } else {
    const res = await window.agentAPI.startWorker();
    if (res.ok) {
      const s = await window.agentAPI.getWorkerStatus();
      updateWorkerPill(true, s.scheduledCount);
      agents = await window.agentAPI.listAgents();
      renderAgentList();
      toast(`Scheduler started — ${s.scheduledCount} agent(s) scheduled.`, "success");
    } else {
      toast(res.error || "Could not start. Configure a provider in Settings.", "error");
    }
  }
});

// ── Render ────────────────────────────────────────────────────────────────────
function renderAgentList() {
  const list    = document.getElementById("agent-list");
  const empty   = document.getElementById("empty-state");
  const countEl = document.getElementById("agent-count");
  countEl.textContent = `${agents.length} agent${agents.length !== 1 ? "s" : ""}`;

  if (agents.length === 0) {
    list.innerHTML = ""; list.style.display = "none";
    empty.style.display = "flex"; return;
  }
  list.style.display = "flex"; empty.style.display = "none";
  list.innerHTML = agents.map(cardHTML).join("");
}

function patchAgent(id, updates) {
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return;
  agents[idx] = { ...agents[idx], ...updates };
  const el = document.getElementById(`card-${id}`);
  if (el) el.outerHTML = cardHTML(agents[idx]);
}

// ── Card HTML ─────────────────────────────────────────────────────────────────
function cardHTML(a) {
  const dotClass   = statusDotClass(a.lastStatus);
  const statusLine = formatStatusLine(a.lastStatus, a.lastRun);
  const provider   = PROVIDERS[a.provider] || {};
  const typeBadge  = a.type === "script"
    ? `<span class="fluent-badge badge-script">Script</span>`
    : `<span class="fluent-badge badge-prompt">Prompt</span>`;
  const provBadge  = a.type === "prompt"
    ? `<span class="fluent-badge" style="background:rgba(255,255,255,0.07);color:var(--text-secondary)">${esc(provider.name || a.provider || "")}</span>`
    : "";
  const hasOutput = !!(a.lastResult);
  const outputId  = `out-${a.id}`;

  return `
<div class="agent-card" id="card-${a.id}">
  <div class="card-row-top">
    <div class="status-indicator ${dotClass}"></div>
    <div class="card-info">
      <div class="card-name">${esc(a.name)}</div>
      <div class="card-meta">
        ${typeBadge}${provBadge}
        <span class="card-meta-item">⏱ ${esc(a.schedule)}</span>
        ${a.lastRun ? `<span class="card-meta-item">↻ ${timeAgo(a.lastRun)}</span>` : ""}
        ${a.model ? `<span class="card-meta-item" style="font-family:monospace">${esc(a.model)}</span>` : ""}
      </div>
      ${a.description ? `<div style="font-size:12px;color:var(--text-tertiary);margin-top:3px">${esc(a.description)}</div>` : ""}
    </div>
    <div class="fluent-toggle">
      <label class="f-toggle" title="${a.enabled ? "Disable" : "Enable"}">
        <input type="checkbox" ${a.enabled ? "checked" : ""}
               data-action="toggle" data-id="${a.id}" />
        <div class="f-track"></div>
        <div class="f-thumb"></div>
      </label>
    </div>
  </div>
  <div class="card-row-bottom">
    <span class="card-status-text ${dotClass}">${statusLine}</span>
    ${hasOutput ? `<button class="card-btn" data-action="output" data-target="${outputId}">Output</button>` : ""}
    <button class="card-btn" data-action="edit" data-id="${a.id}">✎ Edit</button>
    <button class="card-btn run" data-action="run" data-id="${a.id}">▶ Run Now</button>
    <button class="card-btn del" data-action="delete" data-id="${a.id}">✕</button>
  </div>
  ${hasOutput ? `<div class="card-output" id="${outputId}">${esc(a.lastResult)}</div>` : ""}
</div>`;
}

function statusDotClass(s) {
  if (!s || s === "idle")     return "idle";
  if (s === "running")        return "running";
  if (s === "success")        return "success";
  if (s?.startsWith("error")) return "error";
  return "idle";
}

function formatStatusLine(s, lastRun) {
  if (!s || s === "idle")     return "Never run";
  if (s === "running")        return "Running…";
  if (s === "success")        return `Completed${lastRun ? "  ·  " + timeAgo(lastRun) : ""}`;
  if (s?.startsWith("error")) return s;
  return s;
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Card actions ──────────────────────────────────────────────────────────────
function toggleOutput(outputId) {
  document.getElementById(outputId)?.classList.toggle("open");
}

async function toggleAgent(id, enabled) {
  const res = await window.agentAPI.toggleAgent(id, enabled);
  if (!res.success) { toast(res.error, "error"); return; }
  const idx = agents.findIndex(a => a.id === id);
  if (idx !== -1) agents[idx].enabled = enabled;
}

async function runNow(id) {
  if (!workerActive) {
    const start = await window.agentAPI.startWorker();
    if (!start.ok) { toast(start.error || "Configure a provider in Settings first.", "error"); return; }
  }
  const res = await window.agentAPI.runNow(id);
  if (!res.success) toast(res.error, "error");
  else              toast("Agent triggered!", "info");
}

async function deleteAgent(id) {
  const a = agents.find(x => x.id === id);
  const ok = await showConfirm(`"${a?.name}" will be permanently deleted.`, "Delete Agent");
  if (!ok) return;
  const res = await window.agentAPI.deleteAgent(id);
  if (res.success) {
    agents = agents.filter(x => x.id !== id);
    renderAgentList();
    toast("Agent deleted.");
  } else {
    toast(res.error, "error");
  }
}

// ── Edit Agent ────────────────────────────────────────────────────────────────
function editAgent(id) {
  const a = agents.find(x => x.id === id);
  if (!a) return;

  editingAgentId = id;

  // Switch sidebar to edit mode
  document.getElementById("pane-title").textContent = "Edit Agent";
  document.getElementById("pane-sub").textContent   = a.name;
  document.getElementById("btn-add-agent").textContent  = "✔  Save Changes";
  document.getElementById("btn-cancel-edit").style.display = "";

  // Set form type (switches visible fields)
  setFormType(a.type === "script" ? "script" : "prompt");

  // Populate shared fields
  document.getElementById("f-name").value = a.name;
  document.getElementById("f-desc").value = a.description || "";

  // Schedule
  const sched = document.getElementById("f-schedule-pick");
  const knownOption = [...sched.options].find(o => o.value === a.schedule);
  if (knownOption) {
    sched.value = a.schedule;
    document.getElementById("custom-cron-row").style.display = "none";
  } else {
    sched.value = "custom";
    document.getElementById("f-cron").value = a.schedule;
    document.getElementById("custom-cron-row").style.display = "";
  }

  if (a.type === "prompt") {
    document.getElementById("f-system").value = a.systemPrompt || "";
    document.getElementById("f-user").value   = a.userPrompt   || "";
    document.getElementById("f-temp").value   = a.temperature  ?? 0.7;
    document.getElementById("temp-val").textContent = a.temperature ?? 0.7;

    // Set provider then rebuild model list to match
    const provSel = document.getElementById("f-provider");
    if (a.provider && provSel) {
      provSel.value = a.provider;
      onProviderChange();
      // Now pick the saved model
      const modelSel = document.getElementById("f-model");
      const knownModel = [...modelSel.options].find(o => o.value === a.model);
      if (knownModel) {
        modelSel.value = a.model;
        document.getElementById("f-model-custom-wrap").style.display = "none";
      } else {
        modelSel.value = "__custom__";
        document.getElementById("f-model-custom").value = a.model || "";
        document.getElementById("f-model-custom-wrap").style.display = "";
      }
    }
  } else {
    document.getElementById("f-command").value     = a.command    || "";
    document.getElementById("f-script-path").value = a.scriptPath || "";
    document.getElementById("f-timeout").value     = Math.round((a.timeoutMs || 30000) / 1000);
  }

  clearFormError();
  document.getElementById("sidebar-body").scrollTop = 0;
}

// ── Add Agent form ────────────────────────────────────────────────────────────
function setFormType(type) {
  formType = type;
  document.getElementById("tab-prompt").classList.toggle("active", type === "prompt");
  document.getElementById("tab-script").classList.toggle("active", type === "script");
  document.getElementById("prompt-fields").style.display = type === "prompt" ? "" : "none";
  document.getElementById("script-fields").style.display = type === "script" ? "" : "none";
}

function onScheduleChange() {
  const v = document.getElementById("f-schedule-pick").value;
  document.getElementById("custom-cron-row").style.display = v === "custom" ? "" : "none";
}

function getSchedule() {
  const v = document.getElementById("f-schedule-pick").value;
  return v === "custom" ? document.getElementById("f-cron").value.trim() : v;
}

async function pickScriptFile() {
  const p = await window.agentAPI.openFilePicker();
  if (p) document.getElementById("f-script-path").value = p;
}

function showFormError(msg) {
  const el = document.getElementById("form-error");
  el.textContent = msg;
  el.classList.add("visible");
  // Scroll to top so the error and relevant fields are visible
  document.getElementById("sidebar-body").scrollTop = 0;
}
function clearFormError() {
  document.getElementById("form-error").classList.remove("visible");
}

async function submitAddAgent() {
  clearFormError();
  const name = document.getElementById("f-name").value.trim();
  if (!name) { showFormError("Name is required."); return; }

  const schedule = getSchedule();
  if (!schedule) { showFormError("Select or enter a schedule."); return; }

  const payload = {
    name,
    description: document.getElementById("f-desc").value.trim(),
    type: formType,
    schedule,
  };

  if (formType === "prompt") {
    payload.systemPrompt = document.getElementById("f-system").value.trim();
    payload.userPrompt   = document.getElementById("f-user").value.trim();
    payload.provider     = document.getElementById("f-provider")?.value || "xai";
    payload.model        = getSelectedModel();
    payload.temperature  = parseFloat(document.getElementById("f-temp").value);
    if (!payload.userPrompt) { showFormError("User Prompt is required."); return; }
    if (!payload.model)      { showFormError("Model name is required."); return; }
  } else {
    payload.command    = document.getElementById("f-command").value.trim();
    payload.scriptPath = document.getElementById("f-script-path").value.trim();
    payload.timeoutMs  = parseInt(document.getElementById("f-timeout").value, 10) * 1000;
    if (!payload.command) { showFormError("Command is required."); return; }
  }

  if (editingAgentId) {
    // ── Update existing agent ────────────────────────────────────────────────
    const res = await window.agentAPI.updateAgent({ id: editingAgentId, ...payload });
    if (!res.success) { showFormError(res.error); return; }

    const idx = agents.findIndex(a => a.id === editingAgentId);
    if (idx !== -1) agents[idx] = res.agent;
    renderAgentList();
    resetForm();
    toast(`"${res.agent.name}" updated!`, "success");

    if (workerActive) {
      const s = await window.agentAPI.getWorkerStatus();
      updateWorkerPill(true, s.scheduledCount);
    }
  } else {
    // ── Create new agent ─────────────────────────────────────────────────────
    const res = await window.agentAPI.createAgent(payload);
    if (!res.success) { showFormError(res.error); return; }

    agents.push(res.agent);
    renderAgentList();
    resetForm();
    toast(`"${res.agent.name}" created!`, "success");

    if (workerActive) {
      const s = await window.agentAPI.getWorkerStatus();
      updateWorkerPill(true, s.scheduledCount);
    }
  }
}

function resetForm() {
  editingAgentId = null;

  // Restore sidebar header
  document.getElementById("pane-title").textContent = "Add Agent";
  document.getElementById("pane-sub").textContent   = "Prompt or script-based";
  document.getElementById("btn-add-agent").textContent = "+ \u00a0Add Agent";
  document.getElementById("btn-cancel-edit").style.display = "none";

  ["f-name","f-desc","f-system","f-user","f-command","f-script-path"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.getElementById("f-schedule-pick").value = "*/10 * * * *";
  document.getElementById("custom-cron-row").style.display = "none";
  document.getElementById("f-timeout").value = "30";
  document.getElementById("f-temp").value = "0.7";
  document.getElementById("temp-val").textContent = "0.7";
  setFormType("prompt");
  onProviderChange(); // reset model list to first provider's defaults
  clearFormError();
}

// ── Settings dialog ───────────────────────────────────────────────────────────
document.getElementById("btn-settings").addEventListener("click", openSettings);
document.getElementById("btn-cancel-settings").addEventListener("click", closeSettings);
document.getElementById("btn-save-settings").addEventListener("click", saveSettings);
document.getElementById("btn-toggle-key-vis").addEventListener("click", toggleKeyVis);

// Close when clicking the backdrop (but not the dialog itself)
document.getElementById("modal-overlay").addEventListener("click", closeSettings);
document.getElementById("settings-dialog").addEventListener("click", e => e.stopPropagation());

async function openSettings() {
  const [settings] = await Promise.all([window.agentAPI.getSettings()]);

  // Default provider dropdown
  const defSel = document.getElementById("s-default-provider");
  defSel.innerHTML = Object.entries(PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${p.name}</option>`)
    .join("");
  defSel.value = settings.defaultProvider || Object.keys(PROVIDERS)[0] || "xai";
  document.getElementById("s-minimize-to-tray").checked = settings.minimizeToTray !== false;

  // Stash settings so selectSettingsProvider can read them when chips are clicked
  document.getElementById("settings-dialog").dataset.settings = JSON.stringify(settings);

  // Provider chips — no inline onclick; wire up listeners after injection
  const chipsEl = document.getElementById("provider-chips");
  chipsEl.innerHTML = Object.entries(PROVIDERS).map(([id, p]) => {
    const isSet = settings.providers?.[id]?.apiKeyIsSet;
    return `<button class="provider-chip${isSet ? " configured" : ""}" id="chip-${id}"
            ><span class="chip-dot"></span>${p.name}</button>`;
  }).join("");

  Object.keys(PROVIDERS).forEach(id => {
    document.getElementById(`chip-${id}`)
      .addEventListener("click", () => selectSettingsProvider(id));
  });

  // Select the first provider by default
  selectSettingsProvider(Object.keys(PROVIDERS)[0], settings);

  document.getElementById("modal-overlay").classList.add("open");
}

function selectSettingsProvider(providerId, settingsArg) {
  const settings = settingsArg ||
    JSON.parse(document.getElementById("settings-dialog").dataset.settings || "{}");
  activeSettingsProvider = providerId;

  // Update chip active state
  document.querySelectorAll(".provider-chip").forEach(chip => {
    chip.classList.toggle("active", chip.id === `chip-${providerId}`);
  });

  const provider   = PROVIDERS[providerId] || {};
  const provConfig = settings.providers?.[providerId] || {};

  // API key field
  const keyInput = document.getElementById("s-api-key");
  if (provConfig.apiKeyIsSet) {
    // Show masked bullets so user can see a key is stored; typing replaces it
    keyInput.value       = provConfig.apiKey || "••••••••";
    keyInput.placeholder = "";
  } else {
    keyInput.value       = "";
    keyInput.placeholder = provider.requiresKey ? "Paste your key here…" : "(not required)";
  }
  keyInput.disabled = !provider.requiresKey;

  document.getElementById("s-key-hint").textContent = provConfig.apiKeyIsSet
    ? `Stored: ${provConfig.apiKeyHint}` : "";

  // Base URL field
  const urlInput = document.getElementById("s-base-url");
  urlInput.value = provConfig.baseUrl || provider.baseUrl || "";

  // Provider-specific note
  const notes = {
    ollama:   "Ollama runs locally and does not require an API key. Make sure Ollama is running on your machine.",
    anthropic:"Uses Anthropic's OpenAI-compatible endpoint. Requires a Claude API key.",
    custom:   "Enter any OpenAI-compatible base URL and API key.",
  };
  const noteEl = document.getElementById("s-provider-note");
  noteEl.textContent = notes[providerId] || "";
  noteEl.style.display = notes[providerId] ? "" : "none";
}

function closeSettings() {
  document.getElementById("modal-overlay").classList.remove("open");
}

function toggleKeyVis() {
  const el = document.getElementById("s-api-key");
  el.type = el.type === "password" ? "text" : "password";
}

async function saveSettings() {
  const defaultProvider  = document.getElementById("s-default-provider").value;
  const minimizeToTray   = document.getElementById("s-minimize-to-tray").checked;

  // Collect current provider edits
  const apiKey = document.getElementById("s-api-key").value.trim();
  const baseUrl = document.getElementById("s-base-url").value.trim();

  const providers = {};
  if (activeSettingsProvider) {
    providers[activeSettingsProvider] = {};
    if (apiKey)  providers[activeSettingsProvider].apiKey  = apiKey;
    if (baseUrl) providers[activeSettingsProvider].baseUrl = baseUrl;
  }

  const res = await window.agentAPI.saveSettings({ defaultProvider, minimizeToTray, providers });
  if (res.success) {
    closeSettings();
    toast("Settings saved!", "success");
  } else {
    toast("Failed to save settings.", "error");
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
const TOAST_ICONS = { success: "✓", error: "✕", info: "ℹ" };
let _toastTimer = null;

function toast(msg, type = "") {
  const el     = document.getElementById("toast");
  const iconEl = document.getElementById("toast-icon");
  const msgEl  = document.getElementById("toast-msg");
  iconEl.textContent = TOAST_ICONS[type] || "";
  msgEl.textContent  = msg;
  el.className = `show${type ? " " + type : ""}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
let _confirmResolve = null;

function showConfirm(msg, title = "Confirm") {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-msg").textContent   = msg;
  document.getElementById("confirm-overlay").classList.add("open");
  return new Promise(resolve => { _confirmResolve = resolve; });
}

document.getElementById("btn-confirm-ok").addEventListener("click", () => {
  document.getElementById("confirm-overlay").classList.remove("open");
  _confirmResolve?.(true);
  _confirmResolve = null;
});
document.getElementById("btn-confirm-cancel").addEventListener("click", () => {
  document.getElementById("confirm-overlay").classList.remove("open");
  _confirmResolve?.(false);
  _confirmResolve = null;
});

// ── Agent list: delegated event handler ──────────────────────────────────────
document.getElementById("agent-list").addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id, target } = btn.dataset;
  if (action === "edit")   editAgent(id);
  if (action === "run")    runNow(id);
  if (action === "delete") deleteAgent(id);
  if (action === "output") toggleOutput(target);
});

document.getElementById("agent-list").addEventListener("change", e => {
  const el = e.target.closest("[data-action='toggle']");
  if (el) toggleAgent(el.dataset.id, el.checked);
});

// ── Form event listeners ──────────────────────────────────────────────────────
document.getElementById("tab-prompt").addEventListener("click", () => setFormType("prompt"));
document.getElementById("tab-script").addEventListener("click", () => setFormType("script"));
document.getElementById("btn-pick-script").addEventListener("click", pickScriptFile);
document.getElementById("btn-add-agent").addEventListener("click", submitAddAgent);
document.getElementById("btn-cancel-edit").addEventListener("click", resetForm);
document.getElementById("btn-open-data-dir").addEventListener("click", () => window.agentAPI.openDataDir());
document.getElementById("f-provider").addEventListener("change", onProviderChange);
document.getElementById("f-schedule-pick").addEventListener("change", onScheduleChange);
document.getElementById("f-temp").addEventListener("input", () => {
  document.getElementById("temp-val").textContent = document.getElementById("f-temp").value;
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeSettings();
});

// ── Background refresh ────────────────────────────────────────────────────────
setInterval(async () => {
  agents = await window.agentAPI.listAgents();
  renderAgentList();
}, 30_000);

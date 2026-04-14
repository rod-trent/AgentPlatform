"use strict";

// ── State ─────────────────────────────────────────────────────────────────────
let agents          = [];
let workerActive    = false;
let formType        = "prompt";
let editingAgentId  = null;   // non-null when the sidebar is in edit mode
let PROVIDERS     = {};          // keyed by providerId, populated on init
let activeSettingsProvider = ""; // which chip is selected in the settings dialog
let selectionMode   = false;     // true when user is picking agents to export
let selectedIds     = new Set(); // agent ids checked for export
let _geoLocation    = null;      // cached geo result from main process

// ── Bootstrap ─────────────────────────────────────────────────────────────────
(async function init() {
  // Load providers first — everything else depends on them
  PROVIDERS = await window.agentAPI.getProviders();

  const [agentList, status, settings] = await Promise.all([
    window.agentAPI.listAgents(),
    window.agentAPI.getWorkerStatus(),
    window.agentAPI.getSettings(),
  ]);

  agents       = agentList;
  workerActive = status.running;

  populateFormProviders(settings.defaultProvider);
  populateChainToDropdown();
  populateGroupDatalist();
  updateWorkerPill(status.running, status.scheduledCount);
  renderAgentList();

  // Fetch geo in background for display in settings/status
  window.agentAPI.getGeoLocation().then(geo => { _geoLocation = geo; }).catch(() => {});

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

  window.agentAPI.onAgentsUpdated((updated) => {
    agents = updated;
    renderAgentList();
    populateChainToDropdown();
    populateGroupDatalist();
  });

  // Background store check — badge the Store button if new agents are available
  _refreshStoreBadge();
})();

// ── Provider helpers ──────────────────────────────────────────────────────────

/** Populate the provider dropdown and model list in the Add-Agent form. */
function populateFormProviders(defaultProvider) {
  const sel = document.getElementById("f-provider");
  if (!sel) return;
  sel.innerHTML = Object.entries(PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${p.name}</option>`)
    .join("");
  if (defaultProvider && sel.querySelector(`option[value="${defaultProvider}"]`)) {
    sel.value = defaultProvider;
  }
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

// ── Chain-to dropdown & condition ────────────────────────────────────────────

function populateChainToDropdown(excludeId) {
  const sel = document.getElementById("f-chain-to");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">— None —</option>` +
    agents
      .filter(a => a.id !== excludeId)
      .map(a => `<option value="${a.id}">${esc(a.name)}</option>`)
      .join("");
  if (current && sel.querySelector(`option[value="${current}"]`)) sel.value = current;
  updateChainConditionVisibility();
}

function updateChainConditionVisibility() {
  const chainVal   = document.getElementById("f-chain-to").value;
  const condWrap   = document.getElementById("chain-condition-wrap");
  const condSel    = document.getElementById("f-chain-condition");
  const kwInput    = document.getElementById("f-chain-keyword");
  if (!condWrap) return;
  condWrap.style.display = chainVal ? "" : "none";
  if (condSel && kwInput) {
    kwInput.style.display = condSel.value === "contains" ? "" : "none";
  }
}

document.getElementById("f-chain-to").addEventListener("change", updateChainConditionVisibility);
document.getElementById("f-chain-condition").addEventListener("change", updateChainConditionVisibility);

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

  // Group agents: ungrouped first, then named groups
  const ungrouped  = agents.filter(a => !a.group);
  const groupNames = [...new Set(agents.filter(a => a.group).map(a => a.group))].sort();

  let html = ungrouped.map(cardHTML).join("");
  for (const g of groupNames) {
    const groupAgents = agents.filter(a => a.group === g);
    const allEnabled  = groupAgents.every(a => a.enabled);
    html += `
      <div class="group-header">
        <span class="group-header-label">📁 ${esc(g)}</span>
        <span class="group-header-count">${groupAgents.length} agent${groupAgents.length !== 1 ? "s" : ""}</span>
        <button class="fluent-btn" style="height:24px;font-size:11px;padding:0 8px"
                data-group-run="${esc(g)}" title="Run all agents in this group">▶ Run Group</button>
        <button class="fluent-btn" style="height:24px;font-size:11px;padding:0 8px"
                data-group-toggle="${esc(g)}" data-group-enabled="${allEnabled}"
                title="${allEnabled ? "Disable" : "Enable"} all agents in this group">
          ${allEnabled ? "⏸ Disable" : "▶ Enable"} All
        </button>
      </div>
    `;
    html += groupAgents.map(cardHTML).join("");
  }
  list.innerHTML = html;
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

  const chainedAgent = a.chainTo?.length ? agents.find(x => x.id === a.chainTo[0]) : null;
  const chainBadge   = chainedAgent
    ? `<span class="fluent-badge badge-chain" title="Chains to ${esc(chainedAgent.name)}">⛓ ${esc(chainedAgent.name)}</span>`
    : "";
  const groupBadge   = a.group
    ? `<span class="fluent-badge badge-group">📁 ${esc(a.group)}</span>`
    : "";
  const mcpBadge     = a.mcpUrl
    ? `<span class="fluent-badge badge-mcp" title="MCP: ${esc(a.mcpUrl)}">MCP</span>`
    : "";

  const hasOutput  = !!(a.lastResult);
  const hasHistory = true; // History button always shown after first run
  const outputId   = `out-${a.id}`;

  const selectCb = selectionMode
    ? `<input type="checkbox" class="agent-select-cb" data-action="select" data-id="${a.id}"
              ${selectedIds.has(a.id) ? "checked" : ""} />`
    : "";

  return `
<div class="agent-card${selectionMode ? " selectable" : ""}" id="card-${a.id}">
  <div class="card-row-top">
    ${selectCb}
    <div class="status-indicator ${dotClass}"></div>
    <div class="card-info">
      <div class="card-name">${esc(a.name)}</div>
      <div class="card-meta">
        ${typeBadge}${provBadge}${chainBadge}${groupBadge}${mcpBadge}
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
    ${hasOutput ? `
      <button class="card-btn" data-action="copy-output" data-id="${a.id}" title="Copy output to clipboard">📋</button>
      <button class="card-btn" data-action="open-html" data-id="${a.id}" title="Open output as HTML in browser">🌐</button>
      <button class="card-btn" data-action="output" data-target="${outputId}">Output</button>
    ` : ""}
    ${a.lastRun ? `<button class="card-btn" data-action="history" data-id="${a.id}" title="View run history">History</button>` : ""}
    ${a.lastRun ? `<button class="card-btn" data-action="diff" data-id="${a.id}" title="Show diff from previous run">Diff</button>` : ""}
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

async function copyOutput(id) {
  const a = agents.find(x => x.id === id);
  if (!a?.lastResult) return;
  try {
    await navigator.clipboard.writeText(a.lastResult);
    toast("Output copied to clipboard.", "success");
  } catch {
    toast("Could not copy to clipboard.", "error");
  }
}

async function openOutputAsHtml(id) {
  const a = agents.find(x => x.id === id);
  if (!a?.lastResult) return;
  const res = await window.agentAPI.openMarkdownInBrowser(a.lastResult, a.name);
  if (!res.success) toast("Could not open in browser.", "error");
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
    populateChainToDropdown();
    toast("Agent deleted.");
  } else {
    toast(res.error, "error");
  }
}

// ── History dialog ────────────────────────────────────────────────────────────
async function showHistory(id) {
  const a = agents.find(x => x.id === id);
  document.getElementById("history-title").textContent =
    `Run History — ${a?.name || id}`;

  const entries = await window.agentAPI.getAgentHistory(id);
  const listEl  = document.getElementById("history-list");

  if (!entries.length) {
    listEl.innerHTML = `<div class="history-empty">No history yet.</div>`;
  } else {
    listEl.innerHTML = entries.map((e, i) => `
      <div class="history-entry">
        <div class="history-entry-header">
          <span class="history-status ${e.status === "success" ? "success" : "error"}">
            ${e.status === "success" ? "✓" : "✗"} ${e.status}
          </span>
          <span class="history-ts">${new Date(e.timestamp).toLocaleString()}</span>
          ${e.result ? `
            <button class="inline-action-btn" data-hcopy="${i}" title="Copy">📋</button>
            <button class="inline-action-btn" data-hhtml="${i}" title="Open as HTML">🌐</button>
          ` : ""}
        </div>
        ${e.result ? `<div class="history-result" id="hist-result-${i}">${esc(e.result)}</div>` : ""}
      </div>
    `).join("");

    // Wire up copy / open-html buttons inside history
    listEl.querySelectorAll("[data-hcopy]").forEach(btn => {
      const idx = parseInt(btn.dataset.hcopy, 10);
      btn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(entries[idx].result || "");
        toast("Copied to clipboard.", "success");
      });
    });
    listEl.querySelectorAll("[data-hhtml]").forEach(btn => {
      const idx = parseInt(btn.dataset.hhtml, 10);
      btn.addEventListener("click", async () => {
        await window.agentAPI.openMarkdownInBrowser(entries[idx].result || "", a?.name || "Output");
      });
    });
  }

  document.getElementById("history-overlay").classList.add("open");
}

document.getElementById("btn-close-history").addEventListener("click", () => {
  document.getElementById("history-overlay").classList.remove("open");
});
document.getElementById("history-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget)
    document.getElementById("history-overlay").classList.remove("open");
});

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
  document.getElementById("f-group").value   = a.group   || "";
  document.getElementById("f-mcp-url").value = a.mcpUrl  || "";
  const whEn  = document.getElementById("f-webhook-enabled");
  const whUrl = document.getElementById("f-webhook-url");
  const whWrap = document.getElementById("f-webhook-url-wrap");
  if (whEn)  { whEn.checked   = !!a.onCompleteWebhookEnabled; }
  if (whUrl) { whUrl.value    = a.onCompleteWebhookUrl || ""; }
  if (whWrap){ whWrap.style.display = a.onCompleteWebhookEnabled ? "" : "none"; }

  // Chain-to + condition
  populateChainToDropdown(id);
  const chainSel = document.getElementById("f-chain-to");
  chainSel.value = (a.chainTo && a.chainTo[0]) ? a.chainTo[0] : "";
  const rawCond = a.chainCondition || "success";
  const condSel = document.getElementById("f-chain-condition");
  const kwInput = document.getElementById("f-chain-keyword");
  if (condSel) {
    if (rawCond.startsWith("contains:")) {
      condSel.value = "contains";
      if (kwInput) kwInput.value = rawCond.slice("contains:".length).trim();
    } else {
      condSel.value = rawCond;
      if (kwInput) kwInput.value = "";
    }
  }
  updateChainConditionVisibility();

  // Schedule
  const sched = document.getElementById("f-schedule-pick");
  const knownOption = [...sched.options].find(o => o.value === a.schedule);
  if (knownOption) {
    sched.value = a.schedule;
    document.getElementById("custom-cron-row").style.display = "none";
  } else {
    sched.value = "custom";
    // Fill the expression tab
    document.getElementById("f-cron").value = a.schedule;
    // Show expression tab directly for existing custom expressions
    setCronTab("expr");
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
  hideTestOutput();
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
  if (v === "custom") {
    document.getElementById("custom-cron-row").style.display = "";
    setCronTab("builder");
    rebuildCronFromBuilder();
  } else {
    document.getElementById("custom-cron-row").style.display = "none";
  }
}

function getSchedule() {
  const v = document.getElementById("f-schedule-pick").value;
  if (v !== "custom") return v;
  // Check which cron sub-tab is active
  const exprPanel = document.getElementById("cron-expr-panel");
  if (exprPanel.style.display !== "none") {
    return document.getElementById("f-cron").value.trim();
  }
  // Builder mode — read from preview
  return document.getElementById("cron-preview-expr").textContent.trim();
}

async function pickScriptFile() {
  const p = await window.agentAPI.openFilePicker();
  if (p) document.getElementById("f-script-path").value = p;
}

function showFormError(msg) {
  const el = document.getElementById("form-error");
  el.textContent = msg;
  el.classList.add("visible");
  document.getElementById("sidebar-body").scrollTop = 0;
}
function clearFormError() {
  document.getElementById("form-error").classList.remove("visible");
}

/** Collect form payload (shared between submit and test). */
function collectFormPayload() {
  const name     = document.getElementById("f-name").value.trim();
  const schedule = getSchedule();
  const chainVal = document.getElementById("f-chain-to").value;

  const condSel  = document.getElementById("f-chain-condition");
  const kwInput  = document.getElementById("f-chain-keyword");
  let chainCondition = condSel?.value || "success";
  if (chainCondition === "contains") {
    const kw = kwInput?.value.trim() || "";
    chainCondition = kw ? `contains:${kw}` : "success";
  }

  const webhookEnabled = document.getElementById("f-webhook-enabled")?.checked || false;
  const webhookUrl     = document.getElementById("f-webhook-url")?.value.trim()  || "";

  const payload = {
    name,
    description: document.getElementById("f-desc").value.trim(),
    type: formType,
    schedule,
    chainTo:        chainVal ? [chainVal] : [],
    chainCondition: chainVal ? chainCondition : "success",
    group:          document.getElementById("f-group")?.value.trim() || "",
    mcpUrl:         document.getElementById("f-mcp-url")?.value.trim() || "",
    onCompleteWebhookEnabled: webhookEnabled,
    onCompleteWebhookUrl:     webhookEnabled ? webhookUrl : "",
  };

  if (formType === "prompt") {
    payload.systemPrompt = document.getElementById("f-system").value.trim();
    payload.userPrompt   = document.getElementById("f-user").value.trim();
    payload.provider     = document.getElementById("f-provider")?.value || "xai";
    payload.model        = getSelectedModel();
    payload.temperature  = parseFloat(document.getElementById("f-temp").value);
  } else {
    payload.command    = document.getElementById("f-command").value.trim();
    payload.scriptPath = document.getElementById("f-script-path").value.trim();
    payload.timeoutMs  = parseInt(document.getElementById("f-timeout").value, 10) * 1000;
  }
  return payload;
}

async function submitAddAgent() {
  clearFormError();
  const payload = collectFormPayload();
  if (!payload.name) { showFormError("Name is required."); return; }
  if (!payload.schedule) { showFormError("Select or enter a schedule."); return; }
  if (formType === "prompt") {
    if (!payload.userPrompt) { showFormError("User Prompt is required."); return; }
    if (!payload.model)      { showFormError("Model name is required."); return; }
  } else {
    if (!payload.command)    { showFormError("Command is required."); return; }
  }

  if (editingAgentId) {
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
    const res = await window.agentAPI.createAgent(payload);
    if (!res.success) { showFormError(res.error); return; }
    agents.push(res.agent);
    renderAgentList();
    populateChainToDropdown();
    resetForm();
    toast(`"${res.agent.name}" created!`, "success");
    if (workerActive) {
      const s = await window.agentAPI.getWorkerStatus();
      updateWorkerPill(true, s.scheduledCount);
    }
  }
}

// ── Test agent ────────────────────────────────────────────────────────────────
async function testAgent() {
  clearFormError();
  const payload = collectFormPayload();

  if (formType === "prompt") {
    if (!payload.userPrompt) { showFormError("User Prompt is required to test."); return; }
    if (!payload.model)      { showFormError("Model name is required to test."); return; }
  } else {
    if (!payload.command)    { showFormError("Command is required to test."); return; }
  }

  const btn = document.getElementById("btn-test-agent");
  btn.textContent = "⏳ Testing…";
  btn.disabled    = true;

  showTestOutput("Running test…", "info");

  const res = await window.agentAPI.testAgent(payload);

  btn.textContent = "▶ Test";
  btn.disabled    = false;

  if (res.success) {
    showTestOutput(res.result, res.status === "success" ? "success" : "error");
    if (res.status === "error") {
      toast("Test failed — see output below.", "error");
    } else {
      toast("Test completed successfully.", "success");
    }
  } else {
    showTestOutput(res.error || "Test failed.", "error");
    toast(res.error || "Test failed.", "error");
  }
}

function showTestOutput(text, status) {
  const wrap   = document.getElementById("test-output-wrap");
  const out    = document.getElementById("test-output");
  const statEl = document.getElementById("test-output-status");
  const icons  = { success: "✓ Success", error: "✗ Error", info: "⏳ Running" };
  statEl.textContent = icons[status] || "";
  statEl.className   = `test-status-label ${status || ""}`;
  out.textContent    = text || "";
  wrap.style.display = "";
  document.getElementById("sidebar-body").scrollTop =
    document.getElementById("sidebar-body").scrollHeight;
}

function hideTestOutput() {
  document.getElementById("test-output-wrap").style.display = "none";
}

document.getElementById("btn-test-agent").addEventListener("click", testAgent);

document.getElementById("btn-test-copy").addEventListener("click", async () => {
  const text = document.getElementById("test-output").textContent;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  toast("Test output copied.", "success");
});

// ── Clipboard paste ───────────────────────────────────────────────────────────
document.getElementById("btn-paste-prompt").addEventListener("click", async () => {
  try {
    const text = await window.agentAPI.readClipboard();
    if (!text) { toast("Clipboard is empty.", "info"); return; }
    document.getElementById("f-user").value = text;
    toast("Prompt pasted from clipboard.", "success");
  } catch {
    toast("Could not read clipboard.", "error");
  }
});

// ── Custom cron builder ───────────────────────────────────────────────────────

// Tab switching
function setCronTab(tab) {
  const isBuilder = tab === "builder";
  document.getElementById("cron-tab-builder").classList.toggle("active", isBuilder);
  document.getElementById("cron-tab-expr").classList.toggle("active", !isBuilder);
  document.getElementById("cron-builder-panel").style.display = isBuilder ? "" : "none";
  document.getElementById("cron-expr-panel").style.display    = isBuilder ? "none" : "";
}

document.getElementById("cron-tab-builder").addEventListener("click", () => setCronTab("builder"));
document.getElementById("cron-tab-expr").addEventListener("click",    () => setCronTab("expr"));

// Show/hide builder sub-fields based on frequency selection
function onCronFreqChange() {
  const freq = document.getElementById("cron-freq").value;
  document.getElementById("cron-opt-minute").style.display = freq === "minute" ? "" : "none";
  document.getElementById("cron-opt-hour").style.display   = freq === "hour"   ? "" : "none";
  document.getElementById("cron-opt-time").style.display   = ["daily","weekly","monthly"].includes(freq) ? "" : "none";
  document.getElementById("cron-opt-dow").style.display    = freq === "weekly"  ? "" : "none";
  document.getElementById("cron-opt-dom").style.display    = freq === "monthly" ? "" : "none";
  rebuildCronFromBuilder();
}

function rebuildCronFromBuilder() {
  const freq   = document.getElementById("cron-freq").value;
  const evMin  = parseInt(document.getElementById("cron-every-min").value, 10) || 10;
  const evHr   = parseInt(document.getElementById("cron-every-hr").value,  10) || 1;
  const time   = document.getElementById("cron-time").value || "09:00";
  const [hh, mm] = time.split(":").map(Number);
  const dow    = document.getElementById("cron-dow").value || "1";
  const dom    = parseInt(document.getElementById("cron-dom").value, 10) || 1;

  let expr = "";
  let desc = "";

  switch (freq) {
    case "minute":
      expr = `*/${evMin} * * * *`;
      desc = `every ${evMin} minute${evMin !== 1 ? "s" : ""}`;
      break;
    case "hour":
      expr = `0 */${evHr} * * *`;
      desc = `every ${evHr} hour${evHr !== 1 ? "s" : ""}`;
      break;
    case "daily":
      expr = `${mm} ${hh} * * *`;
      desc = `daily at ${time}`;
      break;
    case "weekly": {
      const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      expr = `${mm} ${hh} * * ${dow}`;
      desc = `every ${days[parseInt(dow, 10)]} at ${time}`;
      break;
    }
    case "monthly":
      expr = `${mm} ${hh} ${dom} * *`;
      desc = `monthly on day ${dom} at ${time}`;
      break;
  }

  document.getElementById("cron-preview-expr").textContent = expr;
  document.getElementById("cron-preview-desc").textContent = desc;
}

// Wire up builder inputs
document.getElementById("cron-freq").addEventListener("change", onCronFreqChange);
["cron-every-min","cron-every-hr","cron-time","cron-dow","cron-dom"].forEach(id => {
  document.getElementById(id).addEventListener("input", rebuildCronFromBuilder);
  document.getElementById(id).addEventListener("change", rebuildCronFromBuilder);
});

// ── Community Packs ───────────────────────────────────────────────────────────
document.getElementById("btn-browse-packs").addEventListener("click", openPacksBrowser);
document.getElementById("btn-close-packs").addEventListener("click", closePacksBrowser);
document.getElementById("btn-close-packs-footer").addEventListener("click", closePacksBrowser);
document.getElementById("packs-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) closePacksBrowser();
});

async function openPacksBrowser() {
  document.getElementById("packs-overlay").classList.add("open");
  document.getElementById("packs-loading").style.display = "";
  document.getElementById("packs-list").innerHTML  = "";
  document.getElementById("packs-error").style.display = "none";

  const res = await window.agentAPI.fetchAgentPacks();
  document.getElementById("packs-loading").style.display = "none";

  if (!res.success) {
    const errEl = document.getElementById("packs-error");
    errEl.textContent = `Could not load packs: ${res.error}`;
    errEl.style.display = "";
    return;
  }

  const packs = res.packs;
  if (!packs.length) {
    document.getElementById("packs-list").innerHTML =
      `<div class="history-empty">No packs found.</div>`;
    return;
  }

  document.getElementById("packs-list").innerHTML = packs.map((p, i) => `
    <div class="pack-card" id="pack-${i}">
      <div class="pack-card-info">
        <div class="pack-name">${esc(p.name)}</div>
        <div class="pack-desc">${esc(p.description || "")}</div>
        <div class="pack-meta">
          ${p.author ? `<span>by ${esc(p.author)}</span>` : ""}
          <span>${(p.agents || []).length} agent${(p.agents || []).length !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <button class="fluent-btn accent" data-pack-idx="${i}" id="pack-btn-${i}">Install</button>
    </div>
  `).join("");

  document.getElementById("packs-list").addEventListener("click", async e => {
    const btn = e.target.closest("[data-pack-idx]");
    if (!btn) return;
    const idx  = parseInt(btn.dataset.packIdx, 10);
    const pack = packs[idx];
    btn.textContent = "Installing…";
    btn.disabled    = true;
    const res = await window.agentAPI.importAgentPack(pack);
    if (res.success) {
      btn.textContent = `✓ Installed (${res.imported})`;
      agents = await window.agentAPI.listAgents();
      renderAgentList();
      populateChainToDropdown();
      let msg = `Installed ${res.imported} agent${res.imported !== 1 ? "s" : ""} from "${pack.name}".`;
      if (res.skipped?.length) msg += ` Skipped ${res.skipped.length} duplicate(s).`;
      toast(msg, res.imported ? "success" : "info");
    } else {
      btn.textContent = "✕ Failed";
      toast(res.error || "Import failed.", "error");
    }
  });
}

function closePacksBrowser() {
  document.getElementById("packs-overlay").classList.remove("open");
}

// ── Analytics dialog ──────────────────────────────────────────────────────────
document.getElementById("btn-open-analytics").addEventListener("click", openAnalytics);
document.getElementById("btn-close-analytics").addEventListener("click", closeAnalytics);
document.getElementById("btn-close-analytics-footer").addEventListener("click", closeAnalytics);
document.getElementById("analytics-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeAnalytics();
});

async function openAnalytics() {
  document.getElementById("analytics-overlay").classList.add("open");
  document.getElementById("analytics-loading").style.display = "";
  document.getElementById("analytics-empty").style.display   = "none";
  document.getElementById("analytics-table-wrap").style.display = "none";

  const data = await window.agentAPI.getAnalytics();
  document.getElementById("analytics-loading").style.display = "none";

  const rows = Object.values(data).filter(r => r.total > 0);
  if (!rows.length) {
    document.getElementById("analytics-empty").style.display = "";
    return;
  }

  document.getElementById("analytics-tbody").innerHTML = rows
    .sort((a, b) => b.total - a.total)
    .map(r => {
      const srClass = r.successRate === null ? "" : r.successRate >= 80 ? "sr-good" : r.successRate >= 50 ? "sr-mid" : "sr-bad";
      const srText  = r.successRate === null ? "—" : `${r.successRate}%`;
      const dur     = r.avgDuration ? (r.avgDuration < 1000 ? `${r.avgDuration}ms` : `${(r.avgDuration/1000).toFixed(1)}s`) : "—";
      const lastRun = r.lastRun ? timeAgo(r.lastRun) : "Never";
      const statusClass = r.lastStatus === "success" ? "success" : r.lastStatus === "error" ? "error" : "";
      return `<tr>
        <td class="analytics-name">${esc(r.name)}</td>
        <td><span class="fluent-badge ${r.type === "script" ? "badge-script" : "badge-prompt"}">${r.type}</span></td>
        <td>${r.total}</td>
        <td class="${srClass}">${srText}</td>
        <td class="${r.failures > 0 ? "sr-bad" : ""}">${r.failures}</td>
        <td>${dur}</td>
        <td class="${statusClass}">${lastRun}</td>
      </tr>`;
    }).join("");

  document.getElementById("analytics-table-wrap").style.display = "";
}

function closeAnalytics() {
  document.getElementById("analytics-overlay").classList.remove("open");
}

// ── Agent Store dialog ────────────────────────────────────────────────────────
document.getElementById("btn-open-store").addEventListener("click", openStore);
document.getElementById("btn-close-store").addEventListener("click", closeStore);
document.getElementById("btn-close-store-footer").addEventListener("click", closeStore);
document.getElementById("store-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeStore();
});

async function openStore() {
  document.getElementById("store-overlay").classList.add("open");
  document.getElementById("store-loading").style.display  = "";
  document.getElementById("store-list").innerHTML = "";
  document.getElementById("store-error").style.display    = "none";
  _setStoreBadge(0); // clear badge once user opens the store

  const res = await window.agentAPI.fetchStore();

  // Mark all current store files as seen so badge resets
  if (res.success && res.files.length) {
    const fileNames = res.files.map(f => f.name);
    window.agentAPI.markStoreFilesSeen(fileNames).catch(() => {});
  }
  document.getElementById("store-loading").style.display = "none";

  if (!res.success) {
    const errEl = document.getElementById("store-error");
    errEl.textContent = `Could not load store: ${res.error}`;
    errEl.style.display = "";
    return;
  }

  if (!res.files.length) {
    document.getElementById("store-list").innerHTML =
      `<div class="history-empty">No agents found in the store.</div>`;
    return;
  }

  // Render placeholder cards while we have file metadata (name, download_url)
  const existingNames = new Set(agents.map(a => a.name.toLowerCase()));

  document.getElementById("store-list").innerHTML = res.files.map((f, i) => {
    // Derive a display name from filename (strip .json, replace dashes/underscores)
    const displayName = f.name.replace(/\.json$/i, "").replace(/[-_]/g, " ");
    return `
    <div class="store-card" id="store-card-${i}">
      <div class="store-card-info">
        <div class="store-card-name" id="store-name-${i}">${esc(displayName)}</div>
        <div class="store-card-meta" id="store-meta-${i}" style="color:var(--text-tertiary);font-size:12px">Loading…</div>
        <div class="store-card-desc" id="store-desc-${i}"></div>
      </div>
      <button class="fluent-btn accent store-add-btn" id="store-btn-${i}"
              data-store-idx="${i}" data-url="${esc(f.download_url)}">Add</button>
    </div>`;
  }).join("");

  // Async-load each agent's metadata to fill in details
  res.files.forEach(async (f, i) => {
    try {
      const detail = await window.agentAPI.getStoreAgent(f.download_url);
      if (!detail.success || !detail.agents.length) return;
      const ag = detail.agents[0];
      const nameEl = document.getElementById(`store-name-${i}`);
      const metaEl = document.getElementById(`store-meta-${i}`);
      const descEl = document.getElementById(`store-desc-${i}`);
      const btn    = document.getElementById(`store-btn-${i}`);
      if (nameEl) nameEl.textContent = ag.name || nameEl.textContent;
      if (metaEl) metaEl.textContent = [ag.provider, ag.model, ag.schedule].filter(Boolean).join("  ·  ");
      if (descEl) descEl.textContent = ag.description || "";
      if (btn) {
        const alreadyInstalled = existingNames.has((ag.name || "").toLowerCase());
        if (alreadyInstalled) {
          btn.textContent = "✓ Installed";
          btn.disabled = true;
        }
        btn.dataset.agentName = ag.name || "";
      }
    } catch {}
  });

  document.getElementById("store-list").addEventListener("click", async e => {
    const btn = e.target.closest(".store-add-btn");
    if (!btn || btn.disabled) return;
    const url = btn.dataset.url;
    btn.textContent = "Installing…";
    btn.disabled = true;

    const detail = await window.agentAPI.getStoreAgent(url);
    if (!detail.success) {
      btn.textContent = "✕ Failed";
      toast(detail.error || "Could not load agent.", "error");
      return;
    }

    const res2 = await window.agentAPI.importAgentPack({ agents: detail.agents });
    if (res2.success && res2.imported > 0) {
      btn.textContent = "✓ Installed";
      existingNames.add((btn.dataset.agentName || "").toLowerCase());
      agents = await window.agentAPI.listAgents();
      renderAgentList();
      populateChainToDropdown();
      _refreshStoreBadge();
      toast(`"${btn.dataset.agentName || "Agent"}" added to your platform!`, "success");
    } else if (res2.skipped?.length) {
      btn.textContent = "✓ Installed";
      btn.disabled = true;
      toast(`Already installed.`, "info");
    } else {
      btn.textContent = "✕ Failed";
      btn.disabled = false;
      toast(res2.error || "Import failed.", "error");
    }
  });
}

function closeStore() {
  document.getElementById("store-overlay").classList.remove("open");
}

// ── Store badge ───────────────────────────────────────────────────────────────
async function _refreshStoreBadge() {
  try {
    const [res, seen] = await Promise.all([
      window.agentAPI.fetchStore(),
      window.agentAPI.getSeenStoreFiles(),
    ]);
    if (!res.success || !res.files.length) return;
    const seenSet = new Set(seen || []);
    // Count store files the user hasn't opened/seen yet
    const newCount = res.files.filter(f => !seenSet.has(f.name)).length;
    _setStoreBadge(newCount);
  } catch { /* network unavailable — badge stays hidden */ }
}

function _setStoreBadge(count) {
  const badge = document.getElementById("store-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }
}

// ── Reset form ────────────────────────────────────────────────────────────────
function resetForm() {
  editingAgentId = null;

  document.getElementById("pane-title").textContent = "Add Agent";
  document.getElementById("pane-sub").textContent   = "Prompt or script-based";
  document.getElementById("btn-add-agent").textContent = "+ \u00a0Add Agent";
  document.getElementById("btn-cancel-edit").style.display = "none";

  ["f-name","f-desc","f-system","f-user","f-command","f-script-path","f-group","f-mcp-url","f-webhook-url"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  const wh = document.getElementById("f-webhook-enabled");
  if (wh) { wh.checked = false; document.getElementById("f-webhook-url-wrap").style.display = "none"; }
  document.getElementById("f-schedule-pick").value = "*/10 * * * *";
  document.getElementById("custom-cron-row").style.display = "none";
  document.getElementById("f-timeout").value = "30";
  document.getElementById("f-temp").value = "0.7";
  document.getElementById("temp-val").textContent = "0.7";
  document.getElementById("f-chain-to").value = "";
  const condSel = document.getElementById("f-chain-condition");
  const kwInput = document.getElementById("f-chain-keyword");
  if (condSel) condSel.value = "success";
  if (kwInput) kwInput.value = "";
  updateChainConditionVisibility();
  setFormType("prompt");
  onProviderChange();
  clearFormError();
  hideTestOutput();
  populateChainToDropdown();
}

// ── Settings dialog ───────────────────────────────────────────────────────────
document.getElementById("btn-settings").addEventListener("click", openSettings);
document.getElementById("btn-cancel-settings").addEventListener("click", closeSettings);
document.getElementById("btn-save-settings").addEventListener("click", saveSettings);
document.getElementById("btn-toggle-key-vis").addEventListener("click", toggleKeyVis);

document.getElementById("modal-overlay").addEventListener("click", closeSettings);
document.getElementById("settings-dialog").addEventListener("click", e => e.stopPropagation());

async function openSettings() {
  const [settings, version] = await Promise.all([
    window.agentAPI.getSettings(),
    window.agentAPI.getVersion(),
  ]);

  const verEl = document.getElementById("settings-version");
  if (verEl) verEl.textContent = version ? `v${version}` : "";

  const defSel = document.getElementById("s-default-provider");
  defSel.innerHTML = Object.entries(PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${p.name}</option>`)
    .join("");
  defSel.value = settings.defaultProvider || Object.keys(PROVIDERS)[0] || "xai";
  document.getElementById("s-minimize-to-tray").checked = settings.minimizeToTray !== false;
  document.getElementById("s-run-at-startup").checked   = !!settings.runAtStartup;
  document.getElementById("s-notifications").checked    = settings.notificationsEnabled !== false;

  const webhookEnabled = !!settings.webhookEnabled;
  const webhookPort    = settings.webhookPort || 7171;
  document.getElementById("s-webhook-enabled").checked = webhookEnabled;
  document.getElementById("s-webhook-port").value      = webhookPort;
  document.getElementById("s-webhook-config").style.display = webhookEnabled ? "" : "none";
  _updateWebhookUrlHint(webhookEnabled, webhookPort);

  document.getElementById("settings-dialog").dataset.settings = JSON.stringify(settings);

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

  selectSettingsProvider(Object.keys(PROVIDERS)[0], settings);
  document.getElementById("modal-overlay").classList.add("open");
}

function selectSettingsProvider(providerId, settingsArg) {
  const settings = settingsArg ||
    JSON.parse(document.getElementById("settings-dialog").dataset.settings || "{}");
  activeSettingsProvider = providerId;

  document.querySelectorAll(".provider-chip").forEach(chip => {
    chip.classList.toggle("active", chip.id === `chip-${providerId}`);
  });

  const provider   = PROVIDERS[providerId] || {};
  const provConfig = settings.providers?.[providerId] || {};

  const keyInput = document.getElementById("s-api-key");
  if (provConfig.apiKeyIsSet) {
    keyInput.value       = provConfig.apiKey || "••••••••";
    keyInput.placeholder = "";
  } else {
    keyInput.value       = "";
    keyInput.placeholder = provider.requiresKey ? "Paste your key here…" : "(not required)";
  }
  keyInput.disabled = !provider.requiresKey;

  document.getElementById("s-key-hint").textContent = provConfig.apiKeyIsSet
    ? `Stored: ${provConfig.apiKeyHint}` : "";

  const urlInput = document.getElementById("s-base-url");
  urlInput.value = provConfig.baseUrl || provider.baseUrl || "";

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

function _updateWebhookUrlHint(enabled, port) {
  const urlEl = document.getElementById("s-webhook-url");
  if (!urlEl) return;
  urlEl.textContent = enabled
    ? `Trigger URL: http://127.0.0.1:${port}/trigger/{agentId}`
    : "";
}

document.getElementById("s-webhook-enabled").addEventListener("change", () => {
  const enabled = document.getElementById("s-webhook-enabled").checked;
  const port    = parseInt(document.getElementById("s-webhook-port").value, 10) || 7171;
  document.getElementById("s-webhook-config").style.display = enabled ? "" : "none";
  _updateWebhookUrlHint(enabled, port);
});
document.getElementById("s-webhook-port").addEventListener("input", () => {
  const enabled = document.getElementById("s-webhook-enabled").checked;
  const port    = parseInt(document.getElementById("s-webhook-port").value, 10) || 7171;
  _updateWebhookUrlHint(enabled, port);
});

async function saveSettings() {
  const defaultProvider      = document.getElementById("s-default-provider").value;
  const minimizeToTray       = document.getElementById("s-minimize-to-tray").checked;
  const runAtStartup         = document.getElementById("s-run-at-startup").checked;
  const notificationsEnabled = document.getElementById("s-notifications").checked;
  const webhookEnabled       = document.getElementById("s-webhook-enabled").checked;
  const webhookPort          = parseInt(document.getElementById("s-webhook-port").value, 10) || 7171;

  const apiKey = document.getElementById("s-api-key").value.trim();
  const baseUrl = document.getElementById("s-base-url").value.trim();

  const providers = {};
  if (activeSettingsProvider) {
    providers[activeSettingsProvider] = {};
    if (apiKey)  providers[activeSettingsProvider].apiKey  = apiKey;
    if (baseUrl) providers[activeSettingsProvider].baseUrl = baseUrl;
  }

  const res = await window.agentAPI.saveSettings({
    defaultProvider, minimizeToTray, runAtStartup, notificationsEnabled,
    webhookEnabled, webhookPort, providers,
  });
  if (res.success) {
    closeSettings();
    populateFormProviders(defaultProvider);
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
  if (action === "edit")        editAgent(id);
  if (action === "run")         runNow(id);
  if (action === "delete")      deleteAgent(id);
  if (action === "output")      toggleOutput(target);
  if (action === "copy-output") copyOutput(id);
  if (action === "open-html")   openOutputAsHtml(id);
  if (action === "history")     showHistory(id);
  if (action === "diff")        showDiff(id);
});

document.getElementById("agent-list").addEventListener("change", e => {
  const toggle = e.target.closest("[data-action='toggle']");
  if (toggle) toggleAgent(toggle.dataset.id, toggle.checked);

  const selectCb = e.target.closest("[data-action='select']");
  if (selectCb) {
    if (selectCb.checked) selectedIds.add(selectCb.dataset.id);
    else                  selectedIds.delete(selectCb.dataset.id);
    updateExportBtn();
  }
});

// Group header button delegation
document.getElementById("agent-list").addEventListener("click", e => {
  const runBtn    = e.target.closest("[data-group-run]");
  const toggleBtn = e.target.closest("[data-group-toggle]");
  if (runBtn) {
    runGroup(runBtn.dataset.groupRun);
  } else if (toggleBtn) {
    const group   = toggleBtn.dataset.groupToggle;
    const enabled = toggleBtn.dataset.groupEnabled === "true";
    setGroupEnabled(group, !enabled);
  }
});

// ── Run All ───────────────────────────────────────────────────────────────────
document.getElementById("btn-run-all").addEventListener("click", async () => {
  if (!workerActive) {
    const start = await window.agentAPI.startWorker();
    if (!start.ok) { toast(start.error || "Configure a provider in Settings first.", "error"); return; }
  }
  const res = await window.agentAPI.runAll();
  if (res.success) toast(`Running ${res.count} agent(s) now.`, "info");
  else             toast(res.error || "Could not run agents.", "error");
});

// ── Chain graph ───────────────────────────────────────────────────────────────
document.getElementById("btn-view-chain").addEventListener("click", openChainGraph);
document.getElementById("btn-close-chain").addEventListener("click", () => document.getElementById("chain-overlay").classList.remove("open"));
document.getElementById("btn-close-chain-footer").addEventListener("click", () => document.getElementById("chain-overlay").classList.remove("open"));
document.getElementById("chain-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) document.getElementById("chain-overlay").classList.remove("open");
});

function openChainGraph() {
  const content = document.getElementById("chain-content");
  const warning = document.getElementById("chain-cycle-warning");

  // Build adjacency map
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const chained  = agents.filter(a => a.chainTo?.length);

  if (!chained.length) {
    content.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:16px 0">No agent chains configured yet.</div>`;
    warning.style.display = "none";
    document.getElementById("chain-overlay").classList.add("open");
    return;
  }

  // Detect cycles via DFS
  const cycles = [];
  function detectCycle(startId, visited = new Set(), path = []) {
    if (visited.has(startId)) {
      const cycleStart = path.indexOf(startId);
      if (cycleStart !== -1) cycles.push([...path.slice(cycleStart), startId]);
      return;
    }
    visited.add(startId);
    path.push(startId);
    const agent = agentMap.get(startId);
    for (const nextId of (agent?.chainTo || [])) {
      detectCycle(nextId, new Set(visited), [...path]);
    }
  }
  for (const a of agents) detectCycle(a.id);
  const cycleIds = new Set(cycles.flatMap(c => c));

  // Render chain tree
  const rendered = new Set();
  let html = "";

  function renderChain(id, depth = 0) {
    const a = agentMap.get(id);
    if (!a) return `<div class="chain-node chain-missing" style="margin-left:${depth * 20}px">⚠ [deleted agent ${id}]</div>`;
    const isCyclic = cycleIds.has(id);
    const alreadyShown = rendered.has(id) && !isCyclic;
    rendered.add(id);
    let node = `<div class="chain-node${isCyclic ? " chain-cyclic" : ""}" style="margin-left:${depth * 20}px">
      ${depth > 0 ? '<span class="chain-arrow">↳</span>' : ''}
      <span class="chain-name">${esc(a.name)}</span>
      ${isCyclic ? '<span class="chain-cycle-tag">⟳ cycle</span>' : ''}
      ${a.chainTo?.length && !alreadyShown ? `<span class="chain-cond" title="Chain condition">${esc(a.chainCondition || "success")}</span>` : ""}
    </div>`;
    if (a.chainTo?.length && !alreadyShown) {
      for (const nextId of a.chainTo) node += renderChain(nextId, depth + 1);
    }
    return node;
  }

  // Find root nodes (not targeted by any chain)
  const targetIds = new Set(agents.flatMap(a => a.chainTo || []));
  const roots = chained.filter(a => !targetIds.has(a.id));
  // Also include any chained agents that are targeted by roots
  const allRoots = roots.length ? roots : chained.slice(0, 1);

  html = allRoots.map(a => renderChain(a.id)).join("");

  content.innerHTML = html;
  if (cycles.length) {
    const names = [...new Set(cycles.flat())].map(id => agentMap.get(id)?.name || id).join(", ");
    warning.textContent = `⚠ Circular dependency detected involving: ${names}`;
    warning.style.display = "";
  } else {
    warning.style.display = "none";
  }
  document.getElementById("chain-overlay").classList.add("open");
}

// ── Output Diff ───────────────────────────────────────────────────────────────
document.getElementById("btn-close-diff").addEventListener("click", () => document.getElementById("diff-overlay").classList.remove("open"));
document.getElementById("btn-close-diff-footer").addEventListener("click", () => document.getElementById("diff-overlay").classList.remove("open"));
document.getElementById("diff-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) document.getElementById("diff-overlay").classList.remove("open");
});

async function showDiff(id) {
  const a = agents.find(x => x.id === id);
  if (!a) return;
  document.getElementById("diff-title").textContent = `Output Diff — ${a.name}`;

  const entries = await window.agentAPI.getAgentHistory(id);
  const diffContent = document.getElementById("diff-content");

  if (entries.length < 2) {
    diffContent.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:16px 0">Need at least 2 runs to show a diff. Run the agent again first.</div>`;
    document.getElementById("diff-overlay").classList.add("open");
    return;
  }

  const current  = (entries[0].result || "").split("\n");
  const previous = (entries[1].result || "").split("\n");

  diffContent.innerHTML = _computeLineDiff(previous, current);
  document.getElementById("diff-overlay").classList.add("open");
}

/**
 * Simple LCS-based line diff. Returns HTML with added/removed/unchanged spans.
 */
function _computeLineDiff(oldLines, newLines) {
  // Build LCS table
  const m = oldLines.length, n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i-1] === newLines[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }
  // Backtrack
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i-1] === newLines[j-1]) {
      ops.unshift({ type: "same", line: oldLines[i-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.unshift({ type: "add",  line: newLines[j-1]  }); j--;
    } else {
      ops.unshift({ type: "del",  line: oldLines[i-1]  }); i--;
    }
  }
  return ops.map(op => {
    const cls   = op.type === "add" ? "diff-add" : op.type === "del" ? "diff-del" : "diff-same";
    const prefix = op.type === "add" ? "+" : op.type === "del" ? "−" : " ";
    return `<div class="${cls}"><span class="diff-prefix">${prefix}</span>${esc(op.line)}</div>`;
  }).join("") || `<div style="color:var(--text-secondary);font-size:13px">No differences found.</div>`;
}

// ── Groups ────────────────────────────────────────────────────────────────────
function populateGroupDatalist() {
  const dl = document.getElementById("f-group-list");
  if (!dl) return;
  const names = [...new Set(agents.map(a => a.group).filter(Boolean))].sort();
  dl.innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join("");
}

async function runGroup(group) {
  if (!workerActive) {
    const start = await window.agentAPI.startWorker();
    if (!start.ok) { toast(start.error || "Configure a provider in Settings first.", "error"); return; }
  }
  const res = await window.agentAPI.runGroup(group);
  if (res.success) toast(`Running ${res.count} agent(s) in group "${group}".`, "info");
  else             toast(res.error || "Could not run group.", "error");
}

async function setGroupEnabled(group, enabled) {
  const res = await window.agentAPI.setGroupEnabled(group, enabled);
  if (res.success) {
    agents = await window.agentAPI.listAgents();
    renderAgentList();
    toast(`Group "${group}" ${enabled ? "enabled" : "disabled"}.`, "info");
  } else {
    toast(res.error || "Could not update group.", "error");
  }
}

// ── Form event listeners ──────────────────────────────────────────────────────
document.getElementById("tab-prompt").addEventListener("click", () => setFormType("prompt"));
document.getElementById("tab-script").addEventListener("click", () => setFormType("script"));
document.getElementById("btn-pick-script").addEventListener("click", pickScriptFile);
document.getElementById("btn-add-agent").addEventListener("click", submitAddAgent);
document.getElementById("btn-cancel-edit").addEventListener("click", resetForm);
document.getElementById("btn-open-data-dir").addEventListener("click", () => window.agentAPI.openDataDir());

document.getElementById("btn-export-agents").addEventListener("click", async () => {
  if (!selectionMode) {
    if (!agents.length) { toast("No agents to export.", "info"); return; }
    selectionMode = true;
    selectedIds   = new Set();
    document.getElementById("agent-list").classList.add("selection-mode");
    document.getElementById("btn-cancel-selection").style.display = "";
    document.getElementById("btn-import-agents").style.display    = "none";
    updateExportBtn();
    renderAgentList();
    toast("Check the agents you want to export, then click Export Selected.", "info");
  } else {
    if (!selectedIds.size) { toast("Select at least one agent to export.", "info"); return; }
    const res = await window.agentAPI.exportAgents([...selectedIds]);
    if (res.canceled) { exitSelectionMode(); return; }
    if (!res.success) { toast(res.error || "Export failed.", "error"); return; }
    exitSelectionMode();
    toast(`Exported ${res.count} agent${res.count !== 1 ? "s" : ""} successfully.`, "success");
  }
});

document.getElementById("btn-cancel-selection").addEventListener("click", exitSelectionMode);

function updateExportBtn() {
  const btn = document.getElementById("btn-export-agents");
  btn.textContent = selectionMode
    ? `⬇ Export Selected${selectedIds.size ? ` (${selectedIds.size})` : ""}`
    : "⬇ Export";
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds   = new Set();
  document.getElementById("agent-list").classList.remove("selection-mode");
  document.getElementById("btn-cancel-selection").style.display = "none";
  document.getElementById("btn-import-agents").style.display    = "";
  updateExportBtn();
  renderAgentList();
}

document.getElementById("btn-import-agents").addEventListener("click", async () => {
  const res = await window.agentAPI.importAgents();
  if (res.canceled) return;
  if (!res.success) { toast(res.error || "Import failed.", "error"); return; }

  agents = await window.agentAPI.listAgents();
  renderAgentList();
  populateChainToDropdown();

  let msg = `Imported ${res.imported} agent${res.imported !== 1 ? "s" : ""}.`;
  if (res.skipped.length) msg += ` Skipped ${res.skipped.length} duplicate${res.skipped.length !== 1 ? "s" : ""} (${res.skipped.join(", ")}).`;
  toast(msg, res.imported ? "success" : "info");
});

document.getElementById("f-provider").addEventListener("change", onProviderChange);
document.getElementById("f-schedule-pick").addEventListener("change", onScheduleChange);
document.getElementById("f-temp").addEventListener("input", () => {
  document.getElementById("temp-val").textContent = document.getElementById("f-temp").value;
});

// Wire webhook toggle
document.getElementById("f-webhook-enabled")?.addEventListener("change", () => {
  const enabled = document.getElementById("f-webhook-enabled").checked;
  document.getElementById("f-webhook-url-wrap").style.display = enabled ? "" : "none";
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeSettings();
    closeAnalytics();
    closeStore();
    document.getElementById("history-overlay").classList.remove("open");
    document.getElementById("packs-overlay").classList.remove("open");
    document.getElementById("chain-overlay").classList.remove("open");
    document.getElementById("diff-overlay").classList.remove("open");
  }
});

// ── Background refresh ────────────────────────────────────────────────────────
setInterval(async () => {
  agents = await window.agentAPI.listAgents();
  renderAgentList();
}, 30_000);

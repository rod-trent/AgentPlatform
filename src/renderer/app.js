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

  window.agentAPI.onAgentsUpdated((updated) => {
    agents = updated;
    renderAgentList();
    populateChainToDropdown();
  });
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

// ── Chain-to dropdown ─────────────────────────────────────────────────────────

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

  const chainedAgent = a.chainTo?.length ? agents.find(x => x.id === a.chainTo[0]) : null;
  const chainBadge   = chainedAgent
    ? `<span class="fluent-badge badge-chain" title="Chains to ${esc(chainedAgent.name)}">⛓ ${esc(chainedAgent.name)}</span>`
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
        ${typeBadge}${provBadge}${chainBadge}
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

  // Chain-to
  populateChainToDropdown(id);
  const chainSel = document.getElementById("f-chain-to");
  chainSel.value = (a.chainTo && a.chainTo[0]) ? a.chainTo[0] : "";

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

  const payload = {
    name,
    description: document.getElementById("f-desc").value.trim(),
    type: formType,
    schedule,
    chainTo: chainVal ? [chainVal] : [],
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

// ── Reset form ────────────────────────────────────────────────────────────────
function resetForm() {
  editingAgentId = null;

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
  document.getElementById("f-chain-to").value = "";
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

async function saveSettings() {
  const defaultProvider      = document.getElementById("s-default-provider").value;
  const minimizeToTray       = document.getElementById("s-minimize-to-tray").checked;
  const runAtStartup         = document.getElementById("s-run-at-startup").checked;
  const notificationsEnabled = document.getElementById("s-notifications").checked;

  const apiKey = document.getElementById("s-api-key").value.trim();
  const baseUrl = document.getElementById("s-base-url").value.trim();

  const providers = {};
  if (activeSettingsProvider) {
    providers[activeSettingsProvider] = {};
    if (apiKey)  providers[activeSettingsProvider].apiKey  = apiKey;
    if (baseUrl) providers[activeSettingsProvider].baseUrl = baseUrl;
  }

  const res = await window.agentAPI.saveSettings({
    defaultProvider, minimizeToTray, runAtStartup, notificationsEnabled, providers,
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

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeSettings();
    document.getElementById("history-overlay").classList.remove("open");
    document.getElementById("packs-overlay").classList.remove("open");
  }
});

// ── Background refresh ────────────────────────────────────────────────────────
setInterval(async () => {
  agents = await window.agentAPI.listAgents();
  renderAgentList();
}, 30_000);

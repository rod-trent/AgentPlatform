# AI Agent Platform

A standalone Windows 11 desktop application for scheduling and running AI agents against any major LLM provider — no Python, no Streamlit, no external runtime required.

Built with [Electron](https://electronjs.org) and styled to the Windows 11 Fluent Design System.

---

![AI Agent Platform v1.3.0](https://github.com/rod-trent/AgentPlatform/blob/main/Images/v1.3.0-Main.png)

---

## Features

- **Multi-provider LLM support** — xAI (Grok), OpenAI, Anthropic (Claude), Ollama (local), or any OpenAI-compatible custom endpoint
- **Two agent types**
  - **Prompt agents** — send a system + user prompt to an LLM on a schedule and capture the response
  - **Script agents** — run any existing script or executable (Python, PowerShell, Node.js, etc.) on a schedule
- **Cron scheduling** — pick from common presets, use the visual cron builder, or write your own expression
- **Edit agents after creation** — change provider, model, prompts, or schedule at any time
- **Export & import agents** — share agent definitions as portable JSON files; import packs shared by others
- **Real-time status** — live status indicators and output display on each agent card
- **System tray** — optionally minimize to the system tray and keep agents running in the background
- **Windows 11 Fluent UI** — Mica material, Acrylic blur, Fluent motion, Segoe UI Variable
- **No cloud dependency** — all data stays on your machine in `Documents\AIAgentPlatform\`
- **OneDrive sync** — because data lives in `Documents\`, any cloud sync tool (OneDrive, Dropbox, etc.) automatically roams your agents, settings, and provider keys across every machine you install the app on

### New in v1.3.0

- **Agent groups** — tag any agent into a named group. Group headers appear in the agent list with **▶ Run Group** and **Enable/Disable All** buttons to start or stop an entire group at once
- **Run All Now** — a single **▶▶ Run All** button in the header triggers every enabled agent immediately, no need to click each card individually
- **Tray run-on-demand** — right-click the system tray icon to run any individual agent or an entire group directly from the tray, without opening the main window
- **Output diffing** — a **Diff** button on each agent card opens a side-by-side line diff of the current run vs. the previous run, with added lines in green and removed lines in red
- **MCP server per agent** — attach an optional MCP server URL to any prompt agent; the platform fetches the available tool list before each run and injects it into the system prompt as context
- **Outbound webhooks on completion** — configure a webhook URL per agent; on every run the platform POSTs `{agentId, name, status, result, timestamp}` to your Slack, Teams, or any HTTP endpoint
- **Chain graph visualization** — the **⛓ Chains** button opens a visual tree of all agent chains; a built-in DFS cycle detector highlights circular dependencies in red before they cause problems
- **Automatic date/time context** — every prompt agent now receives a `[System context — Today: …]` header automatically, so the LLM always knows the current date and time without requiring `{{date}}` in the prompt
- **Geolocation** — on startup the app performs a background IP-based location lookup; `{{location}}`, `{{city}}`, `{{country}}`, and `{{region}}` are now available as prompt template variables and are included in the auto-injected context header
- **Store badge fix** — the new-items badge on the **🛒 Store** button now correctly tracks which files you have already seen rather than comparing against installed agent names
- **Startup minimize fix** — the "minimize to tray at startup" behavior is now fully reliable on Windows via a dedicated `--hidden` launch argument

### New in v1.2.0

- **Agent Store** — the **🛒 Store** button opens a live gallery of agents from the GitHub repository. Install any individual agent in one click. A red badge shows how many new agents are available
- **Run Analytics** — the **📊 Analytics** button shows a table of run stats per agent: total runs, success rate, failures, average duration, and last run time
- **Variable substitution** — use `{{date}}`, `{{time}}`, `{{dayOfWeek}}`, `{{lastResult}}`, `{{env:VAR_NAME}}` and more directly in system and user prompts
- **Conditional chaining** — choose when a chained agent fires: on success, always, on error only, or when output contains a keyword
- **Webhook trigger server** — expose a local HTTP endpoint (`POST http://127.0.0.1:7171/trigger/{agentId}`) to trigger agents from scripts, CI pipelines, or any other tool
- **Encrypted API key storage** — keys are now encrypted at rest using the Windows Credential Manager via Electron's `safeStorage` API
- **Start minimized to tray** — when both "Run at Startup" and "Minimize to Tray" are enabled, the app launches silently to the system tray with the scheduler running
- **Powered-by footer** — every successful agent output includes a branded *AgentName* is Powered by the **AI Agent Platform** footer

### New in v1.1.0

- **Output history** — every run result is persisted per agent (up to 50 entries). Click **History** on any card to browse past runs, copy results, or open them as HTML
- **Windows toast notifications** — native Windows notifications fire on agent completion or failure; toggle on/off in Settings
- **Agent chaining** — pipe the output of one agent directly into the input of another. Set a **Chain To** target when creating or editing an agent and the downstream agent triggers automatically on success
- **Import from clipboard** — the **📋 Paste** button next to the User Prompt field reads your clipboard directly into the prompt field, so you can paste a prompt from any chat session in seconds
- **Test before saving** — the **▶ Test** button runs your current agent configuration once without saving it, showing the result (or error) inline in the sidebar
- **Copy output** — a **📋** button on each card copies the latest output to the clipboard in one click
- **Open output as HTML** — a **🌐** button renders the agent's markdown output as a styled HTML page and opens it in your default browser
- **Enhanced cron builder** — "Custom cron…" now reveals a two-tab panel: a visual **Builder** (choose frequency, time, and day from dropdowns with a live plain-English preview) and a raw **Expression** tab for power users
- **Community agent packs** — the **🌐 Packs** button opens a gallery of ready-to-import agent collections. Click **Install** to add an entire pack in one step

---

## Requirements

| Requirement | Version |
|---|---|
| Windows | 10 or 11 (x64 or ARM64) |
| [Node.js](https://nodejs.org) | 20 LTS or later |

---

## Getting Started

### Run in development

```bat
npm install
npm start
```

### Build the Windows installer

```bat
build-electron.bat
```

Or manually:

```bat
npm install
npm run build
```

The installer is written to `dist\AI Agent Platform Setup 1.3.0.exe`.

---

## Configuration

Open the **Settings** dialog (⚙ button, top-right) to:

1. **Set your default LLM provider**
2. **Configure API keys** for each provider you want to use
3. **Toggle "Minimize to System Tray"** — when enabled, closing the window keeps agents running in the background
4. **Toggle "Windows Notifications"** — enable or disable native Windows toast notifications on agent completion or failure
5. **Toggle "Webhook Trigger Server"** — expose a local HTTP endpoint to trigger agents from external tools; configure the port (default: 7171)

API keys are encrypted at rest using the Windows Credential Manager and are never transmitted anywhere except directly to the chosen provider's API endpoint.

---

## Supported Providers

| Provider | Notes |
|---|---|
| **xAI (Grok)** | Requires an [xAI API key](https://console.x.ai) |
| **OpenAI** | Requires an [OpenAI API key](https://platform.openai.com) |
| **Anthropic (Claude)** | Requires an [Anthropic API key](https://console.anthropic.com) |
| **Ollama (Local)** | No key required — Ollama must be running locally |
| **Custom / Other** | Any OpenAI-compatible endpoint — enter your base URL and key |

---

## Agent Types

### Prompt Agent

Calls an LLM API on a schedule with a configurable system prompt and user prompt. The response is captured, stored, and displayed on the agent card.

**Use cases:** daily summaries, content generation, data analysis, automated research.

### Script Agent

Runs any existing script or executable on a schedule using `execFile` (no shell injection risk). Captures stdout + stderr and displays the output on the agent card.

**Use cases:** import and schedule existing Python/PowerShell agents, data pipelines, system automation.

---

## Agent Chaining

Agents can be chained together so that the output of one becomes the input of the next. Set the **Chain To** dropdown when creating or editing a prompt agent, then choose a **Chain Condition**:

| Condition | Behaviour |
|---|---|
| On success | Chains only when the upstream agent completes successfully (default) |
| Always | Chains regardless of outcome |
| On error only | Chains when the upstream agent fails |
| If output contains… | Chains only when the output includes a specified keyword |

After the condition is met, the upstream result is automatically injected as the `userPrompt` of the downstream agent and triggers it immediately.

**Example:** a *News Summarizer* agent feeds its output into a *Tweet Drafter* agent, which turns the summary into ready-to-post social copy — all on a schedule, hands-free.

---

## Agent Store

Click **🛒 Store** in the Active Agents header to browse individual agents available from the project repository. Each card shows the agent's name, provider, model, and description. Click **Add** to install any agent in one step. A red badge on the button indicates how many agents are available that you haven't yet installed.

## Community Agent Packs

Click **🌐 Packs** in the Active Agents header to browse the community pack gallery. Each pack is a curated collection of ready-to-use agents. Click **Install** to import the entire pack in one step.

Packs included out of the box:

| Pack | Agents | Schedule |
|---|---|---|
| Cybersecurity Daily Briefing | 1 | Daily at 7 AM |
| Morning Briefing Pack | 2 | Daily at 8 AM |
| Finance & Markets Pack | 1 | Daily at 6 PM |
| Daily Learning Pack | 1 | Daily at 8 AM |
| AI & Tech Digest Pack | 2 | Daily at 7 AM / Mondays at 9 AM |
| Daily Productivity Pack | 1 | Weekdays at 7 AM |

---

## Sharing Agents

Agents can be exported and imported as self-contained JSON files, making it easy to share your work with others running AI Agent Platform.

### Export

Click the **⬇ Export** button in the Active Agents header to open a Save dialog. The exported file contains all agent definitions — name, prompts, provider, model, schedule — but strips runtime state (last run time, last result). API keys are never included.

### Import

Click the **⬆ Import** button and select a previously exported `.json` file. The importer:

- Accepts the standard export envelope format or a bare array
- Skips any agent whose name already exists locally (reports skipped names in the status toast)
- Adds all new agents immediately and updates the scheduler if it is running

Exported files can be shared via email, GitHub, a shared drive, or anywhere else — they are plain JSON with no credentials.

---

## Data Storage

All user data is stored in `Documents\AIAgentPlatform\` — visible to you, survives app updates and reinstalls:

```
Documents\AIAgentPlatform\
├── agent_registry.json     ← agent definitions and latest run state
├── settings.json           ← provider config and preferences
└── history\
    └── {agentId}.json      ← per-agent run history (up to 50 entries each)
```

Because this folder sits inside `Documents\`, it is automatically picked up by **OneDrive** (and any other folder-sync tool you use). Install the app on a second machine, and your agents, settings, and provider keys are already there — no export, no copy, no extra configuration required.

---

## Project Structure

```
src/
  main/
    index.js          ← Electron main process, IPC handlers, tray
    preload.js        ← contextBridge API surface (window.agentAPI)
    registry.js       ← Agent CRUD, persisted to Documents/
    worker.js         ← cron scheduler, variable substitution, chaining, MCP context, outbound webhooks, notifications
    grokClient.js     ← Multi-provider LLM client (OpenAI SDK)
    history.js        ← Per-agent run history persistence
    webhook.js        ← Local HTTP trigger server (loopback only)
  renderer/
    index.html        ← App shell
    styles.css        ← Windows 11 Fluent Design System
    app.js            ← UI logic
packs/
  index.json          ← Community agent packs index
Samples/
  *.json              ← Individual sample agents (also available via the Agent Store)
```

---

## License

MIT — see [LICENSE](LICENSE) for details.

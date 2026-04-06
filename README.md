# AI Agent Platform

A standalone Windows 11 desktop application for scheduling and running AI agents against any major LLM provider — no Python, no Streamlit, no external runtime required.

Built with [Electron](https://electronjs.org) and styled to the Windows 11 Fluent Design System.

---

![AI Agent Platform v1.1.0](https://github.com/rod-trent/AgentPlatform/blob/main/Images/v1.1.0-Main.png)

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

The installer is written to `dist\AI Agent Platform Setup 1.1.0.exe`.

---

## Configuration

Open the **Settings** dialog (⚙ button, top-right) to:

1. **Set your default LLM provider**
2. **Configure API keys** for each provider you want to use
3. **Toggle "Minimize to System Tray"** — when enabled, closing the window keeps agents running in the background
4. **Toggle "Windows Notifications"** — enable or disable native Windows toast notifications on agent completion or failure

API keys are stored locally in `Documents\AIAgentPlatform\settings.json` and are never transmitted anywhere except directly to the chosen provider's API endpoint.

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

Agents can be chained together so that the output of one becomes the input of the next. Set the **Chain To** dropdown when creating or editing a prompt agent. After a successful run, the result is automatically injected as the `userPrompt` of the downstream agent and triggers it immediately.

**Example:** a *News Summarizer* agent feeds its output into a *Tweet Drafter* agent, which turns the summary into ready-to-post social copy — all on a schedule, hands-free.

---

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
    worker.js         ← cron scheduler, script runner, notifications, chaining
    grokClient.js     ← Multi-provider LLM client (OpenAI SDK)
    history.js        ← Per-agent run history persistence
  renderer/
    index.html        ← App shell
    styles.css        ← Windows 11 Fluent Design System
    app.js            ← UI logic
packs/
  index.json          ← Community agent packs index
```

---

## License

MIT — see [LICENSE](LICENSE) for details.

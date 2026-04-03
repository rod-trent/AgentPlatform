# AI Agent Platform

A standalone Windows 11 desktop application for scheduling and running AI agents against any major LLM provider — no Python, no Streamlit, no external runtime required.

Built with [Electron](https://electronjs.org) and styled to the Windows 11 Fluent Design System.

---

## Features

- **Multi-provider LLM support** — xAI (Grok), OpenAI, Anthropic (Claude), Ollama (local), or any OpenAI-compatible custom endpoint
- **Two agent types**
  - **Prompt agents** — send a system + user prompt to an LLM on a schedule and capture the response
  - **Script agents** — run any existing script or executable (Python, PowerShell, Node.js, etc.) on a schedule
- **Cron scheduling** — pick from common presets or write your own cron expression
- **Edit agents after creation** — change provider, model, prompts, or schedule at any time
- **Export & import agents** — share agent definitions as portable JSON files; import packs shared by others
- **Real-time status** — live status indicators and output display on each agent card
- **System tray** — optionally minimize to the system tray and keep agents running in the background
- **Windows 11 Fluent UI** — Mica material, Acrylic blur, Fluent motion, Segoe UI Variable
- **No cloud dependency** — all data stays on your machine in `Documents\AIAgentPlatform\`

---

## Requirements

| Requirement | Version |
|---|---|
| Windows | 10 or 11 (x64) |
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

The installer is written to `dist\AI Agent Platform Setup 1.0.0.exe`.

---

## Configuration

Open the **Settings** dialog (⚙ button, top-right) to:

1. **Set your default LLM provider**
2. **Configure API keys** for each provider you want to use
3. **Toggle "Minimize to System Tray"** — when enabled, closing the window keeps agents running in the background

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
├── agent_registry.json   ← agent definitions and run history
└── settings.json         ← provider config and preferences
```

---

## Project Structure

```
src/
  main/
    index.js          ← Electron main process, IPC handlers, tray
    preload.js        ← contextBridge API surface (window.agentAPI)
    registry.js       ← Agent CRUD, persisted to Documents/
    worker.js         ← cron scheduler, script runner
    grokClient.js     ← Multi-provider LLM client (OpenAI SDK)
  renderer/
    index.html        ← App shell
    styles.css        ← Windows 11 Fluent Design System
    app.js            ← UI logic
```

---

## License

MIT — see [LICENSE](LICENSE) for details.

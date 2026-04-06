# Release Notes — AI Agent Platform

---

## v1.1.0 — April 6, 2026

### New Features

#### Output History
Every agent run is now persisted to a per-agent history file (`Documents\AIAgentPlatform\history\{agentId}.json`), keeping up to 50 entries. Click **History** on any agent card to browse past runs with timestamp, status, and full output. Each history entry has individual **Copy** and **Open as HTML** actions.

#### Windows Toast Notifications
Native Windows notifications fire automatically when an agent completes or fails. Notification support can be toggled on or off in the Settings dialog. Enabled by default.

#### Agent Chaining
Agents can now be chained together. Set the **Chain To** field on any prompt agent to target another agent. On a successful run, the output of the first agent is injected as the `userPrompt` of the chained agent and triggers it immediately. Chained targets are shown as a badge on the agent card.

#### Import from Clipboard
A **📋 Paste** button next to the User Prompt field reads the current clipboard contents directly into the field — no manual copy-paste between windows required.

#### Test Before Saving
A **▶ Test** button in the sidebar runs the current form configuration once without saving it. The result or error is displayed inline below the form. Iterate and refine before committing to a saved agent.

#### Copy Output Button
A **📋** button on each agent card copies the latest run output to the clipboard in one click.

#### Open Output as HTML
A **🌐** button on each agent card converts the agent's markdown output to a styled HTML page and opens it in the default browser. The renderer handles headings, lists, code blocks, bold, italic, and links — no external libraries required.

#### Enhanced Custom Cron Builder
The "Custom cron…" schedule option now opens a two-tab panel:
- **Builder** — visual dropdowns for frequency, time, and day, with a live cron expression and plain-English description that update as you type
- **Expression** — direct cron text entry for power users, with a field-order hint

#### Community Agent Packs
A **🌐 Packs** button in the Active Agents header opens a gallery that fetches agent packs from the project repository. Each pack is a curated, ready-to-import collection. Click **Install** to add an entire pack in one step.

Six packs are included in the initial index:

| Pack | Agents |
|---|---|
| Cybersecurity Daily Briefing | 1 |
| Morning Briefing Pack | 2 |
| Finance & Markets Pack | 1 |
| Daily Learning Pack | 1 |
| AI & Tech Digest Pack | 2 |
| Daily Productivity Pack | 1 |

### Bug Fixes

- Fixed Community Packs dialog not scrolling when the pack list exceeded the visible area.

### Under the Hood

- Added `src/main/history.js` — isolated module for per-agent run history persistence and cleanup
- Added `packs/index.json` — community packs index; served directly from the GitHub repository
- `registry.js` — added `chainTo` field to agent schema; `deleteAgent` now cleans up the corresponding history file
- `worker.js` — added `testAgentConfig()` for one-off test runs; added native `Notification` calls; added chaining logic post-execution
- `index.js` — added IPC handlers: `agents:test`, `agents:getHistory`, `shell:openMarkdownInBrowser`, `clipboard:read`, `packs:fetch`, `packs:import`; added `notificationsEnabled` and `packsUrl` to settings
- `preload.js` — exposed all new IPC methods; added `onAgentsUpdated` push subscription
- Export handler now includes `chainTo` in exported agent definitions

---

## v1.0.0 — April 3, 2026

Initial release.

### Features

- **Multi-provider LLM support** — xAI (Grok), OpenAI, Anthropic (Claude), Ollama (local), and any OpenAI-compatible custom endpoint
- **Prompt agents** — schedule system + user prompts against any configured LLM provider; configurable model, temperature, and cron schedule
- **Script agents** — run any script or executable (Python, PowerShell, Node.js, `.exe`, etc.) on a cron schedule via `execFile`
- **Cron scheduling** — preset dropdown (every 5 min through daily/weekly) plus custom expression entry; `node-cron` backend with overlap prevention
- **Real-time status** — live status indicators (idle, running, success, error) and output display on each agent card
- **Edit agents** — modify provider, model, prompts, schedule, or any field after creation
- **Export & import** — export agent definitions to a portable JSON file; import from file, with duplicate detection and skip reporting
- **Per-agent export selection** — checkbox selection mode to export a subset of agents
- **System tray** — minimize to tray keeps the scheduler running in the background; tray context menu for start/stop/quit
- **Run at Windows startup** — optional login item via the Windows registry
- **Windows 11 Fluent Design** — Mica material, Acrylic blur, Fluent motion, Segoe UI Variable
- **No runtime dependencies on target machine** — Node.js and Electron bundled in the installer
- **ARM64 / Snapdragon support** — universal NSIS installer targets both x64 and ARM64
- **OneDrive sync** — data stored in `Documents\AIAgentPlatform\` is automatically roamed by any folder-sync service
- **Single-instance lock** — second launch focuses the existing window
- **Settings dialog** — per-provider API key management with masked display and hint; base URL override for custom endpoints; version display
- **Sample agent packs** — six ready-to-import sample agents included in the `Samples\` directory
- Output capture limit: 50,000 characters per run
- IPC security: all handlers validate `file://` origin before processing

---

*For the full changelog see the [commit history](https://github.com/rod-trent/AgentPlatform/commits/main).*

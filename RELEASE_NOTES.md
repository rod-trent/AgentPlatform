# Release Notes — AI Agent Platform

---

## v1.2.0 — April 9, 2026

### New Features

#### Agent Store
A **🛒 Store** button in the Active Agents header opens a live gallery of ready-to-install agents pulled directly from the project's GitHub `Samples/` directory. Each card shows the agent's name, provider, model, and description. Click **Add** to install any individual agent in one step — with duplicate detection. A red badge on the Store button signals how many agents are available that you haven't installed yet.

#### Run Analytics Dashboard
A **📊 Analytics** button opens a table showing aggregated run statistics for every agent: total runs, success rate (colour-coded green/yellow/red), failure count, average duration, and time of last run. Powered by the run history data already collected per agent.

#### Variable Substitution in Prompts
Prompt agents now support dynamic template variables in both system and user prompts:

| Variable | Resolves to |
|---|---|
| `{{date}}` | Today's date (localised) |
| `{{time}}` | Current time (localised) |
| `{{datetime}}` | Full date and time |
| `{{dayOfWeek}}` | e.g. Monday, Tuesday… |
| `{{year}}` / `{{month}}` / `{{day}}` | Numeric date parts |
| `{{lastResult}}` | The agent's most recent output |
| `{{env:VAR_NAME}}` | Any environment variable |

A hint row below the User Prompt field shows the available variables at a glance.

#### Conditional Agent Chaining
The **Chain To** feature now supports four trigger conditions selectable from a dropdown:

- **On success** — chains only when the upstream agent completes successfully (previous default, unchanged)
- **Always** — chains regardless of outcome
- **On error only** — chains when the upstream agent fails (useful for error-handling agents)
- **If output contains…** — chains only when the output includes a specified keyword

#### Webhook Trigger Server
Agents can now be triggered by external tools over a local HTTP endpoint. Enable the webhook server in **Settings** and configure the port (default: 7171). Once running, any script, CI pipeline, or other app can trigger an agent with:

```
POST http://127.0.0.1:7171/trigger/{agentId}
```

The server binds exclusively to `127.0.0.1` — it is never exposed to the network. The live trigger URL is shown in the Settings dialog as you configure it.

#### Encrypted API Key Storage
API keys are now encrypted before being written to `settings.json` using Electron's `safeStorage` API, which is backed by the Windows Credential Manager. Keys saved in previous versions are migrated transparently on the next save. No change to the Settings UI is required.

#### Start Minimized to System Tray
When **Run at Windows Startup** is enabled and **Minimize to System Tray** is on, the app now launches directly to the tray without showing the window. The scheduler starts immediately and the tray icon is available to open the window at any time.

#### Powered-by Footer on Agent Output
Every successful agent run now appends a branded footer to its output:

> *AgentName* is Powered by the **AI Agent Platform**

The footer renders with Markdown formatting in the HTML browser view and reads cleanly as plain text in the card and clipboard copy.

### Under the Hood

- `worker.js` — added `resolveVariables()` for template substitution; added `_chainShouldFire()` for conditional chaining logic; `recordRun` now receives and stores run `duration`
- `history.js` — history entries now include a `duration` field (milliseconds), used by the analytics dashboard
- `registry.js` — `chainCondition` added to agent schema; `recordRun` signature updated to accept duration
- `webhook.js` — new module; local HTTP trigger server bound to loopback only
- `index.js` — `safeStorage` encryption for API keys; `wasOpenedAtLogin` startup-minimize logic; IPC handlers added: `agents:getAnalytics`, `store:fetch`, `store:getAgent`; `_fetchJson` updated to follow redirects and send GitHub API `Accept` header; `process.emitWarning` patched to suppress the transitive `punycode` deprecation warning
- `preload.js` — exposed `getAnalytics`, `fetchStore`, `getStoreAgent`
- Export format updated to include `chainCondition`

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

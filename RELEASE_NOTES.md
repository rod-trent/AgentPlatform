# Release Notes — AI Agent Platform

---

## v1.3.0 — April 14, 2026

### New Features

#### Agent Groups
Tag any agent into a named group using the new **Group** field in the Add/Edit Agent form. When groups exist, the agent list renders group headers showing the group name and agent count. Each header has two buttons:
- **▶ Run Group** — triggers every enabled agent in the group immediately
- **Enable/Disable All** — toggles all agents in the group on or off in one click

Groups also appear in the system tray right-click menu, so you can start an entire group without opening the main window.

#### Run All Now
A **▶▶ Run All** button in the Active Agents header triggers every currently enabled agent at once. The scheduler does not need to be running — the button starts it automatically if needed.

#### Run on Demand from the System Tray
The tray right-click context menu now includes a **Run Agent** submenu that lists every enabled agent by name. Agents can also be launched by group from the same menu. The tray menu rebuilds automatically whenever agents are added, edited, enabled, or deleted.

#### Output Diffing
A **Diff** button appears on each agent card after the agent has run at least once. Clicking it opens a dialog that computes a line-by-line diff between the current run output and the previous run output using the Longest Common Subsequence algorithm. Added lines are shown in green, removed lines in red, and unchanged lines in grey.

#### MCP Server Integration
Each prompt agent now has an optional **MCP Server URL** field. Before every run, if a URL is configured, the platform fetches the tool list from `{mcpUrl}/mcp/v1/tools` and prepends the available tool descriptions to the agent's system prompt. This gives the LLM full awareness of what MCP tools it can reference without any manual prompt engineering. If the MCP server is unreachable the run continues without the context.

#### Outbound Webhooks on Completion
A per-agent **Call webhook on completion** toggle and URL field enable outbound HTTP notifications. After every run the platform POSTs the following JSON payload to the configured URL — enabling integrations with Slack incoming webhooks, Microsoft Teams, Power Automate, or any HTTP endpoint:

```json
{
  "agentId": "…",
  "name": "Agent Name",
  "status": "success",
  "result": "…",
  "duration": 1234,
  "timestamp": "2026-04-14T…"
}
```

Webhook calls are fire-and-forget and never block the agent from completing.

#### Chain Graph Visualization
A **⛓ Chains** button in the Active Agents header opens a dialog that renders the full agent chain graph as an indented tree with directional arrows. A depth-first cycle detection algorithm runs over the graph on open; any agents that form a circular dependency are highlighted in red and a warning banner lists the affected agent names. This makes it safe to design multi-step chains before problems occur at runtime.

#### Automatic Date/Time Context
Every prompt agent now receives a system-context header injected automatically at the start of its system prompt:

```
[System context — Today: Monday, April 14, 2026. Current time: 09:00 AM CDT. Location: Dallas, Texas.]
```

This means the LLM always knows the current date, time, and location without requiring `{{date}}` or `{{time}}` variables in the prompt. The header does not override or replace the agent's configured system prompt — it is prepended.

#### Geolocation Support
On startup the platform performs a background IP-based geolocation lookup (via `ipapi.co`). The result is cached and made available as prompt template variables:

| Variable | Example value |
|---|---|
| `{{location}}` | Dallas, United States |
| `{{city}}` | Dallas |
| `{{country}}` | United States |
| `{{region}}` | Texas |
| `{{latitude}}` | 32.7767 |
| `{{longitude}}` | -96.7970 |

Location is also automatically included in the date/time context header when available.

### Bug Fixes

#### Store Badge False Positive
The red badge on the **🛒 Store** button previously compared store filenames against installed agent names, a heuristic that frequently failed when filenames and agent names did not match exactly. The badge now tracks which store files the user has already seen (persisted in `settings.json`). The badge clears when the Store dialog is opened and only reappears when new files are added to the store after the last visit.

#### Startup Minimize to Tray
The "start minimized to tray" behavior was unreliable on some Windows configurations because `app.getLoginItemSettings().wasOpenedAtLogin` does not always return `true` when the app is launched via the Windows startup registry key. The startup registration now passes `--hidden` as a launch argument, and the app checks `process.argv.includes('--hidden')` at startup for a reliable signal.

### Under the Hood

- `worker.js` — added `setGeo()` for location injection; added `_buildContextHeader()` for auto date/time/location prefix; added `_fetchMcpContext()` for optional MCP tool list fetch; added `_postOutboundWebhook()` fire-and-forget POST; `resolveVariables()` extended with `{{city}}`, `{{country}}`, `{{region}}`, `{{latitude}}`, `{{longitude}}`, `{{location}}`
- `registry.js` — agent schema extended with `group`, `mcpUrl`, `onCompleteWebhookEnabled`, `onCompleteWebhookUrl`
- `index.js` — `_fetchGeoLocation()` fetches and caches IP geolocation at startup; `setLoginItemSettings` updated to pass `--hidden` arg; tray `buildMenu()` now generates a Run Agent submenu from live registry; IPC handlers added: `agents:runAll`, `agents:runGroup`, `agents:setGroupEnabled`, `app:getGeoLocation`, `store:getSeenFiles`, `store:markFilesSeen`; all agent-mutating handlers emit `agents-changed` to trigger tray menu rebuild
- `preload.js` — exposed `runAll`, `runGroup`, `setGroupEnabled`, `getGeoLocation`, `getSeenStoreFiles`, `markStoreFilesSeen`
- `app.js` — `renderAgentList()` now renders group headers with run/toggle actions; `_refreshStoreBadge()` uses seen-file tracking; `openStore()` marks files as seen on open; `collectFormPayload`, `editAgent`, `resetForm` updated for new agent fields; new dialog functions: `openChainGraph()`, `showDiff()`, `_computeLineDiff()`; `populateGroupDatalist()` populates the group autocomplete datalist
- `styles.css` — added styles for `.group-header`, `.badge-group`, `.badge-mcp`, chain graph dialog, output diff dialog

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

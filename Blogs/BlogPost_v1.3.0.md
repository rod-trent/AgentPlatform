# AI Agent Platform v1.3.0: The Platform Grows Up

*By Rod Trent | April 14, 2026*

---

At the end of the v1.2.0 post I listed five things that were coming next: agent groups, run on demand from the tray, output diffing, outbound webhooks, and chain graph visualization. Look at what v1.3.0 ships and you'll find all five of them — plus three more that weren't on any list.

That's not an accident. It's what happens when a platform gets enough users that the gaps become obvious. The message from the field was clear: the agents themselves were great. The infrastructure around them wasn't keeping up. You could schedule anything, chain anything, and run it against any model. But you couldn't organize twenty agents. You couldn't see whether today's briefing actually said something different from yesterday's. You couldn't push the results anywhere useful. And you couldn't hand the whole thing off to someone else and trust them to understand what they were looking at.

V1.3.0 is the answer to all of that.

![AI Agent Platform v1.3.0](https://github.com/rod-trent/AgentPlatform/blob/main/Images/v1.3.0-Main.png)
*AI Agent Platform v1.3.0 — main window.*

---

## What's New

### 1. Agent Groups

If you've been running AI Agent Platform for a while, there's a decent chance your agent list has grown beyond what fits comfortably on one screen. A morning briefing pack, a few cybersecurity monitors, some market watchers, a handful of custom research agents you wrote yourself — suddenly you're scrolling to find the thing you want and running them one at a time.

Groups solve this.

Every agent now has an optional **Group** field. Type a name — `Morning Briefing`, `Security`, `Finance`, whatever makes sense to you — and the agent is tagged. When groups exist in your registry, the agent list reorganizes around them: ungrouped agents appear first, followed by each named group under its own header. Each group header includes two buttons that do exactly what you'd expect:

- **▶ Run Group** — triggers every enabled agent in the group immediately
- **Enable/Disable All** — turns every agent in the group on or off with a single click

Groups also propagate to the system tray context menu (more on that in a moment). The group name autocompletes from existing groups as you type, so your naming stays consistent without having to remember exact capitalizations.

**Why it matters:** Organizing agents into logical collections transforms the platform from a list of individual jobs into something that feels like a real automation system. A "Morning Briefing" group runs on demand before a meeting. A "Security Monitors" group gets disabled while you're traveling and re-enabled when you're back. The concept is obvious in retrospect — and the list view is dramatically more useful with it.

---

### 2. Run All Now

Sometimes you want everything to run. Maybe the scheduler was off and you've come back to stale results. Maybe you've just added a new agent and want to see the whole fleet execute together. Maybe you're demoing the platform and want to show everything firing at once.

The new **▶▶ Run All** button in the Active Agents header triggers every enabled agent immediately. One click. All agents. The button starts the scheduler automatically if it isn't already running, so you don't have to think about whether the worker is active.

Individual **▶ Run Now** buttons remain on every agent card — Run All doesn't remove the per-agent control, it adds a layer above it.

**Why it matters:** Before this, triggering multiple agents meant clicking down a list of cards one at a time. With more than a handful of agents that becomes tedious enough that people just wait for the scheduler. Run All removes the friction entirely.

---

### 3. Run on Demand from the System Tray

The system tray context menu has been significantly expanded. Right-clicking the AI Agent Platform tray icon used to give you Open, Start/Stop Scheduler, About, and Quit. That was fine when there were three agents and one action that mattered.

V1.3.0 adds a **Run Agent** submenu that lists every enabled agent by name. Click any agent in the submenu and it triggers immediately — without opening the main window, without navigating to its card, without any other interaction. If you've organized agents into groups, those groups also appear in the submenu as single-click entries that fire every agent in the group at once.

The tray menu rebuilds automatically whenever the agent list changes — an agent is added, renamed, enabled, disabled, or deleted, and the submenu reflects it the next time you right-click.

**Why it matters:** This is the feature that turns AI Agent Platform from a desktop app you visit into an ambient service you forget is running. Trigger a morning briefing before you open your email. Fire a market snapshot before a call. Run a security digest at the end of the day. All without switching focus or navigating a UI — just right-click the tray icon that's been sitting quietly in the corner this whole time.

---

### 4. Output Diffing

This feature looks simple on the surface and turns out to be deeply useful for an entire category of agents that most people are already running without realizing they need it.

Any agent that runs on a recurring schedule and watches for changes — a news digest, a threat feed, a market snapshot, a competitor pricing monitor — produces an output that's slightly different every run, but not completely different. The question you always want answered is: *what actually changed since last time?*

The **Diff** button appears on any agent card that has at least two runs in its history. Click it to open a dialog that computes a line-by-line comparison between the current run output and the immediately previous run output, using a proper Longest Common Subsequence algorithm:

- **Green lines** — new content added in the current run
- **Red lines** — content that appeared in the previous run but not the current one
- **Grey lines** — unchanged content present in both

The diff is computed entirely in the app — no external tool, no copy-paste into a diff viewer, no third-party library. It works on any text output, including markdown-formatted agent responses.

**Why it matters:** Before diffing, the only way to know whether a monitoring agent had detected something new was to read both outputs and compare them mentally — which defeats the purpose of having an agent do the work. With diffing, you can look at a single view and immediately see whether anything changed since the last run. A daily threat intelligence agent that shows no green lines is a day with no new threats. A pricing monitor with three red lines and two green lines tells you exactly what moved.

---

### 5. MCP Server Integration

This is the feature that takes AI Agent Platform from a tool that calls LLMs to a tool that connects them to everything else.

The **Model Context Protocol** (MCP) is an open standard for exposing external tools, APIs, and data sources to language models in a structured, discoverable way. An MCP server describes what it can do — tools, resources, schemas — and a client (like AI Agent Platform) fetches that description and presents it to the LLM before each run.

Every prompt agent now has an optional **MCP Server URL** field. Set it to the base URL of any running MCP-compatible server. Before each run, the platform queries `{mcpUrl}/mcp/v1/tools`, retrieves the list of available tools and their descriptions, and prepends them to the agent's system prompt as structured context:

```
[Available MCP tools from http://localhost:3000:
- get_weather: Returns current weather for a given city
- search_documents: Full-text search across the local document store
- query_database: Execute a read-only SQL query against the analytics database]
```

The LLM then knows what tools exist, what they do, and — if it's capable of tool use — can reference or request them in its response. If the MCP server is unreachable at run time, the agent continues without the context rather than failing.

**Why it matters:** MCP transforms agents from closed-loop prompt-response cycles into genuinely capable assistants with access to real, live data. A financial agent connected to a market data MCP server has current prices — not just training data. A research agent connected to a document search MCP server can pull from your private knowledge base. A DevOps agent connected to an infrastructure MCP server knows the actual state of your systems. The LLM stops working from memory and starts working from fact.

This is the single most architecturally significant change in v1.3.0.

---

### 6. Outbound Webhooks on Completion

Until v1.3.0, AI Agent Platform was a consumer of information — it received inputs, called LLMs, and stored results. It didn't push anything anywhere on its own. If you wanted an agent's output to reach Slack, Teams, email, a database, or any other system, you had to build that bridge yourself.

That changes now.

Each agent has a new **Call webhook on completion** toggle and URL field. Enable it, paste in any HTTP endpoint, and after every run the platform POSTs the following payload to that URL:

```json
{
  "agentId": "abc-123",
  "name": "Daily Threat Briefing",
  "status": "success",
  "result": "…the agent's full output…",
  "duration": 3421,
  "timestamp": "2026-04-14T09:00:01.234Z"
}
```

The call is fire-and-forget — it happens asynchronously after the run completes and never delays or blocks the agent from finishing. If the endpoint is unreachable, the failure is logged and the agent moves on.

**Practical integrations this unlocks immediately:**

- **Slack** — paste an incoming webhook URL and every agent completion posts a message to your chosen channel
- **Microsoft Teams** — same thing with a Teams incoming webhook connector
- **Power Automate** — trigger a flow from any agent run, feeding the result into whatever downstream process you need
- **ntfy / Gotify / Pushover** — push the output to any notification service that accepts HTTP POSTs
- **Any API** — write a thin HTTP endpoint that accepts the payload and does whatever you need: log it, store it, transform it, forward it

**Why it matters:** Outbound webhooks close the loop. Agents that monitor things and find things and summarize things are more valuable when the people who need that information actually receive it — automatically, in the tools they already use, without anyone checking the app. A threat briefing that appears in a Slack channel every morning is a different kind of useful than one that sits in a card that you have to remember to look at.

---

### 7. Chain Graph Visualization and Cycle Detection

Agent chaining is one of the most powerful features in the platform. It's also one of the easiest to get wrong. A chain is essentially a directed graph, and directed graphs have a property that makes things go badly: they can contain cycles. Agent A chains to Agent B which chains back to Agent A. Both agents trigger each other forever, or until the platform runs out of something.

V1.3.0 adds two things to prevent this and help you understand what you've built.

**The Chain Graph dialog** — click the **⛓ Chains** button in the Active Agents header to open a visual tree of all agent chains in your registry. Each chain is rendered as an indented tree with directional arrows showing which agent triggers which:

```
News Summarizer  →  Tweet Drafter  →  Email Formatter
Threat Monitor   →  Incident Alert
Daily Briefing
```

Root agents (not triggered by anything else) appear at the top level. Each downstream agent is indented under its trigger.

**Cycle detection** runs automatically when the dialog opens. A depth-first traversal of the graph identifies any circular dependencies before they can cause problems at runtime. Agents that participate in a cycle are highlighted in red with a `⟳ cycle` tag, and a warning banner at the bottom of the dialog names the agents involved.

**Why it matters:** As chain configurations grow, the relationships between agents become difficult to reason about from individual card settings alone. The chain graph gives you a system-level view of how your agents relate to each other — and the cycle detector ensures that what you've built is actually safe to run. Catching a circular chain before you hit Start Scheduler is substantially better than diagnosing one after.

---

### 8. Automatic Date/Time Context — Agents That Always Know When They Are

This one corrects a fundamental limitation that's been present since v1.0.0.

LLMs have a knowledge cutoff. They don't inherently know today's date, the current time, or anything that happened after their training data was frozen. If you ask an LLM what day it is, it will tell you it doesn't know — or worse, confidently guess wrong.

V1.2.0 introduced `{{date}}` and `{{time}}` template variables so you could inject the current date manually. That worked, but it required you to remember to put variables in every prompt where time mattered. If you forgot, the agent didn't know what day it was.

V1.3.0 removes the requirement to remember.

Every prompt agent now automatically receives a context header prepended to its system prompt at run time:

```
[System context — Today: Monday, April 14, 2026. Current time: 09:00 AM CDT. Location: Dallas, Texas.]
```

This happens whether or not you've written any `{{date}}` variables. The agent always knows the current date, time, and (if geolocation is available) location. The header is prepended — your configured system prompt appears after it, unchanged.

**Why it matters:** Date-awareness is table stakes for any agent that interacts with time-sensitive information. News agents, market agents, scheduling assistants, threat monitors, meeting prep agents — all of them need to know when "now" is. Requiring users to manually add `{{date}}` to every prompt was a sharp edge that silently produced wrong results when forgotten. Automatic injection eliminates the failure mode entirely.

---

### 9. Geolocation — Agents That Know Where They Are

Paired with the automatic date/time context, V1.3.0 adds IP-based geolocation.

On startup, the platform performs a background lookup against `ipapi.co` and caches the result. The cached data is available immediately to all agents:

**As auto-injected context** — when available, the location is included in the system context header automatically (see above). Every agent knows its approximate city and country without any configuration.

**As template variables** — for prompts where you need precise control over where the location appears:

| Variable | Example |
|---|---|
| `{{location}}` | Dallas, United States |
| `{{city}}` | Dallas |
| `{{country}}` | United States |
| `{{region}}` | Texas |
| `{{latitude}}` | 32.7767 |
| `{{longitude}}` | -96.7970 |

The lookup is non-blocking — the app opens immediately and the geo data is populated within a second or two of launch. If the lookup fails (no internet, API unavailable), the app continues normally and the location variables simply resolve to `Unknown`.

**Why it matters:** Location context is the difference between *"What's the weather like today?"* and *"What's the weather like in Dallas today?"* — between a generic market briefing and one that references your local exchange's opening time. Between a security alert that says "there are threats" and one that says "there are threats affecting organizations in your region." Geolocation transforms agents from abstract information processors into assistants that are actually relevant to where you are.

---

### 10. Store Badge Fix

This one is a bug fix, but it's worth calling out because it affected the first thing users see when they open the app.

The red badge on the **🛒 Store** button previously used a filename comparison to decide whether store agents were "new" — it derived a name from the filename (stripping `.json`, replacing dashes with spaces) and checked whether that derived name matched anything in your installed agent list. The problem: filenames and agent names frequently don't match exactly. `OptimumRunningTime.json` derives to `OptimumRunningTime`, not `Optimum Running Time`. The badge reported false positives constantly.

V1.3.0 replaces the comparison entirely. The platform now tracks which store files you have actually *seen* — the list is persisted in `settings.json`. When you open the Store dialog, every currently visible file is marked as seen and the badge clears. The badge only reappears when the GitHub `Samples/` directory gets a genuinely new file that wasn't there the last time you opened the Store.

The badge now means what it was always supposed to mean: there is something new in the store that you haven't looked at yet.

---

### 11. Startup Minimize Fix

Another bug fix that deserves a mention because it affected the platform's core background-service use case.

The "start minimized to tray at Windows startup" behavior relied on `app.getLoginItemSettings().wasOpenedAtLogin` to detect that the app was launched by Windows rather than by the user. On many Windows configurations this value returns `false` even when the app was launched via the startup registry key — the result was that the app popped its main window on every reboot, defeating the entire purpose of the silent startup feature.

V1.3.0 fixes this by changing how the startup item is registered. The platform now passes `--hidden` as a launch argument when it registers itself with Windows startup, and checks `process.argv.includes('--hidden')` at launch — a reliable signal that works regardless of OS configuration. If you use the platform as a background service and had this feature enabled, the behavior will now be exactly what you expected it to be.

---

## A Note on the "What's Next" List from v1.2.0

The v1.2.0 post listed five planned features for v1.3.0. Let's run the scorecard:

| What was planned | Shipped? |
|---|---|
| Agent groups | ✓ Yes — group tags, group headers, Run Group and Enable/Disable All buttons |
| Run on demand from the tray | ✓ Yes — Run Agent submenu with all enabled agents and groups |
| Output diffing | ✓ Yes — LCS-based line diff with added/removed highlighting |
| Scheduled webhook calls (outbound) | ✓ Yes — per-agent completion webhook with full payload |
| Multi-step chain visualization + cycle detection | ✓ Yes — chain graph dialog with DFS cycle detection |

Five for five. Everything that was promised shipped — plus automatic date/time context, geolocation, Run All Now, and two bug fixes that were overdue.

---

## Getting v1.3.0

The project is open source under the MIT license.

**GitHub:** [https://github.com/rod-trent/AgentPlatform](https://github.com/rod-trent/AgentPlatform)

To run from source:

```bat
git clone https://github.com/rod-trent/AgentPlatform.git
cd AgentPlatform
npm install
npm start
```

To build the installer:

```bat
npm run build
```

The installer lands in `dist\AI Agent Platform Setup 1.3.0.exe` and supports both **x64** and **ARM64** Windows in a single file.

**Upgrading from v1.2.0:** install over the top. Your `Documents\AIAgentPlatform\` folder — agents, history, and settings — is untouched. All existing agent definitions are fully compatible. The new fields (`group`, `mcpUrl`, `onCompleteWebhookEnabled`, `onCompleteWebhookUrl`) default to empty/disabled for agents that don't have them, so existing chains, schedules, and configurations continue to work without any changes on your part.

---

## What's Next

A few things already on the list for v1.4.0:

- **Agent templates** — save any configured agent as a reusable template and instantiate new agents from it, preserving the system prompt structure and settings while letting you customize the details
- **Scheduled reporting** — auto-generate a digest of all agent outputs from the past 24 hours and send it somewhere useful — a file, an email, a webhook — without needing to chain individual agents together
- **Run history diff in the History dialog** — the output diff is currently accessible from the agent card; surfacing it inside the History dialog would let you compare any two arbitrary runs, not just the most recent pair
- **Agent tags and filtering** — search and filter the agent list by tag, status, provider, or last-run result, for platforms with large numbers of agents
- **Dark/light theme toggle** — the app has always been dark-first; a light mode option has been requested

If you build something with the platform, run into something broken, or have a use case that isn't being served, open an issue on GitHub. Pull requests welcome.

---

*AI Agent Platform is open source software released under the MIT License. Copyright © 2025 Rod Trent.*

# Agent Chaining: Teaching AI Agents to Pass the Baton

*By Rod Trent | April 8, 2026*

---

A single AI agent is useful. A pipeline of AI agents — where each one builds on what the last one produced — is something else entirely.

That's the idea behind **agent chaining**: wiring agents together so the output of one automatically becomes the input of the next. No copy-paste. No manual hand-off. No glue code. The first agent runs, succeeds, and the next agent picks up exactly where it left off.

AI Agent Platform has supported agent chaining since v1.1.0. This post explains what agent chaining actually is, when it's worth using, and how the platform implements it under the hood.

---

## What Is Agent Chaining?

An AI agent, in its simplest form, takes a prompt, sends it to an LLM, and returns a response. Useful, but limited. The moment you want to do *two things in sequence* — summarize something and then reformat that summary as a tweet, for example — you're either doing it manually or you're writing orchestration code.

Agent chaining solves that by treating one agent's output as another agent's input. You build a directed pipeline:

```
Agent A  →  Agent B  →  Agent C  →  ...
```

Each agent has a specific, focused job. Agent A might fetch and summarize a news feed. Agent B takes that summary and drafts a social post. Agent C takes the draft and scores its engagement potential. Each does one thing well. The chain composes them into a multi-step workflow.

This pattern has several names in the AI world — pipelines, DAGs, sequential workflows, orchestration chains — but the core concept is always the same: decompose a complex task into discrete steps, assign each step to a dedicated agent, and connect the steps so output flows forward automatically.

### Why Not Just Write One Big Prompt?

You can try. For simple tasks, a single prompt works fine. But as tasks grow in complexity, single-prompt agents run into real problems:

**Prompt sprawl.** A prompt that asks an LLM to research a topic, summarize the findings, reformat them as bullet points, translate them into Spanish, and write a subject line is a prompt asking the model to hold too many goals in mind at once. Quality degrades as scope grows.

**No intermediate checkpoints.** If you want to review or log what the model produced at step two before it moves to step three, a monolithic prompt gives you no natural place to do that. A chain does — each agent's output is a discrete, inspectable artifact.

**Reuse.** A "format output as HTML email" agent is useful for a dozen different upstream agents. A prompt buried in the middle of another prompt isn't reusable at all.

**Provider flexibility.** In a chained architecture, Agent A can run on Grok while Agent B runs on Claude and Agent C runs on a local Ollama model. Each step uses the best tool for that specific job. A single prompt forces you to pick one model for everything.

Agent chaining gives you modularity. Each agent in the chain has a clear responsibility, is independently testable, and can be swapped or updated without touching the others.

---

## How AI Agent Platform Implements Chaining

### The Chain-To Field

Every prompt agent in AI Agent Platform has an optional **Chain To** field. You set it when creating or editing an agent by selecting another agent from a dropdown. That's it. No code, no configuration files, no YAML.

When you configure a chain, a badge appears on the upstream agent's card showing which agent fires next:

```
⛓ Tweet Drafter
```

That badge is your visual confirmation that the pipeline is configured and active.

### What Happens at Runtime

The scheduling engine (`worker.js`) handles all execution. Here's the flow when a chained agent runs:

1. The upstream agent fires on its scheduled cron tick (or a manual trigger)
2. The agent's prompt executes against the configured LLM provider
3. On **successful completion**, the result string is captured
4. For each agent ID listed in the `chainTo` array, `_executeAgent()` is called — with the upstream result injected as the `userPrompt`
5. A 300ms delay fires between each chained execution so the UI can update cleanly

The critical detail is step 4: the downstream agent receives the upstream agent's full output as its user prompt. The downstream agent's original user prompt is replaced entirely. Its system prompt remains unchanged — so you can write system prompts that explain to the model what kind of content it should expect to receive and what to do with it.

### The Code

The chaining logic in `worker.js` is deliberately minimal:

```javascript
// Fire chained agents with this result as their input (only on success)
if (status === "success" && Array.isArray(agent.chainTo) && agent.chainTo.length) {
  for (const chainId of agent.chainTo) {
    _log(`[${agent.name}] chaining to ${chainId}`);
    setTimeout(() => _executeAgent(chainId, result), 300);
  }
}
```

And the execution function itself handles the injection:

```javascript
async function _executeAgent(agentId, chainedInput = null) {
  // ...
  const effectiveAgent = chainedInput
    ? { ...agent, userPrompt: String(chainedInput) }
    : agent;
  result = await runPromptAgent(effectiveAgent, _settings);
  // ...
}
```

A clean separation: the scheduler owns *when* agents run, the injection mechanism owns *what they receive*, and the agent definition owns *how they respond to it*.

### The Agent Schema

The `chainTo` field in the agent registry is an array of agent IDs — UUIDs assigned at creation time. The array structure leaves the door open for future fan-out patterns (one agent triggering multiple downstream agents simultaneously). Currently, the UI exposes a single downstream agent selection, which maps to a one-element array.

```json
{
  "id": "a1b2c3d4-...",
  "name": "News Summarizer",
  "type": "prompt",
  "chainTo": ["e5f6g7h8-..."],
  "systemPrompt": "You are a news analyst...",
  "userPrompt": "Summarize today's top tech headlines.",
  "provider": "xai",
  "model": "grok-3",
  "schedule": "0 8 * * *"
}
```

The downstream agent — the Tweet Drafter, in this example — might look like:

```json
{
  "id": "e5f6g7h8-...",
  "name": "Tweet Drafter",
  "type": "prompt",
  "chainTo": [],
  "systemPrompt": "You receive a news summary and convert it into a concise, engaging tweet under 280 characters. Do not add commentary. Output only the tweet text.",
  "userPrompt": "",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "schedule": "0 9 * * *"
}
```

The Tweet Drafter has its own schedule — 9 AM — but when called via chain, the schedule is irrelevant. The chain trigger fires it immediately with the News Summarizer's output as input. The system prompt is what matters: it tells the model exactly what kind of input to expect and what to produce.

### Failure Behavior

Chains are **success-gated**. If the upstream agent fails — an API error, a timeout, an empty response — the downstream agent does not run. This is intentional. Passing garbage forward through a pipeline just produces garbage at the end. A failed upstream agent should be investigated and fixed, not silently passed along.

The status history for both agents reflects exactly what happened: the upstream shows `failed`, the downstream shows nothing (it never ran).

---

## Practical Patterns

### The Summarizer + Formatter

The most common pattern. Agent A produces raw content — research, data, analysis. Agent B takes that content and reformats it for a specific audience or medium.

- *Market Snapshot* → *Executive Email Formatter*
- *CVE Feed Summarizer* → *Slack Alert Composer*
- *Meeting Notes Collector* → *Action Item Extractor*

The key to making these work well is a precise system prompt on the formatter agent. Tell the model exactly what it will receive and exactly what format to produce.

### The Researcher + Scorer

Agent A generates content. Agent B evaluates it.

- *Blog Outline Generator* → *SEO Score Analyzer*
- *Tweet Drafter* → *Engagement Potential Rater*
- *Code Snippet Generator* → *Security Review Agent*

The scorer's output becomes a separate artifact in the history log — a quality signal you can check without ever leaving the app.

### The Transformer Chain

Three or more agents, each transforming the data one step further.

```
Raw Feed Ingester → Summary Writer → Translation Agent → HTML Email Formatter
```

Each agent in the middle has a focused job. The system prompts get progressively more specific as the data becomes more structured. The final agent produces the finished output.

---

## Things to Know

**Overlap prevention applies across chains.** If a chained agent is already running when a chain trigger arrives, the incoming run is skipped. The overlap guard protects individual agents, not the chain as a whole.

**The chain doesn't loop.** Nothing in the platform prevents you from creating a circular chain (A→B→A), but the overlap prevention breaks the loop: when A tries to fire again while it's still running, the second run is dropped.

**Chaining is for prompt agents only.** Script agents can be scheduled and run, but they don't have a `chainTo` field. A script agent can be a *target* of a chain from a prompt agent, but it can't initiate one.

**System prompts set context; the chain sets input.** When designing a chained agent, write its system prompt as if someone else will always be sending data to it. Describe what kind of input to expect, what to do with it, and what format to produce. Treat the user prompt as a slot that will be filled at runtime.

---

## What's Coming

The current implementation is linear and unconditional. Every successful run of a chained agent triggers the downstream. That covers a wide range of workflows, but there are more sophisticated patterns that need more tooling.

The v1.2.0 roadmap includes **conditional chaining** — only triggering a downstream agent when the upstream output matches a pattern or keyword. That opens the door to basic branching: *if the summarizer detects a critical severity, trigger the alert composer; otherwise, skip it.*

Webhook triggers are also on the list, which would let an external event — an HTTP request from another tool — kick off a chain rather than requiring a cron schedule to fire first.

---

## Summary

Agent chaining in AI Agent Platform works by capturing the output of a successful agent run and injecting it as the user prompt of the next agent in the configured sequence. No message queues, no orchestration frameworks, no code. Configure it with a dropdown, verify it with a badge, and monitor each step independently in the history log.

The power is in the composition. A focused summarizer, a focused formatter, and a focused scorer — connected — do more than any single all-in-one prompt could. And because each agent is independently editable, testable, and replaceable, the pipeline is easy to iterate on as your requirements change.

---

*AI Agent Platform is open source software released under the MIT License.*
*GitHub: [https://github.com/rod-trent/AgentPlatform](https://github.com/rod-trent/AgentPlatform)*

*Copyright © 2025 Rod Trent.*

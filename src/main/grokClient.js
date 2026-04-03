"use strict";

/**
 * llmClient.js  (kept as grokClient.js for import compatibility)
 *
 * Provider-agnostic LLM client built on the OpenAI SDK, which every major
 * provider now exposes a compatible endpoint for.
 */

const { OpenAI } = require("openai");

// ── Provider registry ─────────────────────────────────────────────────────────
const PROVIDERS = {
  xai: {
    name:        "xAI (Grok)",
    baseUrl:     "https://api.x.ai/v1",
    requiresKey: true,
    models:      ["grok-beta", "grok-3", "grok-3-fast", "grok-3-mini"],
  },
  openai: {
    name:        "OpenAI",
    baseUrl:     "https://api.openai.com/v1",
    requiresKey: true,
    models:      ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1", "o1-mini", "o3-mini"],
  },
  anthropic: {
    name:        "Anthropic (Claude)",
    baseUrl:     "https://api.anthropic.com/v1",
    requiresKey: true,
    // Anthropic's OpenAI-compatible endpoint requires this extra header
    extraHeaders: { "anthropic-version": "2023-06-01" },
    models:      ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  },
  ollama: {
    name:        "Ollama (Local)",
    baseUrl:     "http://localhost:11434/v1",
    requiresKey: false,
    models:      ["llama3.2", "llama3.1", "mistral", "phi3", "gemma2", "qwen2.5", "codellama"],
  },
  custom: {
    name:        "Custom / Other",
    baseUrl:     "",
    requiresKey: true,
    models:      [],
  },
};

// ── In-memory state ───────────────────────────────────────────────────────────
/** Full settings object — set by configure() */
let _settings = null;

/** Client cache, keyed by providerId — cleared on configure() */
const _clients = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

/** Call this whenever settings are loaded or changed. */
function configure(settings) {
  _settings = settings;
  _clients.clear();
}

function getProviders() {
  return PROVIDERS;
}

function _getClient(providerId) {
  if (_clients.has(providerId)) return _clients.get(providerId);

  const def      = PROVIDERS[providerId];
  if (!def) throw new Error(`Unknown provider: "${providerId}"`);

  const provCfg  = _settings?.providers?.[providerId] || {};
  const baseUrl  = provCfg.baseUrl || def.baseUrl;
  const apiKey   = provCfg.apiKey  || (providerId === "ollama" ? "ollama" : "");

  if (def.requiresKey && !apiKey)
    throw new Error(`No API key configured for ${def.name}. Open Settings and add your key.`);
  if (!baseUrl)
    throw new Error(`No base URL configured for ${def.name}. Open Settings to set it.`);

  const client = new OpenAI({
    apiKey,
    baseURL:        baseUrl,
    defaultHeaders: def.extraHeaders || {},
  });

  _clients.set(providerId, client);
  return client;
}

/**
 * Run a prompt-type agent.
 * @param {object} agent        - the agent definition (provider, model, prompts, temperature)
 * @param {object} [settings]   - optional settings override (uses _settings if omitted)
 */
async function runPromptAgent(agent, settings) {
  if (settings) configure(settings);
  if (!_settings) throw new Error("LLM client is not configured. Open Settings.");

  const providerId = agent.provider || _settings.defaultProvider || "xai";
  const def        = PROVIDERS[providerId];
  const model      = agent.model || def?.models?.[0] || "gpt-4o";

  const client   = _getClient(providerId);
  const response = await client.chat.completions.create({
    model,
    temperature: agent.temperature ?? 0.7,
    messages: [
      { role: "system", content: agent.systemPrompt || "You are a helpful assistant." },
      { role: "user",   content: agent.userPrompt   || "Hello!" },
    ],
  });

  return response.choices[0].message.content;
}

module.exports = { PROVIDERS, configure, getProviders, runPromptAgent };

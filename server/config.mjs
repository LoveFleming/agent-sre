/**
 * config.mjs — Global configuration for agent-sre
 *
 * Loads provider settings from config/providers.json or env vars.
 */

import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const ROOT = resolve(__dirname, "..");

/** Load provider config (LLM API keys, endpoints) */
function loadProviderConfig() {
  // SRE_PROVIDERS_PATH lets tests (and multi-env deployments) point at a
  // fixed fixture instead of the local runtime config/providers.json.
  const configPath = process.env.SRE_PROVIDERS_PATH
    ? resolve(process.env.SRE_PROVIDERS_PATH)
    : resolve(ROOT, "config/providers.json");
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {}
  }
  return {
    active: process.env.SRE_LLM_PROVIDER || "",
    providers: {},
    defaultModel: process.env.SRE_LLM_MODEL || "",
  };
}

export const config = loadProviderConfig();

/** Resolve LLM endpoint, headers, and model from config or override string */
export function resolveLLM(modelOverride) {
  let providerId = config.active;
  let modelId = modelOverride || config.defaultModel || "";

  if (modelOverride && modelOverride.includes("/")) {
    const idx = modelOverride.indexOf("/");
    providerId = modelOverride.slice(0, idx);
    modelId = modelOverride.slice(idx + 1);
  }

  const provider = config.providers?.[providerId];
  if (!provider) {
    // Fallback: env vars
    const apiKey = process.env.SRE_LLM_API_KEY || process.env.OPENAI_API_KEY || "";
    const baseURL = process.env.SRE_LLM_BASE_URL || "https://api.openai.com/v1";
    if (!apiKey) throw new Error("No LLM provider configured. Set config/providers.json or env vars.");
    return {
      apiUrl: `${baseURL.replace(/\/+$/, "")}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      model: modelId || "gpt-4o-mini",
    };
  }

  const baseURL = provider.baseURL.replace(/\/+$/, "");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/LoveFleming/agent-sre";
    headers["X-Title"] = "Agent SRE";
  }

  // Strip provider prefix from model if present
  if (modelId.includes("/")) modelId = modelId.split("/").pop();

  return {
    apiUrl: `${baseURL}/chat/completions`,
    headers,
    model: modelId,
    fallbacks: provider.fallbacks || [],
  };
}

/** Server port */
export const PORT = parseInt(process.env.SRE_PORT || process.env.PORT || "4200", 10);

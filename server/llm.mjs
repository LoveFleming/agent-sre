/**
 * llm.mjs — LLM calling with retry + streaming support
 *
 * Standalone, no external dependencies beyond Node 20+ fetch.
 */

import { resolveLLM } from "./config.mjs";

/** Simple retry with exponential backoff */
async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Call LLM API with retry.
 * @param {object} opts
 * @param {string} opts.model - model override (e.g. "zai/glm-5.1")
 * @param {array} opts.messages - chat messages
 * @param {array} [opts.tools] - OpenAI-style tool definitions
 * @param {number} [opts.maxTokens=4096]
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.timeoutMs=120000]
 * @param {function} [opts.onEvent] - streaming callback
 * @returns {Promise<{content: string, toolCalls: array, usage: object}>}
 */
export async function callLLM({
  model,
  messages,
  tools,
  maxTokens = 4096,
  maxRetries = 3,
  timeoutMs = 120_000,
  onEvent = null,
}) {
  const llm = resolveLLM(model);
  const useStream = !!onEvent;

  const body = {
    model: llm.model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
    stream: useStream,
  };
  if (tools?.length) {
    body.tools = tools.map(t => t.definition || t);
    body.tool_choice = "auto";
  }

  let lastErr;
  const models = [() => llm, ...((llm.fallbacks || []).map(fallbackOverride))];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const llmCfg = models[Math.min(attempt, models.length - 1)]();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(llmCfg.apiUrl, {
        method: "POST",
        headers: llmCfg.headers,
        // Semgrep json-stable-stringify false-positive: HTTP request body for fetch(),
        // not used as cache key / hash / comparison target. Server parses via JSON.parse().
        body: JSON.stringify({ ...body, model: llmCfg.model }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`LLM API ${resp.status}: ${errText.slice(0, 200)}`);
      }

      if (useStream) {
        return await handleStream(resp, onEvent);
      }

      const data = await resp.json();
      const choice = data.choices?.[0]?.message || {};
      return {
        content: choice.content || "",
        toolCalls: choice.tool_calls || [],
        usage: data.usage || {},
      };
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries - 1) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
        onEvent?.({ type: "retry", attempt: attempt + 1, error: err.message, waitMs: backoff });
        await sleep(backoff);
      }
    }
  }

  throw lastErr || new Error("LLM call failed");
}

function fallbackOverride() {
  // Placeholder — if fallbacks are configured as full provider/model strings,
  // resolve them here. For now, keep using the primary.
  return resolveLLM();
}

/** Handle SSE streaming response */
async function handleStream(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let toolCalls = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          onEvent?.({ type: "delta", content: delta.content });
        }
        if (delta?.tool_calls) {
          toolCalls = mergeToolCalls(toolCalls, delta.tool_calls);
        }
      } catch {}
    }
  }

  return { content, toolCalls, usage: {} };
}

function mergeToolCalls(existing, deltas) {
  for (const delta of deltas) {
    const idx = delta.index ?? existing.length;
    if (!existing[idx]) {
      existing[idx] = { id: delta.id || `call_${idx}`, type: "function", function: { name: "", arguments: "" } };
    }
    if (delta.function?.name) existing[idx].function.name += delta.function.name;
    if (delta.function?.arguments) existing[idx].function.arguments += delta.function.arguments;
  }
  return existing;
}

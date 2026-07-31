/**
 * agent-loop.mjs — Core SRE agent loop
 *
 * Receives a chat message + crew definition, calls LLM with tools,
 * executes tool calls, and returns the final response.
 *
 * Supports both single-turn and streaming (SSE) modes.
 */

import { callLLM } from "./llm.mjs";
import { toolRegistry } from "./tool-registry.mjs";

/** Default context window (tokens) */
const DEFAULT_CONTEXT_WINDOW = 32_000;

/**
 * Trim messages to fit context window (rough char-based estimate).
 */
function trimMessages(messages, maxChars = DEFAULT_CONTEXT_WINDOW * 4) {
  let total = 0;
  const result = [];
  // Walk backwards, always keep system + last few messages
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const size = JSON.stringify(msg.content || "").length;
    if (total + size > maxChars && i > 0) break;
    total += size;
    result.unshift(msg);
  }
  // Ensure system message is always present
  if (result[0]?.role !== "system" && messages[0]?.role === "system") {
    result.unshift(messages[0]);
  }
  return result;
}

/**
 * Build tool list for a crew member based on their allowed tools.
 */
function getCrewTools(crew, allTools) {
  if (!crew?.allowedTools?.length) return allTools; // no restriction
  return allTools.filter(t => {
    const name = t.function?.name || t.name;
    return crew.allowedTools.includes(name);
  });
}

/**
 * Run agent loop — single turn (non-streaming).
 *
 * @param {object} opts
 * @param {object} opts.crew - crew member definition
 * @param {string} opts.message - user message
 * @param {array} opts.history - prior conversation [{role, content}]
 * @param {string} [opts.model] - model override
 * @param {function} [opts.onToolCall] - callback when a tool is executed
 * @returns {Promise<{content: string, history: array}>}
 */
export async function runAgentLoop({
  crew,
  message,
  history = [],
  model,
  onToolCall,
}) {
  const systemPrompt = buildSystemPrompt(crew);
  const tools = toolRegistry.getDefinitions();
  const crewTools = getCrewTools(crew, tools);

  const messages = [
    { role: "system", content: systemPrompt },
    ...trimMessages(history),
    { role: "user", content: message },
  ];

  const maxRounds = 8;

  for (let round = 0; round < maxRounds; round++) {
    const result = await callLLM({
      model,
      messages,
      tools: crewTools,
      maxTokens: 4096,
      maxRetries: 3,
      timeoutMs: 120_000,
    });

    // No tool calls — final answer
    if (!result.toolCalls?.length) {
      const newHistory = [...history, { role: "user", content: message }, { role: "assistant", content: result.content }];
      return { content: result.content, history: newHistory, toolCallCount: round };
    }

    // Execute tool calls
    messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });

    for (const call of result.toolCalls) {
      const toolResult = await toolRegistry.execute(call, { crew });
      onToolCall?.({ name: call.function?.name, args: call.function?.arguments, result: toolResult.text?.slice(0, 200) });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult.text || JSON.stringify(toolResult),
      });
    }
  }

  // Exceeded max rounds — return what we have
  const fallback = "⚠️ 達到最大工具呼叫次數。請縮小問題範圍或簡化操作。";
  return { content: fallback, history: [...history, { role: "user", content: message }, { role: "assistant", content: fallback }] };
}

/**
 * Run agent loop with SSE streaming.
 *
 * @param {object} opts - same as runAgentLoop, plus `res` (http.ServerResponse)
 */
export async function runAgentLoopStream({ crew, message, history = [], model, res, onToolCall }) {
  const systemPrompt = buildSystemPrompt(crew);
  const tools = toolRegistry.getDefinitions();
  const crewTools = getCrewTools(crew, tools);
  const messages = [
    { role: "system", content: systemPrompt },
    ...trimMessages(history),
    { role: "user", content: message },
  ];

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const maxRounds = 8;

  for (let round = 0; round < maxRounds; round++) {
    let streamContent = "";

    const result = await callLLM({
      model,
      messages,
      tools: crewTools,
      maxTokens: 4096,
      maxRetries: 3,
      timeoutMs: 120_000,
      onEvent: (ev) => {
        if (ev.type === "delta") {
          streamContent += ev.content;
          send("delta", { content: ev.content });
        }
      },
    });

    if (!result.toolCalls?.length) {
      // Final answer
      send("done", {
        content: result.content || streamContent,
        history: [...history, { role: "user", content: message }, { role: "assistant", content: result.content || streamContent }],
      });
      res.end();
      return;
    }

    // Tool calls — execute and continue
    messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });

    for (const call of result.toolCalls) {
      send("tool_call", { name: call.function?.name, args: call.function?.arguments });

      const toolResult = await toolRegistry.execute(call, { crew });
      onToolCall?.({ name: call.function?.name, result: toolResult.text?.slice(0, 200) });

      send("tool_result", { name: call.function?.name, result: toolResult.text?.slice(0, 500) });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult.text || JSON.stringify(toolResult),
      });
    }
  }

  send("done", { content: "⚠️ 達到最大工具呼叫次數。", history: [] });
  res.end();
}

/** Build system prompt from crew definition */
function buildSystemPrompt(crew) {
  const parts = [];

  if (crew.codename || crew.title) {
    parts.push(`你是 ${crew.codename || ""}（${crew.title || ""}）。\n`);
  }

  if (crew.description) {
    parts.push(crew.description);
  }

  if (crew.expertise) {
    parts.push(`\n## 專業能力\n${crew.expertise}`);
  }

  if (crew.systemPrompt) {
    parts.push(`\n${crew.systemPrompt}`);
  }

  if (crew.allowedTools?.length) {
    parts.push(`\n## 可用工具\n${crew.allowedTools.join(", ")}`);
  }

  parts.push(`\n## 行為規則
- 回答要精準、務實，聚焦在解決問題
- 用工具收集資料後再做判斷，不要猜測
- 發現異常時主動通報，並提供建議處置
- 用 markdown 格式化輸出，重要數據用表格或程式碼區塊
- 如果資訊不足，明確說明需要什麼`);

  return parts.join("\n");
}

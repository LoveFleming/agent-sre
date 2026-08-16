/**
 * llm.test.mjs — Unit tests for callLLM (llm.mjs)
 *
 * callLLM uses global fetch. We stub it via vi.stubGlobal('fetch').
 * Backoff sleep is exponential; tests use maxRetries=1 or 2 to keep fast.
 * `model` is resolved through the real providers.json fixture (active=zai).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { callLLM } from "./llm.mjs";

// ---- fetch response helpers ----------------------------------------------

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    text: () => Promise.resolve(ok ? "" : JSON.stringify(body)),
    json: () => Promise.resolve(body),
    body: null,
  };
}

/** Build a Response-like object for SSE streaming. */
function streamResponse(chunks) {
  // Build a ReadableStream that yields UTF-8 encoded text chunks.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok: true, status: 200, text: () => Promise.resolve(""), body: stream, json: () => Promise.resolve({}) };
}

describe("callLLM — non-stream happy path", () => {
  let calls;
  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", async (url, opts) => {
      calls.push({ url, opts });
      return jsonResponse({
        choices: [{ message: { content: "hello", tool_calls: [] } }],
        usage: { total_tokens: 12 },
      });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("回傳 content、toolCalls、usage", async () => {
    const res = await callLLM({ messages: [{ role: "user", content: "hi" }] });
    expect(res.content).toBe("hello");
    expect(res.toolCalls).toEqual([]);
    expect(res.usage.total_tokens).toBe(12);
  });

  it("request body 包含 model/messages/stream=false 並 POST", async () => {
    await callLLM({ messages: [{ role: "user", content: "hi" }] });
    expect(calls).toHaveLength(1);
    const url = calls[0].url;
    const opts = calls[0].opts;
    expect(opts.method).toBe("POST");
    expect(url).toContain("/chat/completions");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("glm-5.1");
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0.7);
  });

  it("傳入 tools 時映射 definition 並設 tool_choice=auto", async () => {
    await callLLM({
      messages: [],
      tools: [{ name: "g", definition: { type: "function", name: "g" } }],
    });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual([{ type: "function", name: "g" }]);
  });
});

describe("callLLM — non-ok & throw paths", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("非 2xx 且 retries 耗盡會 throw", async () => {
    vi.stubGlobal("fetch", () =>
      jsonResponse({ error: "boom" }, false, 500)
    );
    await expect(callLLM({ messages: [], maxRetries: 1 })).rejects.toThrow(/LLM API 500/);
  });

  it("全部嘗試失敗後 throw 最後的錯誤", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    await expect(callLLM({ messages: [], maxRetries: 1 })).rejects.toThrow(/network down/);
  });
});

describe("callLLM — retry recovers on later attempt", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("第一次失敗、第二次成功回傳正確結果", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", async () => {
      attempt++;
      if (attempt === 1) return jsonResponse({ error: "x" }, false, 429);
      return jsonResponse({
        choices: [{ message: { content: "recovered" } }],
        usage: {},
      });
    });
    const res = await callLLM({ messages: [], maxRetries: 2 });
    expect(attempt).toBe(2);
    expect(res.content).toBe("recovered");
  });
});

describe("callLLM — streaming", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("串流時累積 content 並觸發 onEvent delta", async () => {
    const events = [];
    vi.stubGlobal("fetch", () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        "data: [DONE]\n\n",
      ])
    );
    const res = await callLLM({
      messages: [],
      onEvent: (e) => events.push(e),
    });
    expect(res.content).toBe("Hello");
    expect(res.toolCalls).toEqual([]);
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas).toEqual([
      { type: "delta", content: "Hel" },
      { type: "delta", content: "lo" },
    ]);
  });

  it("串流時合併多段 tool_calls arguments", async () => {
    vi.stubGlobal("fetch", () =>
      streamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_0","function":{"name":"gr","arguments":"{\\"q\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"cpu\\"}"}}]}}]}\n\n',
        "data: [DONE]\n\n",
      ])
    );
    const res = await callLLM({ messages: [], onEvent: () => {} });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].function.name).toBe("gr");
    expect(res.toolCalls[0].function.arguments).toBe('{"q":"cpu"}');
  });

  it("stream=true 寫入 request body", async () => {
    let captured;
    vi.stubGlobal("fetch", async (_url, opts) => {
      captured = opts;
      return streamResponse(["data: [DONE]\n\n"]);
    });
    await callLLM({ messages: [], onEvent: () => {} });
    expect(JSON.parse(captured.body).stream).toBe(true);
  });
});

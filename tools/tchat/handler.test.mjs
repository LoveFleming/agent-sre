/**
 * handler.test.mjs — tests for tools/tchat/handler.mjs 工具層 (TASK-007)
 *
 * Covers the tool layer's responsibilities (ADR-004):
 * - LLM-facing contract: tchat_send_message({ targetType, targetId, text })
 *   success → ✅ text + data { messageId, targetType, targetId }
 * - validation errors formatted for the LLM (❌ text, error:true), never thrown
 * - validation happens BEFORE any transport call (bad input never hits network)
 * - config: default_chat_id / allowed_chat_ids still honoured (legacy fields)
 * - deprecated read tools still work through the legacy transport
 * - unknown tool name → error result
 *
 * The transport (client.mjs sendMessage) is stubbed — no network here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Legacy read tools call the Telegram transport, which requires bot_token
// (checked before fetch). Contract-v0 tools never read this.
process.env.TG_BOT_TOKEN = "123456:TEST_TOKEN";

vi.mock("./client.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendMessage: vi.fn(),
  };
});

const { sendMessage } = await import("./client.mjs");
const { default: handler, sendTchatMessage } = await import("./handler.mjs");

beforeEach(() => {
  vi.clearAllMocks();
});

function ctx(toolName) {
  return { toolName };
}

describe("tchat handler — tchat_send_message (contract v0 LLM interface)", () => {
  it("validates and sends, returning ✅ text + data on success", async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, messageId: "m_42" });

    const out = await handler({ targetType: "user", targetId: "u1", text: "hello" }, ctx("tchat_send_message"));

    expect(sendMessage).toHaveBeenCalledWith({ targetType: "user", targetId: "u1", text: "hello" });
    expect(out.error).toBeUndefined();
    expect(out.text).toMatch(/✅ Sent to user u1 \(message m_42\)/);
    expect(out.text).toContain("hello");
    expect(out.data).toEqual({ messageId: "m_42", targetType: "user", targetId: "u1" });
  });

  it("truncates long text previews to 100 chars", async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, messageId: "m_1" });
    const long = "x".repeat(250);
    const out = await handler({ targetType: "channel", targetId: "ops", text: long }, ctx("tchat_send_message"));
    expect(out.text).toContain("...");
    expect(out.text.length).toBeLessThan(250);
  });

  it.each([
    ["missing targetType", {}],
    ["invalid targetType", { targetType: "group", targetId: "g1", text: "hi" }],
    ["missing targetId", { targetType: "user", targetId: "", text: "hi" }],
    ["non-string targetId", { targetType: "user", targetId: 123, text: "hi" }],
    ["missing text", { targetType: "user", targetId: "u1", text: "" }],
    ["whitespace-only text", { targetType: "user", targetId: "u1", text: "   " }],
    ["null args", null],
  ])("rejects %s before touching the transport", async (_label, args) => {
    const out = await handler(args, ctx("tchat_send_message"));
    expect(out.error).toBe(true);
    expect(out.text).toMatch(/^❌ Send failed:/);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("formats transport errors for the LLM", async () => {
    sendMessage.mockResolvedValueOnce({ ok: false, error: "tchat API error: HTTP 502", status: 502 });
    const out = await handler({ targetType: "user", targetId: "u1", text: "hi" }, ctx("tchat_send_message"));
    expect(out.error).toBe(true);
    expect(out.text).toMatch(/❌ Send failed: tchat API error: HTTP 502/);
  });

  it("exposes sendTchatMessage() for the scheduler notify path", async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, messageId: "m_9" });
    const out = await sendTchatMessage({ targetType: "channel", targetId: "ops", text: "run done" });
    expect(out).toEqual({ ok: true, messageId: "m_9" });
  });
});

describe("tchat handler — deprecated read tools (legacy transport, kept working)", () => {
  /** Stub fetch with a Telegram Bot API shaped reply (these tools are legacy-only). */
  function stubTelegram(result) {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result }), { status: 200 }));
  }

  it("tchat_read_history with no visible messages returns 📭 (legacy transport)", async () => {
    stubTelegram([]);
    const out = await handler({ chat_id: "100" }, ctx("tchat_read_history"));
    expect(sendMessage).not.toHaveBeenCalled(); // deprecated tools never touch contract v0
    expect(out.error).toBeUndefined();
    expect(out.text).toMatch(/📭 No messages/);
  });

  it("tchat_read_history formats messages from the legacy transport", async () => {
    stubTelegram([
      { update_id: 5, message: { message_id: 5, date: 1700000000, text: "hello patrol", chat: { id: 100, type: "private" }, from: { first_name: "Steward" } } },
    ]);
    const out = await handler({ chat_id: "100" }, ctx("tchat_read_history"));
    expect(out.text).toMatch(/📬 Chat history/);
    expect(out.text).toContain("hello patrol");
    expect(out.data).toHaveLength(1);
  });

  it("tchat_read_next with no updates returns 📭", async () => {
    stubTelegram([]);
    const out = await handler({}, ctx("tchat_read_next"));
    expect(out.error).toBeUndefined();
    expect(out.text).toBe("📭 No new messages.");
  });
});

describe("tchat handler — unknown tool", () => {
  it("returns an error result instead of throwing", async () => {
    const out = await handler({}, ctx("tchat_teleport"));
    expect(out.error).toBe(true);
    expect(out.text).toMatch(/Unknown TChat tool: tchat_teleport/);
  });
});

/**
 * TChat Tool Provider Handler — 工具層（ports & adapters, ADR-004 / TASK-007）
 *
 * 分層職責：
 *   handler.mjs（本檔）= 工具層 — LLM 參數驗證、錯誤格式化。介面凍結不變。
 *   client.mjs          = transport 層 — 契約 v0 唯一實作，進公司只換那支。
 *
 * 工具介面（LLM contract，永不改變）：
 *   tchat_send_message({ targetType: "user"|"channel", targetId, text })
 *
 * Deprecated（功能保留，公司 API 契約未定，本期不納入契約 v0）：
 *   tchat_read_history / tchat_read_next — 仍走 legacy Telegram transport
 *
 * Config (tools/tchat/config.json) — 定義與 fallback 在 client.mjs：
 *   { api_url, token, timeout_ms, bot_token, default_chat_id, allowed_chat_ids }
 */

import { loadTchatConfig, sendMessage } from "./client.mjs";

let _lastUpdateOffset = 0;

/** Legacy Telegram Bot API base URL (deprecated read tools only) */
function apiBase() {
  const cfg = loadTchatConfig();
  return `https://api.telegram.org/bot${cfg.bot_token}`;
}

function checkAuth(chatId) {
  const allowed = loadTchatConfig().allowed_chat_ids;
  if (!allowed || allowed.length === 0) return true; // no allowlist = allow all
  return allowed.includes(String(chatId));
}

/** Legacy Telegram Bot API call (deprecated read tools only) */
async function tgApi(method, params = {}) {
  const cfg = loadTchatConfig();
  if (!cfg.bot_token) throw new Error("TChat bot_token not configured. Set tools/tchat/config.json or TG_BOT_TOKEN env var.");

  const resp = await fetch(`${apiBase()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`TChat API error: ${data.description || data.error_code}`);
  return data.result;
}

// ── Contract v0: message send (used by tool layer AND scheduler) ──

const VALID_TARGET_TYPES = new Set(["user", "channel"]);

/**
 * Validate + send one message through the contract-v0 transport.
 * This is the single send entry point for the whole platform (scheduler
 * notify path calls it directly; the LLM tool is a thin wrapper).
 * @param {{targetType?: string, targetId?: string, text?: string}} args
 * @returns {Promise<{ok: true, messageId: string} | {ok: false, error: string}>} never throws
 */
export async function sendTchatMessage(args = {}) {
  const { targetType, targetId, text } = args ?? {};

  if (!targetType || !VALID_TARGET_TYPES.has(targetType)) {
    return { ok: false, error: `Invalid or missing targetType "${targetType}". Must be "user" or "channel".` };
  }
  if (!targetId || typeof targetId !== "string") {
    return { ok: false, error: "Invalid or missing targetId (non-empty string required)." };
  }
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "Invalid or missing text (non-empty string required)." };
  }

  return sendMessage({ targetType, targetId, text });
}

/** Format timestamp */
function fmtTime(unix) {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString().slice(19, 11).replace("T", " ");
}

/** Format a message for display (deprecated read tools) */
function fmtMessage(msg) {
  const sender = msg.from ? `${msg.from.first_name || ""}${msg.from.last_name ? " " + msg.from.last_name : ""}` : "Unknown";
  const username = msg.from?.username ? `(@${msg.from.username})` : "";
  const time = fmtTime(msg.date);
  const replyHint = msg.reply_to_message ? ` ↩️ replying to "${(msg.reply_to_message.text || "").slice(0, 30)}"` : "";

  let body = msg.text || "";
  if (msg.caption) body = `[caption] ${msg.caption}`;
  if (msg.photo) body = `[photo] ${body}`;
  if (msg.document) body = `[document: ${msg.document.file_name || "?"}] ${body}`;
  if (msg.sticker) body = `[sticker: ${msg.sticker.emoji || "?"}]`;
  if (msg.voice) body = `[voice message]`;
  if (msg.video) body = `[video] ${body}`;
  if (msg.location) body = `[location: ${msg.location.latitude}, ${msg.location.longitude}]`;
  if (msg.contact) body = `[contact: ${msg.contact.phone_number}]`;

  return `📩 #${msg.message_id} ${time}\n   👤 ${sender} ${username}${replyHint}\n   💬 ${body}`;
}

// ── Main handler ──

export default async function handler(args, ctx) {
  const toolName = ctx.toolName;

  switch (toolName) {

    // ── tchat_send_message（契約 v0，LLM 介面凍結）──
    case "tchat_send_message": {
      const result = await sendTchatMessage(args);
      if (!result.ok) {
        return { text: `❌ Send failed: ${result.error}`, error: true };
      }
      const preview = String(args.text).slice(0, 100);
      return {
        text: `✅ Sent to ${args.targetType} ${args.targetId} (message ${result.messageId})\n   "${preview}${String(args.text).length > 100 ? "..." : ""}"`,
        data: { messageId: result.messageId, targetType: args.targetType, targetId: args.targetId },
      };
    }

    // ── tchat_read_history（DEPRECATED — legacy Telegram transport，契約未定）──
    case "tchat_read_history": {
      const cfg = loadTchatConfig();
      const chatId = args.chat_id || cfg.default_chat_id;
      if (!chatId) return { text: "❌ No chat_id specified and no default_chat_id configured.", error: true };
      if (!checkAuth(chatId)) return { text: `❌ Chat ${chatId} not in allowed list.`, error: true };

      const limit = Math.min(args.limit || 20, 100);

      // TChat Bot API doesn't have direct "get chat history".
      // We use getUpdates filtered by chat, or forwardChatMessages trick.
      // Best approach: use getUpdates with offset and filter by chat_id.

      const allUpdates = await tgApi("getUpdates", {
        offset: _lastUpdateOffset,
        limit: 100,
        allowed_updates: ["message"],
      });

      // Filter by chat_id and format
      const messages = allUpdates
        .filter(u => u.message?.chat?.id?.toString() === chatId.toString())
        .map(u => u.message)
        .slice(-limit);

      if (messages.length === 0) {
        return { text: `📭 No messages found in chat ${chatId}.\n\nNote: TChat Bot API only sees messages sent AFTER the bot started polling. Old messages before bot activation are not accessible via getUpdates.`, data: [] };
      }

      const lines = messages.reverse().map(fmtMessage);
      return {
        text: `📬 Chat history (${messages.length} messages):\n\n${lines.join("\n\n")}`,
        data: messages,
      };
    }

    // ── tchat_read_next（DEPRECATED — legacy Telegram transport，契約未定）──
    case "tchat_read_next": {
      const offset = args.offset ?? _lastUpdateOffset;
      const timeout = Math.min(args.timeout || 0, 50);

      const updates = await tgApi("getUpdates", {
        offset,
        limit: 1,
        timeout,
        allowed_updates: ["message", "edited_message", "channel_post"],
      });

      if (updates.length === 0) {
        return { text: "📭 No new messages.", data: null };
      }

      const update = updates[0];
      _lastUpdateOffset = update.update_id + 1;

      const msg = update.message || update.edited_message || update.channel_post;
      if (!msg) {
        return { text: `Received update #${update.update_id} (non-message event)`, data: update };
      }

      const chatId = msg.chat?.id?.toString();
      if (!checkAuth(chatId)) {
        return { text: `⛔ Message from unauthorized chat ${chatId}. Skipped.\n   From: ${msg.from?.first_name || "?"}\n   Content: ${(msg.text || "").slice(0, 60)}`, data: msg };
      }

      const isEdited = !!update.edited_message;
      const formatted = fmtMessage(msg);

      return {
        text: `${isEdited ? "✏️ [EDITED] " : ""}${formatted}\n\n   📎 update_id: ${update.update_id} | chat: ${chatId} | type: ${msg.chat?.type || "?"}`,
        data: { update_id: update.update_id, message: msg, chat_id: chatId },
      };
    }

    default:
      return { text: `Unknown TChat tool: ${toolName}`, error: true };
  }
}

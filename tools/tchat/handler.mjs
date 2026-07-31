/**
 * TChat Tool Provider Handler
 *
 * Send messages, read history, read next unread message via TChat Bot API.
 *
 * Config (tools/tchat/config.json):
 *   {
 *     "bot_token": "123456:ABC-DEF...",
 *     "default_chat_id": "123456789",
 *     "allowed_chat_ids": ["123456789", "-100987654321"]
 *   }
 */

import { existsSync, readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _config = null;
let _lastUpdateOffset = 0;

function getConfig() {
  if (_config) return _config;
  const ROOT = process.env.PAAW_ROOT || process.env.SRE_ROOT || resolve(__dirname, "../..");
  const configPath = join(ROOT, "tools/tchat/config.json");
  if (existsSync(configPath)) {
    _config = JSON.parse(readFileSync(configPath, "utf-8"));
  } else {
    _config = {
      bot_token: process.env.TG_BOT_TOKEN || "",
      default_chat_id: process.env.TG_DEFAULT_CHAT_ID || "",
      allowed_chat_ids: (process.env.TG_ALLOWED_CHATS || "").split(",").filter(Boolean),
    };
  }
  return _config;
}

function apiBase() {
  const cfg = getConfig();
  return `https://api.telegram.org/bot${cfg.bot_token}`;
}

function checkAuth(chatId) {
  const cfg = getConfig();
  const allowed = cfg.allowed_chat_ids;
  if (!allowed || allowed.length === 0) return true; // no allowlist = allow all
  return allowed.includes(String(chatId));
}

/** TChat API call */
async function tgApi(method, params = {}) {
  const cfg = getConfig();
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

/** Format timestamp */
function fmtTime(unix) {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString().slice(19, 11).replace("T", " ");
}

/** Format a message for display */
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
  const cfg = getConfig();

  switch (toolName) {

    // ── tg_send ──
    case "tg_send": {
      const chatId = args.chat_id || cfg.default_chat_id;
      if (!chatId) return { text: "❌ No chat_id specified and no default_chat_id configured.", error: true };
      if (!checkAuth(chatId)) return { text: `❌ Chat ${chatId} not in allowed list.`, error: true };
      if (!args.text) return { text: "❌ Missing required param: text", error: true };

      const payload = {
        chat_id: chatId,
        text: args.text,
      };
      if (args.parse_mode) payload.parse_mode = args.parse_mode;
      if (args.reply_to_message_id) payload.reply_to_message_id = args.reply_to_message_id;

      const result = await tgApi("sendMessage", payload);
      return {
        text: `✅ Sent to chat ${chatId} (message #${result.message_id})\n   "${args.text.slice(0, 100)}${args.text.length > 100 ? "..." : ""}"`,
        data: { message_id: result.message_id, chat_id: chatId, date: result.date },
      };
    }

    // ── tg_read_history ──
    case "tg_read_history": {
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

    // ── tg_read_next ──
    case "tg_read_next": {
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

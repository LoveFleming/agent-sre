/**
 * tools/tchat/client.mjs — TChat transport layer (contract v0, ADR-004)
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ 🔁 SWAP POINT — 進公司時「只換這支檔案」+ config 加公司 url/token │
 * │   其餘（handler 工具層、schema、scheduler、UI）全部不動。        │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Contract v0 (specs/tchat-contract.md):
 *   POST {api_url}/api/messages
 *   body: { targetType: "user"|"channel", targetId: string, text: string }
 *   200  → { ok: true,  messageId: string }
 *   4xx/5xx → { ok: false, error: string }
 *
 * Config (tools/tchat/config.json), env fallbacks in parentheses:
 *   api_url    (TCHAT_API_URL)   — tchat API base URL, e.g. http://localhost:3002
 *   token      (TCHAT_TOKEN)     — optional bearer token
 *   timeout_ms                    — fetch timeout, default 10000
 *   ── legacy fields below are only used by the deprecated read tools ──
 *   bot_token  (TG_BOT_TOKEN), default_chat_id (TG_DEFAULT_CHAT_ID),
 *   allowed_chat_ids (TG_ALLOWED_CHATS, comma-separated)
 *
 * Design rule: this module NEVER throws — every failure path returns
 * { ok: false, error } so callers (tool layer / scheduler) can format
 * errors instead of catching.
 */

import { existsSync, readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_TIMEOUT_MS = 10_000;

let _configCache = null;

/**
 * Load tchat config: config.json first, env vars as fallback.
 * Cached after first read (same convention as the grafana handler).
 * @param {{reload?: boolean}} [opts] - reload=true re-reads from disk (tests)
 * @returns {{
 *   api_url: string, token: string, timeout_ms: number,
 *   bot_token: string, default_chat_id: string, allowed_chat_ids: string[]
 * }}
 */
export function loadTchatConfig({ reload = false } = {}) {
  if (!reload && _configCache) return _configCache;
  const ROOT = process.env.PAAW_ROOT || process.env.SRE_ROOT || resolve(__dirname, "../..");
  const configPath = join(ROOT, "tools/tchat/config.json");

  let fileCfg = {};
  if (existsSync(configPath)) {
    try {
      fileCfg = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch (err) {
      console.warn(`[tchat] config.json parse failed (${err.message}) — falling back to env vars`);
    }
  }

  _configCache = {
    // contract v0 fields
    api_url: fileCfg.api_url || process.env.TCHAT_API_URL || "",
    token: fileCfg.token || process.env.TCHAT_TOKEN || "",
    timeout_ms: Number(fileCfg.timeout_ms) > 0 ? Number(fileCfg.timeout_ms) : DEFAULT_TIMEOUT_MS,
    // legacy fields — only the deprecated read tools (Telegram transport) still use these
    bot_token: fileCfg.bot_token || process.env.TG_BOT_TOKEN || "",
    default_chat_id: fileCfg.default_chat_id || process.env.TG_DEFAULT_CHAT_ID || "",
    allowed_chat_ids: (fileCfg.allowed_chat_ids || (process.env.TG_ALLOWED_CHATS || "").split(","))
      .map(id => (typeof id === "string" ? id.trim() : id))
      .filter(Boolean),
  };
  return _configCache;
}

/** Drop the cached config (tests / config hot-swap). */
export function resetTchatConfig() {
  _configCache = null;
}

/**
 * Send one message via contract v0.
 * @param {{targetType: "user"|"channel", targetId: string, text: string}} payload
 * @param {{config?: object}} [opts] - config override (tests); defaults to loadTchatConfig()
 * @returns {Promise<{ok: true, messageId: string} | {ok: false, error: string, status?: number}>}
 *          Never throws.
 */
export async function sendMessage({ targetType, targetId, text } = {}, { config } = {}) {
  const cfg = config || loadTchatConfig();
  if (!cfg.api_url) {
    return {
      ok: false,
      error: "tchat api_url not configured. Set api_url in tools/tchat/config.json or TCHAT_API_URL env var.",
    };
  }

  const url = `${cfg.api_url.replace(/\/+$/, "")}/api/messages`;
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: JSON.stringify({ targetType, targetId, text }),
      signal: AbortSignal.timeout(cfg.timeout_ms),
    });
  } catch (err) {
    const reason = err?.message || err?.name || "network error";
    return { ok: false, error: `tchat transport error: ${reason}` };
  }

  let body = null;
  try {
    body = await resp.json();
  } catch {
    // non-JSON body — fall through to the generic status error below
  }

  if (resp.ok && body?.ok === true && body.messageId != null) {
    return { ok: true, messageId: String(body.messageId) };
  }

  return {
    ok: false,
    error: body?.error || `tchat API error: HTTP ${resp.status}`,
    status: resp.status,
  };
}

/**
 * client.test.mjs — tests for tools/tchat/client.mjs (TASK-007, contract v0)
 *
 * Covers the transport contract from ADR-004:
 * - happy path: 200 { ok:true, messageId } → { ok:true, messageId }
 * - error mapping: 4xx/5xx { ok:false, error } → { ok:false, error, status }
 * - non-JSON / ok:false bodies → surfaced as errors, never thrown
 * - network failure (fetch rejects) → transport error, never thrown
 * - missing api_url → configuration error
 * - config loading: config.json first, env fallback, token header
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TMP = mkdtempSync(join(tmpdir(), "tchat-client-"));
process.env.PAAW_ROOT = TMP;
mkdirSync(join(TMP, "tools/tchat"), { recursive: true });

// Import AFTER PAAW_ROOT points at the temp dir.
const { sendMessage, loadTchatConfig, resetTchatConfig } = await import("./client.mjs");

const goodConfig = { api_url: "http://tchat.test", token: "tk_123", timeout_ms: 2000 };

function stubFetch(impl) {
  global.fetch = vi.fn(impl);
}

beforeEach(() => {
  resetTchatConfig();
  delete process.env.TCHAT_API_URL;
  delete process.env.TCHAT_TOKEN;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tchat client — config loading", () => {
  it("reads config.json from tools/tchat/ under PAAW_ROOT", () => {
    writeFileSync(join(TMP, "tools/tchat/config.json"), JSON.stringify(goodConfig));
    const cfg = loadTchatConfig({ reload: true });
    expect(cfg.api_url).toBe("http://tchat.test");
    expect(cfg.token).toBe("tk_123");
    expect(cfg.timeout_ms).toBe(2000);
  });

  it("falls back to env vars when config.json is missing", () => {
    rmSync(join(TMP, "tools/tchat/config.json"), { force: true });
    process.env.TCHAT_API_URL = "http://env-fallback.test";
    process.env.TCHAT_TOKEN = "env_token";
    const cfg = loadTchatConfig({ reload: true });
    expect(cfg.api_url).toBe("http://env-fallback.test");
    expect(cfg.token).toBe("env_token");
  });

  it("tolerates malformed config.json and falls back to env", () => {
    writeFileSync(join(TMP, "tools/tchat/config.json"), "{ not json ]");
    process.env.TCHAT_API_URL = "http://env-fallback.test";
    const cfg = loadTchatConfig({ reload: true });
    expect(cfg.api_url).toBe("http://env-fallback.test");
  });

  it("normalises allowed_chat_ids from env (comma-separated)", () => {
    rmSync(join(TMP, "tools/tchat/config.json"), { force: true });
    process.env.TG_ALLOWED_CHATS = "111, -222 ,";
    const cfg = loadTchatConfig({ reload: true });
    expect(cfg.allowed_chat_ids).toEqual(["111", "-222"]);
  });
});

describe("tchat client — sendMessage (contract v0)", () => {
  it("POSTs {api_url}/api/messages with the contract body", async () => {
    writeFileSync(join(TMP, "tools/tchat/config.json"), JSON.stringify(goodConfig));
    resetTchatConfig();
    stubFetch(async () => new Response(JSON.stringify({ ok: true, messageId: "m_1" }), { status: 200 }));

    const out = await sendMessage({ targetType: "user", targetId: "u1", text: "hi" });

    expect(out).toEqual({ ok: true, messageId: "m_1" });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("http://tchat.test/api/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ targetType: "user", targetId: "u1", text: "hi" });
    expect(init.headers.Authorization).toBe("Bearer tk_123");
  });

  it("strips trailing slashes from api_url", async () => {
    writeFileSync(join(TMP, "tools/tchat/config.json"), JSON.stringify({ ...goodConfig, api_url: "http://tchat.test///" }));
    resetTchatConfig();
    stubFetch(async () => new Response(JSON.stringify({ ok: true, messageId: "m_2" }), { status: 200 }));

    await sendMessage({ targetType: "channel", targetId: "ops", text: "x" });

    expect(global.fetch.mock.calls[0][0]).toBe("http://tchat.test/api/messages");
  });

  it("maps 4xx { ok:false, error } to an error result with status", async () => {
    stubFetch(async () => new Response(JSON.stringify({ ok: false, error: "no such user" }), { status: 404 }));
    const out = await sendMessage({ targetType: "user", targetId: "ghost", text: "hi" }, { config: goodConfig });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("no such user");
    expect(out.status).toBe(404);
  });

  it("maps 5xx to an error result with status", async () => {
    stubFetch(async () => new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 502 }));
    const out = await sendMessage({ targetType: "channel", targetId: "ops", text: "x" }, { config: goodConfig });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(502);
  });

  it("keeps HTTP status error when body has no error field (non-JSON body)", async () => {
    stubFetch(async () => new Response("Internal Server Error", { status: 500 }));
    const out = await sendMessage({ targetType: "user", targetId: "u1", text: "hi" }, { config: goodConfig });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("tchat API error: HTTP 500");
    expect(out.status).toBe(500);
  });

  it("treats a 200 with ok:false body as an error", async () => {
    stubFetch(async () => new Response(JSON.stringify({ ok: false, error: "rejected" }), { status: 200 }));
    const out = await sendMessage({ targetType: "user", targetId: "u1", text: "hi" }, { config: goodConfig });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("rejected");
  });

  it("returns a transport error when fetch rejects (network down)", async () => {
    stubFetch(async () => { throw new Error("ECONNREFUSED"); });
    const out = await sendMessage({ targetType: "user", targetId: "u1", text: "hi" }, { config: goodConfig });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/tchat transport error: ECONNREFUSED/);
  });

  it("returns a config error when api_url is missing", async () => {
    stubFetch(async () => new Response("{}", { status: 200 }));
    const out = await sendMessage({ targetType: "user", targetId: "u1", text: "hi" }, { config: { api_url: "" } });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/api_url not configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

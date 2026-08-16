#!/usr/bin/env node
/**
 * TChat Mock Server — dev fixture（TASK-009）
 *
 * 標準 Node http server（零依賴），監聽 port 3002（可用 MOCK_TCHAT_PORT 覆寫），
 * 實作契約 v0（specs/tchat-contract.md）的 POST /api/messages：
 *
 *   POST /api/messages
 *   body: { targetType: "user"|"channel", targetId: string, text: string }
 *   200  → { ok: true,  messageId: string }
 *   4xx  → { ok: false, error: string }
 *
 * 每筆收到的訊息 append 到 dev/mocks/tchat-sent.jsonl：
 *   { ts, targetType, targetId, text }
 * — 驗證 agent 通知行為就是讀這個檔（watchdog 驗收流程，TASK-010）。
 *
 * 情境切換：
 *   POST /__scenario  { "name": "ok" | "reject" | "down" }
 *   GET  /__scenario  → { "scenario": "<current>" }
 *   POST /__reset     → 清空 tchat-sent.jsonl（驗收前重置用）
 *   GET  /__sent      → { lines: n, messages: [...] }（讀取已收訊息，免手動開檔）
 *
 *   - ok     ：正常收訊（200 + { ok:true, messageId }）
 *   - reject ：回 403 模擬公司 API 拒絕（token 無效 / target 不存在）→
 *              驗證 run 記錄 notifyError 路徑
 *   - down   ：不回應該請求（socket 掛住不回），模擬斷線 → 驗證 client
 *              timeout / transport error 路徑
 *
 * 啟動：npm run mock:tchat（或 node dev/mocks/tchat-mock.mjs）
 *
 * ⚠️ dev fixture 專用，不進 production 路徑。
 */

import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = parseInt(process.env.MOCK_TCHAT_PORT || "3002", 10);
const VALID_SCENARIOS = ["ok", "reject", "down"];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SENT_LOG = resolve(__dirname, "tchat-sent.jsonl"); // dev/mocks/tchat-sent.jsonl

let scenario = "ok";
let messageCounter = 0;

const now = () => new Date().toISOString();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/** Read the sent log as parsed JSON lines (tolerant of a missing file). */
function readSentLog() {
  if (!existsSync(SENT_LOG)) return [];
  return readFileSync(SENT_LOG, "utf-8")
    .split("\n")
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Read the request body as a string.
 * Event-based collection (same pattern as grafana-mock.mjs readBody) —
 * Node 25 for-await over a listening IncomingMessage can silently yield
 * zero chunks, so we stick to the proven `data`/`end` events here.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Read + validate the JSON request body (size-capped for hygiene). */
async function readJsonBody(req, { maxBytes = 64 * 1024 } = {}) {
  const raw = (await readBody(req)).trim();
  if (raw.length > maxBytes) {
    throw Object.assign(new Error("request body too large"), { statusCode: 413 });
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { statusCode: 400 });
  }
}

/** Append one sent message to the jsonl log (contract v0 acceptance artifact). */
function logSent(targetType, targetId, text) {
  appendFileSync(SENT_LOG, `${JSON.stringify({ ts: now(), targetType, targetId, text })}\n`);
}

// ─────────────────────────────────────────────────────────────
// Contract v0 endpoint
// ─────────────────────────────────────────────────────────────

async function handleMessages(req, res) {
  const body = await readJsonBody(req);

  if (scenario === "down") {
    // 模擬斷線：不回應。req 保持掛起直到 client timeout（AbortSignal.timeout）
    // 主動斷開，測 client 的 transport error 路徑。
    console.log(`[tchat-mock] ${req.method} ${req.url} → (down: no response)`);
    return;
  }

  if (scenario === "reject") {
    console.log(`[tchat-mock] ${req.method} ${req.url} → 403 (scenario=reject)`);
    sendJson(res, 403, {
      ok: false,
      error: `mock scenario: reject (target ${JSON.stringify(body.targetId)} rejected)`,
    });
    return;
  }

  // ── scenario === "ok"：契約 v0 驗證 + 落檔 ──
  const { targetType, targetId, text } = body || {};
  const problems = [];
  if (targetType !== "user" && targetType !== "channel") {
    problems.push(`targetType must be "user" or "channel" (got ${JSON.stringify(targetType)})`);
  }
  if (typeof targetId !== "string" || !targetId.trim()) {
    problems.push("targetId must be a non-empty string");
  }
  if (typeof text !== "string" || !text.trim()) {
    problems.push("text must be a non-empty string");
  }
  if (problems.length) {
    console.log(`[tchat-mock] ${req.method} ${req.url} → 400 (validation)`);
    sendJson(res, 400, { ok: false, error: problems.join("; ") });
    return;
  }

  messageCounter += 1;
  logSent(targetType, targetId, text);
  const messageId = `mock_${String(messageCounter).padStart(6, "0")}`;
  console.log(`[tchat-mock] ${req.method} ${req.url} → 200 (message ${messageId} → ${targetType}/${targetId})`);
  sendJson(res, 200, { ok: true, messageId });
}

// ─────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
    // ── 控制端點（非契約，fixture 專用）──
    if (req.method === "GET" && req.url === "/__scenario") {
      sendJson(res, 200, { scenario });
      return;
    }

    if (req.method === "POST" && req.url === "/__scenario") {
      const body = await readJsonBody(req);
      if (!VALID_SCENARIOS.includes(body.name)) {
        sendJson(res, 400, {
          ok: false,
          error: `unknown scenario "${body.name}"`,
          valid: VALID_SCENARIOS,
          current: scenario,
        });
        return;
      }
      const prev = scenario;
      scenario = body.name;
      console.log(`[tchat-mock] scenario: ${prev} → ${scenario}`);
      sendJson(res, 200, { ok: true, previous: prev, scenario });
      return;
    }

    if (req.method === "POST" && req.url === "/__reset") {
      writeFileSync(SENT_LOG, "");
      console.log("[tchat-mock] sent log cleared");
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url === "/__sent") {
      const messages = readSentLog();
      sendJson(res, 200, { lines: messages.length, messages });
      return;
    }

    // ── 契約 v0 endpoint ──
    if (req.method === "POST" && req.url === "/api/messages") {
      await handleMessages(req, res);
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error(`[tchat-mock] ${req.method} ${req.url} → ${status}: ${err.message}`);
    sendJson(res, status, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[tchat-mock] contract v0 mock listening on http://localhost:${PORT}`);
  console.log(`[tchat-mock] sent log: ${SENT_LOG}`);
  console.log(`[tchat-mock] scenarios: ${VALID_SCENARIOS.join(" / ")} (current: ${scenario})`);
  console.log("[tchat-mock] controls: POST /__scenario {name} · POST /__reset · GET /__sent");
});

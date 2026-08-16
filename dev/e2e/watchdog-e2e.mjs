#!/usr/bin/env node
/**
 * dev/e2e/watchdog-e2e.mjs — TASK-010 驗收腳本（watchdog 範本 agent，全 mock）
 *
 * 驗收流程（task spec）：
 *   1. 起 grafana-mock(3001) + tchat-mock(3002) + LLM stub，jsonl 重導到隔離檔
 *   2. 載入 seed agent（agents/watchdog-patrol.json，notifyPolicy: on-signal）
 *   3. healthy 情境 → executeScheduledRun → run success 且 jsonl「無」新訊息
 *   4. firing 情境   → executeScheduledRun → run success 且 jsonl「有」新訊息
 *      （LLM 自己呼 tchat_send_message；scheduler 因 on-signal 去重不再推）
 *
 * 不打真 LLM：LLM 以本腳本內建的 OpenAI-compatible stub 取代（行為完全照
 * watchdog prompt 指示），透過 runtime 注入 config.providers.e2e 指向 stub。
 * 這驗證的是「接線」：scheduler → agent-loop → toolRegistry → 真工具層
 * → 真 transport（client.mjs）→ mocks → jsonl。
 *
 * 用法：npm run e2e:watchdog  （或 node dev/e2e/watchdog-e2e.mjs）
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const GRAFANA_PORT = parseInt(process.env.E2E_GRAFANA_PORT || "3311", 10);
const TCHAT_PORT = parseInt(process.env.E2E_TCHAT_PORT || "3312", 10);
const LLM_STUB_PORT = parseInt(process.env.E2E_LLM_PORT || "3313", 10);

const GRAFANA_URL = `http://127.0.0.1:${GRAFANA_PORT}`;
const TCHAT_URL = `http://127.0.0.1:${TCHAT_PORT}`;

// ── 隔離環境：agents / runs / tchat jsonl ──
// （conversation.mjs 寫 data/conversations/<crewId>/，無 env override — e2e 跑完清掉該 crew 目錄即可）
const WORK = mkdtempSync(join(tmpdir(), "e2e-watchdog-"));
const AGENTS_DIR = join(WORK, "agents");
const RUNS_DIR = join(WORK, "runs");
const SENT_LOG = join(WORK, "tchat-sent.jsonl");
mkdirSync(AGENTS_DIR, { recursive: true });
mkdirSync(RUNS_DIR, { recursive: true });

// seed agent 複製進隔離 dir（enabled 必須為 true 才能跑；這裡只驗 run 行為，
// 不驗 cron 註冊 — 那由 scheduler.test.mjs 的 registration 測試覆蓋）
const SEED = JSON.parse(readFileSync(join(ROOT, "agents/watchdog-patrol.json"), "utf-8"));
SEED.enabled = true;
writeFileSync(join(AGENTS_DIR, "watchdog-patrol.json"), JSON.stringify(SEED, null, 2));

process.env.SRE_AGENTS_DIR = AGENTS_DIR;
process.env.SRE_RUNS_DIR = RUNS_DIR;
process.env.TCHAT_SENT_LOG = SENT_LOG;
process.env.GRAFANA_URL = GRAFANA_URL;
process.env.TCHAT_API_URL = TCHAT_URL;

// ── LLM stub：OpenAI-compatible，兩輪行為照 watchdog prompt ──
// 輪 1（無 tool result）→ 呼 grafana_list_alerts
// 輪 2 healthy → final answer，絕不通知
// 輪 2 firing → 呼 tchat_send_message 到 notifyTarget
let grafanaScenario = "healthy";
function llmRespond(body) {
  const msgs = body.messages || [];
  const toolCallSeen = msgs.some(m => m.role === "tool");
  // agent-loop 每輪重打整包 messages：assistant 已叫過 tchat_send_message
  // 就代表通知完成 → 給 final answer 收尾（否則會跑滿 maxRounds=8）
  const notifiedAlready = msgs.some(m =>
    m.role === "assistant" && (m.tool_calls || []).some(c => c.function?.name === "tchat_send_message"));
  let message, finish_reason;
  if (!toolCallSeen) {
    finish_reason = "tool_calls";
    message = {
      role: "assistant", content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "grafana_list_alerts", arguments: "{}" } }],
    };
  } else if (grafanaScenario === "healthy") {
    finish_reason = "stop";
    message = { role: "assistant", content: "巡檢正常：所有 alert rule 均 Normal。依規範不通知任何人。" };
  } else if (notifiedAlready) {
    finish_reason = "stop";
    message = { role: "assistant", content: "已通知 ops：HighCPUUsage firing。本次巡檢結束。" };
  } else {
    finish_reason = "tool_calls";
    message = {
      role: "assistant", content: null,
      tool_calls: [{
        id: "c2", type: "function",
        function: {
          name: "tchat_send_message",
          arguments: JSON.stringify({
            targetType: "channel", targetId: "ops",
            text: "🚨 HighCPUUsage firing (critical)：CPU usage above 85%（目前 91.4%）。請確認 node 負載。",
          }),
        },
      }],
    };
  }
  return { choices: [{ index: 0, finish_reason, message }] };
}

const llmStub = createServer((req, res) => {
  let raw = "";
  req.on("data", c => (raw += c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    let payload = {};
    try { payload = llmRespond(JSON.parse(raw || "{}")); } catch { payload = { choices: [{ message: { role: "assistant", content: "stub error" } }] }; }
    res.end(JSON.stringify(payload));
  });
});
const llmSrv = await new Promise(r => llmStub.listen(LLM_STUB_PORT, "127.0.0.1", r));

// ── 注入 stub provider（在 import 任何 server 模組「之前」）──
// config.mjs export 的 config 物件屬性可寫（binding 唯讀、值可改）
const { config } = await import(join(ROOT, "server/config.mjs"));
config.active = "e2e-stub";
config.providers["e2e-stub"] = {
  name: "E2E Stub",
  baseURL: `http://127.0.0.1:${LLM_STUB_PORT}/v1`,
  apiKey: "stub-key",
  models: [{ id: "stub-model", name: "Stub Model" }],
};
config.defaultModel = "stub-model";

const mockChildren = [];
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function post(url, body) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
}
function readSent() {
  if (!existsSync(SENT_LOG)) return [];
  return readFileSync(SENT_LOG, "utf-8").split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
async function waitFor(url, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok || r.status === 400) return; } catch {}
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

try {
  // 1. mocks 起動
  mockChildren.push(spawn("node", [join(ROOT, "dev/mocks/grafana-mock.mjs")], {
    env: { ...process.env, MOCK_GRAFANA_PORT: String(GRAFANA_PORT) }, stdio: "ignore" }));
  mockChildren.push(spawn("node", [join(ROOT, "dev/mocks/tchat-mock.mjs")], {
    env: { ...process.env, MOCK_TCHAT_PORT: String(TCHAT_PORT), TCHAT_SENT_LOG: SENT_LOG }, stdio: "ignore" }));
  await Promise.all([waitFor(`${GRAFANA_URL}/__scenario`), waitFor(`${TCHAT_URL}/__scenario`)]);
  console.log("  [PASS] mock servers up (grafana + tchat + llm-stub)");

  // 2. seed agent 載入（真 agent-store → 驗 notifyPolicy 持久化）
  //    + 工具註冊（跟 index.mjs 同一條 bootstrap 路徑：loadAllTools → registry）
  const { loadAllTools } = await import(join(ROOT, "server/tool-loader.mjs"));
  await loadAllTools();
  const { getAgent } = await import(join(ROOT, "server/agent-store.mjs"));
  const agent = getAgent("watchdog-patrol");
  check("watchdog seed loads from agent-store", !!agent && agent.notifyPolicy === "on-signal");

  const scheduler = await import(join(ROOT, "server/scheduler.mjs"));

  // ── 情境 1: healthy ──
  await post(`${GRAFANA_URL}/__scenario`, { name: "healthy" });
  grafanaScenario = "healthy";
  const before = readSent().length;
  const runH = await scheduler.executeScheduledRun("watchdog-patrol");
  check("healthy: run status=success", runH?.run?.status === "success", `status=${runH?.run?.status}`);
  check("healthy: scheduler did not push (notified=false)", runH?.run?.notified === false, `notified=${runH?.run?.notified}`);
  check("healthy: tchat-sent.jsonl has NO new messages", readSent().length === before, `count=${readSent().length} (was ${before})`);

  // ── 情境 2: firing ──
  await post(`${GRAFANA_URL}/__scenario`, { name: "firing" });
  grafanaScenario = "firing";
  const before2 = readSent().length;
  const runF = await scheduler.executeScheduledRun("watchdog-patrol");
  check("firing: run status=success", runF?.run?.status === "success", `status=${runF?.run?.status}`);
  const sent = readSent();
  check("firing: tchat-sent.jsonl has +1 message from agent", sent.length === before2 + 1, `count=${sent.length} (was ${before2})`);
  const last = sent[sent.length - 1];
  check("firing: message content mentions the alert", /HighCPUUsage/i.test(String(last?.text ?? "")), JSON.stringify(last));
  check("firing: agent-notified dedupe → run.notified=true", runF?.run?.notified === true, `notified=${runF?.run?.notified}`);

  // 收尾：conversation 會寫到 repo data/conversations/watchdog-patrol/ — 清掉
  rmSync(join(ROOT, "data/conversations/watchdog-patrol"), { recursive: true, force: true });

  console.log(`\n${failed === 0 ? "✅ ALL PASS" : `💥 ${failed} FAIL`} (${passed} passed)`);
} catch (err) {
  console.error("💥", err?.message ?? err);
  failed++;
} finally {
  for (const c of mockChildren) { try { c.kill("SIGTERM"); } catch {} }
  try { llmSrv.close(); } catch {}
  if (process.env.E2E_KEEP === "1") console.log(`[e2e] workdir kept: ${WORK}`);
  else rmSync(WORK, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);

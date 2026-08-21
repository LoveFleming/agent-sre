/**
 * monitor-routes.test.mjs — HTTP tests for /api/monitors* (MVP)
 *
 * Covers the spec's MVP success criteria at the API level:
 *  - Create Monitor (form payload) → 201 + instance materialized
 *  - List (left menu summaries) / get full definition + instance
 *  - Update (Model Settings save) / delete (agent lifecycle teardown)
 *  - Run Now → agent loop executed, instance state + run-store updated
 *  - Chat scoping → conversation keyed to monitor id
 *  - Memory viewer / knowledge editor
 *  - monitor-meta pickers
 *  - Auth inheritance (X-API-Token still gates monitor routes)
 *
 * Mocks: agent-loop.mjs (LLM) + tchat handler (notify) — no network.
 * A fake "grafana_list_alerts" tool is registered into the real registry
 * so the deterministic read phase produces controlled evidence.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "http";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Isolation dirs BEFORE importing server modules ──
const MON_TMP = mkdtempSync(join(tmpdir(), "routes-monitors-test-"));
process.env.SRE_MONITORS_DIR = MON_TMP;
const MSTATE_TMP = mkdtempSync(join(tmpdir(), "routes-mstate-test-"));
process.env.SRE_MONITOR_STATE_DIR = MSTATE_TMP;
const RUNS_TMP = mkdtempSync(join(tmpdir(), "routes-mruns-test-"));
process.env.SRE_RUNS_DIR = RUNS_TMP;
const CONV_TMP = mkdtempSync(join(tmpdir(), "routes-mconv-test-"));
process.env.SRE_CONVERSATIONS_DIR = CONV_TMP;

const TOKEN = "monitor-test-token";
process.env.AGENT_SRE_API_TOKEN = TOKEN;

vi.mock("./agent-loop.mjs", () => ({
  runAgentLoop: vi.fn(async () => ({ content: "SITUATION: EMPTY\nSEVERITY: P3\nCONFIDENCE: 0.2\nRECOMMENDATION: none", history: [{ role: "user", content: "q" }, { role: "assistant", content: "SITUATION: EMPTY" }] })),
}));
vi.mock("../tools/tchat/handler.mjs", () => ({
  sendTchatMessage: vi.fn(async () => ({ ok: true })),
}));

const { registerRoutes } = await import("./routes.mjs");
const { runAgentLoop } = await import("./agent-loop.mjs");
const { sendTchatMessage } = await import("../tools/tchat/handler.mjs");
const { toolRegistry } = await import("./tool-registry.mjs");

// Fake deterministic source tool: all alerts Normal by default; tests flip it.
let fakeAlerts = [{ name: "rw-latency", state: "Normal" }];
toolRegistry.register({
  name: "grafana_list_alerts",
  handler: async () => JSON.stringify(fakeAlerts),
  definition: { type: "function", function: { name: "grafana_list_alerts", description: "test", parameters: { type: "object", properties: {} } } },
});

// ── Test server harness ──
let server;
const BASE = await new Promise(resolve => {
  server = createServer();
  registerRoutes(server);
  server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
});

async function api(method, path, body, token = TOKEN) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "X-API-Token": token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

const CREATE_BODY = {
  name: "RW API Monitor",
  sourceMCPs: [{ type: "grafana", resource: "https://grafana.company/d/rw-api", tools: ["grafana_list_alerts"] }],
  outputMCPs: [{ type: "chat", target: "ops" }],
};

afterAll(async () => {
  await new Promise(r => server.close(r));
  for (const d of [MON_TMP, MSTATE_TMP, RUNS_TMP, CONV_TMP]) rmSync(d, { recursive: true, force: true });
});

describe("monitor routes", () => {
  it("auth still gates monitor endpoints (401 without token)", async () => {
    const r = await api("GET", "/api/monitors", null, null);
    expect(r.status).toBe(401);
  });

  it("GET /api/monitor-meta returns pickers data", async () => {
    const r = await api("GET", "/api/monitor-meta");
    expect(r.status).toBe(200);
    expect(r.data.flowTemplates.length).toBeGreaterThanOrEqual(3);
    expect(r.data.schedulePresets["every-5m"]).toBe("*/5 * * * *");
    expect(r.data.sourceTypes).toContain("grafana");
    expect(r.data.outputTypes).toContain("action");
  });

  it("POST /api/monitors creates definition + instance (201)", async () => {
    const r = await api("POST", "/api/monitors", CREATE_BODY);
    expect(r.status).toBe(201);
    expect(r.data.monitor.name).toBe("RW API Monitor");
    expect(r.data.monitor.scheduler.cron).toBe("*/5 * * * *");
    expect(r.data.instance.instanceId).toMatch(/^agent-/);
    expect(r.data.instance.status).toBe("idle");
  });

  it("list shows menu summaries; get returns full detail; 404 unknown", async () => {
    const list = await api("GET", "/api/monitors");
    expect(list.status).toBe(200);
    expect(list.data.monitors).toHaveLength(1);
    const row = list.data.monitors[0];
    expect(row.sourceType).toBe("grafana");
    expect(row.flowName).toBe("Standard SRE Monitor Flow");

    const id = row.id;
    const got = await api("GET", `/api/monitors/${id}`);
    expect(got.status).toBe(200);
    expect(got.data.monitor.agentConfig.rules).toHaveLength(3);

    const missing = await api("GET", "/api/monitors/nope-nope");
    expect(missing.status).toBe(404);
  });

  it("400 on invalid create (no sources) and bad ids", async () => {
    const r = await api("POST", "/api/monitors", { name: "x", sourceMCPs: [] });
    expect(r.status).toBe(400);
    const bad = await api("GET", "/api/monitors/..%2Fetc");
    expect([400, 404]).toContain(bad.status);
  });

  it("Run Now: healthy evidence → quiet, no LLM, no notify", async () => {
    vi.mocked(runAgentLoop).mockClear();
    vi.mocked(sendTchatMessage).mockClear();
    fakeAlerts = [{ name: "rw-latency", state: "Normal" }];
    const list = await api("GET", "/api/monitors");
    const id = list.data.monitors[0].id;

    const r = await api("POST", `/api/monitors/${id}/run`);
    expect(r.status).toBe(200);
    expect(r.data.result.quiet).toBe(true);
    expect(r.data.result.ok).toBe(true);
    expect(runAgentLoop).not.toHaveBeenCalled();   // deterministic-first: no LLM when healthy
    expect(sendTchatMessage).not.toHaveBeenCalled();
    expect(r.data.instance.status).toBe("idle");
    expect(r.data.instance.runCount).toBe(1);
  });

  it("Run Now: firing alert → LLM reasoning + situation + notify", async () => {
    vi.mocked(runAgentLoop).mockClear();
    vi.mocked(sendTchatMessage).mockClear();
    fakeAlerts = [{ name: "rw-latency", state: "Firing", severity: "critical" }];
    vi.mocked(runAgentLoop).mockImplementationOnce(async () => ({
      content: "SITUATION: RW latency regression\nSEVERITY: P2\nEVIDENCE: rw-latency firing\nHYPOTHESIS: release-related db pool saturation\nCONFIDENCE: 0.9\nRECOMMENDATION: rollback v2.31",
      history: [],
    }));

    const list = await api("GET", "/api/monitors");
    const id = list.data.monitors[0].id;
    const r = await api("POST", `/api/monitors/${id}/run`);
    expect(r.status).toBe(200);
    expect(r.data.result.quiet).toBe(false);
    expect(r.data.result.situation).toBe("RW latency regression");

    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runAgentLoop).mock.calls[0][0];
    expect(call.crew.title).toBe("RW API Monitor Agent");
    expect(call.message).toContain("rw-latency");           // evidence bundled into the single reasoning call

    expect(sendTchatMessage).toHaveBeenCalledTimes(1);       // Output MCP fired
    const sent = vi.mocked(sendTchatMessage).mock.calls[0][0];
    expect(sent.targetId).toBe("ops");
    expect(sent.text).toContain("RW latency regression");

    expect(r.data.instance.status).toBe("watch");
    expect(r.data.instance.currentSituation).toBe("RW latency regression");
    expect(r.data.instance.incidentMemory).toHaveLength(1);
    expect(r.data.instance.incidentMemory[0].approvalRequired).toBe(true); // rollback keyword
    expect(r.data.instance.workingMemory.hypothesis).toContain("db pool");
  });

  it("runs history lands in run-store under monitor-<id>", async () => {
    const list = await api("GET", "/api/monitors");
    const id = list.data.monitors[0].id;
    const r = await api("GET", `/api/monitors/${id}/runs`);
    expect(r.status).toBe(200);
    expect(r.data.runs.length).toBe(2);
    expect(r.data.runs.every(x => x.agentId.startsWith("monitor-"))).toBe(true);
  });

  it("chat is scoped to the monitor (conversation persists, crew carries context)", async () => {
    vi.mocked(runAgentLoop).mockImplementationOnce(async () => ({
      content: "目前沒有需要處理的狀況",
      history: [{ role: "user", content: "is this healthy?" }, { role: "assistant", content: "目前沒有需要處理的狀況" }],
    }));
    const list = await api("GET", "/api/monitors");
    const id = list.data.monitors[0].id;

    const send = await api("POST", `/api/monitors/${id}/chat`, { message: "is this healthy?" });
    expect(send.status).toBe(200);
    expect(send.data.content).toContain("沒有");
    const call = vi.mocked(runAgentLoop).mock.calls.at(-1)[0];
    expect(call.crew.systemPrompt).toContain("SRE Agent");
    expect(call.crew.expertise).toContain("RW API");        // live instance state injected

    const hist = await api("GET", `/api/monitors/${id}/chat`);
    expect(hist.status).toBe(200);
    expect(hist.data.messages.length).toBeGreaterThan(0);

    const bad = await api("POST", `/api/monitors/${id}/chat`, { message: "" });
    expect(bad.status).toBe(400);
  });

  it("memory viewer + knowledge editor", async () => {
    const list = await api("GET", "/api/monitors");
    const id = list.data.monitors[0].id;
    const view = await api("GET", `/api/monitors/${id}/memory`);
    expect(view.status).toBe(200);
    expect(view.data.incidents).toHaveLength(1);
    expect(view.data.working.confidence).toBe(0.9);

    const put = await api("PUT", `/api/monitors/${id}/memory`, { knowledge: ["baseline p99 < 200ms"] });
    expect(put.status).toBe(200);
    expect(put.data.knowledge).toEqual(["baseline p99 < 200ms"]);
    const bad = await api("PUT", `/api/monitors/${id}/memory`, { knowledge: "nope" });
    expect(bad.status).toBe(400);
  });

  it("PUT updates the definition (Model Settings save)", async () => {
    const list = await api("GET", "/api/monitors");
    const id = list.data.monitors[0].id;
    const r = await api("PUT", `/api/monitors/${id}`, {
      ...CREATE_BODY,
      name: "RW API Monitor v2",
      scheduler: { cron: "every-15m" },
      agentConfig: { agentName: "RW SRE Investigator", mission: "guard the RW API" },
    });
    expect(r.status).toBe(200);
    expect(r.data.monitor.name).toBe("RW API Monitor v2");
    expect(r.data.monitor.scheduler.cron).toBe("*/15 * * * *");
    expect(r.data.monitor.agentConfig.agentName).toBe("RW SRE Investigator");
  });

  it("DELETE tears down definition + instance state", async () => {
    const list = await api("GET", "/api/monitors");
    const id = list.data.monitors[0].id;
    const r = await api("DELETE", `/api/monitors/${id}`);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    const after = await api("GET", `/api/monitors/${id}`);
    expect(after.status).toBe(404);
    const gone = await api("GET", "/api/monitors");
    expect(gone.data.monitors).toHaveLength(0);
  });
});

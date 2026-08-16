/**
 * scheduler.test.mjs — tests for server/scheduler.mjs (TASK-005)
 *
 * Covers (per task spec: cron parse/註冊邏輯 with mock timer, 最少單元測試):
 * - startScheduler registration rules: enabled + schedule → one job;
 *   disabled / no schedule / invalid expression → skipped, never fatal
 * - rescheduleAgent (routes hook): deleted removes, updated swaps the
 *   expression, created registers
 * - cron firing with fake timers: tick → run recorded success with the
 *   notify outcome from the (mocked) tchat transport (TASK-007)
 * - executeScheduledRun: success path, failure path, timeout → failed,
 *   in-flight re-entry returns {skipped:true}
 * - buildCrew: agent → crew shape (prompt/rules/context/notifyTarget all
 *   land in the fields the agent loop actually reads)
 *
 * Isolation: SRE_AGENTS_DIR / SRE_RUNS_DIR point at fresh temp dirs before
 * dynamic import (same trick as agent-store / run-store tests). agent-loop
 * and conversation are mocked — no LLM call, no repo data/ writes.
 *
 * Note: vi.waitFor() is deliberately NOT used under fake timers — it fast-
 * forwards timers and would fire extra cron ticks. Microtasks are flushed
 * via advanceTimersByTimeAsync(0) instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TMP_AGENTS = mkdtempSync(join(tmpdir(), "sched-agents-"));
const TMP_RUNS = mkdtempSync(join(tmpdir(), "sched-runs-"));
process.env.SRE_AGENTS_DIR = TMP_AGENTS;
process.env.SRE_RUNS_DIR = TMP_RUNS;
process.env.SRE_RUNS_RETENTION = "50";

vi.mock("./agent-loop.mjs", () => ({
  runAgentLoop: vi.fn(async () => ({ content: "ok", history: [] })),
}));
vi.mock("./conversation.mjs", () => ({
  loadConversation: vi.fn(() => []),
  saveConversation: vi.fn(() => {}),
}));

// TASK-007: notify goes through the real tool layer's sendTchatMessage —
// mock it so scheduler tests never hit the tchat transport.
const tchatMock = vi.fn(async () => ({ ok: true, messageId: "m_test" }));
vi.mock("../tools/tchat/handler.mjs", () => ({
  sendTchatMessage: tchatMock,
  default: vi.fn(),
}));

const scheduler = await import("./scheduler.mjs");
const agentStore = await import("./agent-store.mjs");
const runStore = await import("./run-store.mjs");
const { runAgentLoop } = await import("./agent-loop.mjs");

function resetDir(dir) {
  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

/** Persist a valid schedulable agent and return the stored record. */
function seedAgent(overrides = {}) {
  return agentStore.saveAgent({
    name: "checker",
    description: "demo agent",
    context: "",
    prompt: "you are a checker",
    schedule: "*/1 * * * *",
    notifyTarget: { targetType: "user", targetId: "u1" },
    ...overrides,
  });
}

/** All persisted run records (flattened from the temp runs dir). */
function allRuns() {
  const out = [];
  for (const entry of readdirSync(TMP_RUNS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const f of readdirSync(join(TMP_RUNS, entry.name))) {
      if (f.endsWith(".json")) {
        out.push(JSON.parse(readFileSync(join(TMP_RUNS, entry.name, f), "utf-8")));
      }
    }
  }
  return out;
}

beforeEach(() => {
  resetDir(TMP_AGENTS);
  resetDir(TMP_RUNS);
  runAgentLoop.mockReset();
  runAgentLoop.mockImplementation(async () => ({ content: "ok", history: [] }));
});

afterEach(() => {
  scheduler.stopScheduler();
});

afterAll(() => {
  rmSync(TMP_AGENTS, { recursive: true, force: true });
  rmSync(TMP_RUNS, { recursive: true, force: true });
});

describe("scheduler — registration logic", () => {
  it("startScheduler registers only enabled agents with a schedule", () => {
    const scheduled = seedAgent({ name: "a1" });
    seedAgent({ name: "a2", schedule: null }); // manual-only → skipped
    seedAgent({ name: "a3", enabled: false }); // disabled → skipped

    const status = scheduler.startScheduler();

    expect(scheduler.activeSchedule(scheduled.id)).toBe("*/1 * * * *");
    expect(scheduler.activeCount()).toBe(1);
    expect(status.jobs).toHaveLength(1);
    expect(status.jobs[0]).toMatchObject({ agentId: scheduled.id, schedule: "*/1 * * * *" });
    writeFileSync(
      join(TMP_AGENTS, "badfile1.json"),
      JSON.stringify({
        id: "badfile1",
        name: "bad",
        prompt: "x",
        schedule: "not a cron",
        notifyTarget: { targetType: "user", targetId: "u" },
        enabled: true,
      })
    );
    // listAgents returns null for unreadable/invalid records and warns —
    // the scheduler must survive and register nothing for this agent.
    scheduler.startScheduler();
    expect(scheduler.activeSchedule("badfile1")).toBeNull();
  });

  it("startScheduler is idempotent — a second call does not double-register", () => {
    const a = seedAgent();
    scheduler.startScheduler();
    scheduler.startScheduler();
    expect(scheduler.activeCount()).toBe(1);
    expect(scheduler.activeSchedule(a.id)).toBe("*/1 * * * *");
  });
});

describe("scheduler — rescheduleAgent (routes notifier hook)", () => {
  it("created/updated/deleted events reconcile the cron job", () => {
    const a = seedAgent();
    scheduler.startScheduler();
    expect(scheduler.activeSchedule(a.id)).toBe("*/1 * * * *");

    // updated → new expression replaces the old job
    const updated = agentStore.saveAgent({ ...a, schedule: "0 5 * * *" });
    scheduler.rescheduleAgent("updated", updated);
    expect(scheduler.activeSchedule(a.id)).toBe("0 5 * * *");
    expect(scheduler.activeCount()).toBe(1);

    // updated → unscheduled removes the job
    const unscheduled = agentStore.saveAgent({ ...a, schedule: null });
    scheduler.rescheduleAgent("updated", unscheduled);
    expect(scheduler.activeSchedule(a.id)).toBeNull();

    // created (a different agent) registers it
    const b = seedAgent({ name: "b" });
    scheduler.rescheduleAgent("created", b);
    expect(scheduler.activeSchedule(b.id)).toBe("*/1 * * * *");

    // deleted removes it
    scheduler.rescheduleAgent("deleted", { id: b.id });
    expect(scheduler.activeSchedule(b.id)).toBeNull();
  });

  it("mutations before startScheduler are ignored (boot race guard)", () => {
    const a = seedAgent();
    scheduler.rescheduleAgent("created", a);
    expect(scheduler.activeSchedule(a.id)).toBeNull();
  });
});

describe("scheduler — executeScheduledRun", () => {
  it("records a success run with the notify outcome from the tchat transport", async () => {
    const a = seedAgent();
    runAgentLoop.mockImplementationOnce(async () => ({
      content: "all clear",
      history: [{ role: "user", content: "q" }, { role: "assistant", content: "all clear" }],
    }));
    tchatMock.mockResolvedValueOnce({ ok: true, messageId: "m_1" });

    const out = await scheduler.executeScheduledRun(a.id);

    expect(out.skipped).toBeUndefined();
    expect(out.run.status).toBe("success");
    expect(out.run.summary).toBe("all clear");
    expect(out.run.notified).toBe(true);
    expect(tchatMock).toHaveBeenCalledWith({
      targetType: "user",
      targetId: "u1",
      text: "all clear",
    });
    expect(runAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({ crew: expect.objectContaining({ id: a.id }) })
    );
    // history persisted through the conversation store (mocked)
    const { saveConversation } = await import("./conversation.mjs");
    expect(saveConversation).toHaveBeenCalled();
    expect(scheduler.isRunning(a.id)).toBe(false);
  });

  it("records notified:false + notifyError when the transport rejects", async () => {
    const a = seedAgent();
    runAgentLoop.mockImplementationOnce(async () => ({ content: "all clear", history: [] }));
    tchatMock.mockResolvedValueOnce({ ok: false, error: "tchat API error: HTTP 502" });

    const out = await scheduler.executeScheduledRun(a.id);

    expect(out.run.status).toBe("success");
    expect(out.run.notified).toBe(false);
    expect(out.run.notifyError).toBe("tchat API error: HTTP 502");
  });

  it("records a failed run and clears the in-flight flag", async () => {
    const a = seedAgent();
    runAgentLoop.mockImplementationOnce(async () => {
      throw new Error("LLM exploded");
    });
    tchatMock.mockResolvedValueOnce({ ok: false, error: "tchat down" });

    const out = await scheduler.executeScheduledRun(a.id);

    expect(out.run.status).toBe("failed");
    expect(out.run.error).toMatch(/LLM exploded/);
    // failed runs still attempt the failure notification via the transport
    expect(tchatMock).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("LLM exploded") }));
    expect(out.run.notified).toBe(false);
    expect(out.run.notifyError).toBe("tchat down");
    expect(scheduler.isRunning(a.id)).toBe(false);
  });

  it("a run exceeding timeoutMs is resolved as failed", async () => {
    const a = seedAgent();
    runAgentLoop.mockImplementationOnce(() => new Promise(() => {})); // never settles

    const out = await scheduler.executeScheduledRun(a.id, { timeoutMs: 50 });

    expect(out.run.status).toBe("failed");
    expect(out.run.error).toMatch(/timed out/i);
    expect(scheduler.isRunning(a.id)).toBe(false);
  });

  it("skips re-entry while the same agent is running", async () => {
    const a = seedAgent();
    let release;
    const gate = new Promise(r => (release = r));
    runAgentLoop.mockImplementationOnce(() => gate.then(() => ({ content: "slow", history: [] })));

    const first = scheduler.executeScheduledRun(a.id);
    await Promise.resolve(); // let the first call reach the in-flight add
    expect(scheduler.isRunning(a.id)).toBe(true);

    const second = await scheduler.executeScheduledRun(a.id);
    expect(second).toEqual({ skipped: true, reason: "already-running" });

    release();
    const done = await first;
    expect(done.run.status).toBe("success");
    expect(scheduler.isRunning(a.id)).toBe(false);
    expect(allRuns()).toHaveLength(1); // only the first run ever started
  });

  it("an unknown agent id throws before any run is created", async () => {
    await expect(scheduler.executeScheduledRun("ghost")).rejects.toThrow(/not found/i);
    expect(allRuns()).toHaveLength(0);
  });
});

describe("scheduler — cron firing (fake timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the registered job fires on schedule and runs the agent", async () => {
    const a = seedAgent();
    scheduler.startScheduler();

    // Advance just past one minute boundary; advanceTimersByTimeAsync
    // flushes the tick → startRun → runAgentLoop → finishRun chain.
    await vi.advanceTimersByTimeAsync(61_000);

    const runs = runStore.listRuns({ agentId: a.id });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
    expect(runs[0].notified).toBe(true); // transport mocked ok (TASK-007)
  });
});

describe("scheduler — buildCrew mapping", () => {
  it("maps agent fields into the shape runAgentLoop consumes", () => {
    const crew = scheduler.buildCrew({
      id: "agent-x",
      name: "DB Guardian",
      description: "看資料庫",
      context: "production cluster",
      prompt: "你是 DB 巡檢員",
      agentRules: {
        guardrails: ["不可重啟節點"],
        redirectRules: ["容量問題轉 infra"],
        refuseTopics: ["個資"],
      },
      allowedTools: ["grafana_list_dashboards"],
      notifyTarget: { targetType: "channel", targetId: "ops" },
    });

    expect(crew.id).toBe("agent-x");
    expect(crew.title).toBe("DB Guardian");
    expect(crew.allowedTools).toEqual(["grafana_list_dashboards"]);
    // context → description; rules + prompt + notify target → systemPrompt
    // (the fields buildSystemPrompt actually reads)
    expect(crew.description).toContain("production cluster");
    expect(crew.systemPrompt).toContain("不可重啟節點");
    expect(crew.systemPrompt).toContain("容量問題轉 infra");
    expect(crew.systemPrompt).toContain("個資");
    expect(crew.systemPrompt).toContain("你是 DB 巡檢員");
    expect(crew.systemPrompt).toContain("channel");
    expect(crew.systemPrompt).toContain("ops");
  });

  it("empty rules produce a clean prompt without dangling sections", () => {
    const crew = scheduler.buildCrew({
      id: "a",
      name: "bare",
      prompt: "role only",
      agentRules: { guardrails: [], redirectRules: [], refuseTopics: [] },
      notifyTarget: { targetType: "user", targetId: "u" },
    });
    expect(crew.systemPrompt).toContain("role only");
    expect(crew.expertise).toBe("");
    expect(crew.systemPrompt).not.toContain("Guardrails");
    expect(crew.systemPrompt).not.toContain("undefined");
  });
});

/**
 * run-store.test.mjs — tests for server/run-store.mjs (TASK-004)
 *
 * Covers: startRun/finishRun lifecycle, listRuns (+ agentId filter),
 * getRun (found / 404-style null / corrupt file), summary truncation,
 * toolCalls normalization, id traversal protection, and atomic-write
 * artifacts (.tmp ignored by listings).
 *
 * Isolation: SRE_RUNS_DIR env var points the store at a fresh temp dir
 * before dynamic import (runs/ is runtime output and must never be
 * polluted by tests) — same trick as agent-store.test.mjs.
 */

import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TMP_DIR = mkdtempSync(join(tmpdir(), "run-store-test-"));
process.env.SRE_RUNS_DIR = TMP_DIR;

const { startRun, finishRun, listRuns, getRun } = await import("./run-store.mjs");

/** Direct path of an agent's run file (bypasses the store API). */
function rawFile(agentId, runId) {
  return join(TMP_DIR, agentId, `${runId}.json`);
}

/** Clear every file under the temp runs dir between tests. */
function resetRunsDir() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  for (const entry of readdirSync(TMP_DIR)) {
    rmSync(join(TMP_DIR, entry), { recursive: true, force: true });
  }
}

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("run-store — 1. startRun lifecycle + record shape", () => {
  beforeEach(resetRunsDir);

  it("startRun 寫出 running 記錄，欄位齊全且 id 可排序", () => {
    const run = startRun("agent-a");
    expect(run.id).toMatch(/^[0-9]{8}T[0-9]{6}-[0-9]{3}-[0-9a-f]{8}$/);
    expect(run.agentId).toBe("agent-a");
    expect(run.status).toBe("running");
    expect(run.startedAt).toBeTruthy();
    expect(run.finishedAt).toBeNull();
    expect(run.durationMs).toBeNull();
    expect(run.summary).toBe("");
    expect(run.notified).toBe(false);
    expect(run.toolCalls).toEqual([]);
    expect(run.error).toBeNull();
    expect(existsSync(rawFile("agent-a", run.id))).toBe(true);
  });

  it("同一毫秒連續 startRun 也不會撞 id（隨機後綴）", () => {
    const a = startRun("agent-a");
    const b = startRun("agent-a");
    expect(a.id).not.toBe(b.id);
    expect(readdirSync(join(TMP_DIR, "agent-a"))).toHaveLength(2);
  });

  it("startRun 無效 agentId（traversal 樣式）→ throw", () => {
    expect(() => startRun("..")).toThrow(/Invalid agentId/);
    expect(() => startRun("../escape")).toThrow(/Invalid agentId/);
    expect(() => startRun("a/b")).toThrow(/Invalid agentId/);
    expect(() => startRun("")).toThrow(/Invalid agentId/);
    expect(() => startRun(42)).toThrow(/Invalid agentId/);
  });
});

describe("run-store — 2. finishRun outcome patching", () => {
  beforeEach(resetRunsDir);

  it("success run：status/finishedAt/durationMs/summary/notified 更新", () => {
    const run = startRun("agent-a");
    const updated = finishRun(run.id, {
      status: "success",
      summary: "CPU 正常，無需告警",
      notified: true,
      toolCalls: [{ name: "grafana_query_metrics", durationMs: 120 }],
    });
    expect(updated.status).toBe("success");
    expect(updated.finishedAt).toBeTruthy();
    expect(updated.durationMs).toBeGreaterThanOrEqual(0);
    expect(updated.summary).toBe("CPU 正常，無需告警");
    expect(updated.notified).toBe(true);
    expect(updated.toolCalls).toEqual([{ name: "grafana_query_metrics", durationMs: 120 }]);
    expect(updated.error).toBeNull();
  });

  it("failed run：error 記錄且 summary 保留 running 時的空值", () => {
    const run = startRun("agent-a");
    const updated = finishRun(run.id, { status: "failed", error: "tool timeout" });
    expect(updated.status).toBe("failed");
    expect(updated.error).toBe("tool timeout");
    expect(updated.summary).toBe("");
    expect(updated.notified).toBe(false);
  });

  it("finishRun 不存在的 run → throw（404 語意）", () => {
    expect(() => finishRun("20260816T000000-000-00000000", { status: "success" })).toThrow(/Run not found/);
  });

  it("finishRun 缺 status 或 status=running → throw", () => {
    const run = startRun("agent-a");
    expect(() => finishRun(run.id, {})).toThrow(/requires status/);
    expect(() => finishRun(run.id, { status: "running" })).toThrow(/requires status/);
  });

  it("finishRun 無效 runId（traversal）→ throw", () => {
    expect(() => finishRun("../../etc/passwd", { status: "success" })).toThrow(/Invalid run id/);
  });

  it("summary 超長截斷至 4000；success run 的 error 一律為 null", () => {
    const run = startRun("agent-a");
    const updated = finishRun(run.id, {
      status: "success",
      summary: "x".repeat(5000),
      error: "y".repeat(3000),
    });
    expect(updated.summary).toHaveLength(4000);
    expect(updated.error).toBeNull();
  });

  it("failed run 的 error 超長截斷至 2000", () => {
    const run = startRun("agent-a");
    const updated = finishRun(run.id, { status: "failed", error: "y".repeat(3000) });
    expect(updated.error).toHaveLength(2000);
  });

  it("toolCalls 含畸形元素 → normalize 成 name-only 條目", () => {
    const run = startRun("agent-a");
    const updated = finishRun(run.id, {
      status: "success",
      toolCalls: [{ name: "ok", durationMs: 1 }, null, "junk", { durationMs: 5 }, { name: "no-dur" }],
    });
    expect(updated.toolCalls).toEqual([
      { name: "ok", durationMs: 1 },
      { name: "no-dur", durationMs: null },
    ]);
  });
});

describe("run-store — 3. listRuns + getRun", () => {
  beforeEach(resetRunsDir);

  it("listRuns 回摘要（含 toolCallCount）且按 startedAt 新→舊排序", async () => {
    const old = startRun("agent-a");
    await new Promise(r => setTimeout(r, 5));
    const newer = startRun("agent-b");
    finishRun(newer.id, {
      status: "success",
      toolCalls: [{ name: "t1" }, { name: "t2" }],
    });

    const runs = listRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe(newer.id);
    expect(runs[1].id).toBe(old.id);
    expect(runs[0].toolCallCount).toBe(2);
    expect(runs[1].toolCallCount).toBe(0);
    // summary shape: no toolCalls / error keys in list output
    expect(runs[0]).not.toHaveProperty("toolCalls");
    expect(runs[0]).not.toHaveProperty("error");
  });

  it("listRuns ?agentId= 過濾只回該 agent 的 runs", () => {
    startRun("agent-a");
    const b = startRun("agent-b");
    const runs = listRuns({ agentId: "agent-b" });
    expect(runs).toHaveLength(1);
    expect(runs[0].agentId).toBe("agent-b");
    expect(runs[0].id).toBe(b.id);
  });

  it("listRuns 無效 agentId → throw；空目錄 → []", () => {
    expect(() => listRuns({ agentId: "../x" })).toThrow(/Invalid agentId/);
    expect(listRuns({ agentId: "no-such-agent" })).toEqual([]);
    expect(listRuns()).toEqual([]);
  });

  it("listRuns 跳過壞檔（corrupt JSON）不炸整個列表", () => {
    startRun("agent-a");
    writeFileSync(rawFile("agent-a", "20260816T000000-000-deadbeef"), "NOT JSON");
    const runs = listRuns();
    expect(runs).toHaveLength(1); // corrupt file skipped
  });

  it("listRuns 忽略 .tmp 暫存檔與非 run 檔名", () => {
    const run = startRun("agent-a");
    writeFileSync(rawFile("agent-a", run.id) + ".tmp", "{}");
    writeFileSync(join(TMP_DIR, "agent-a", "notes.txt"), "x");
    expect(listRuns()).toHaveLength(1);
  });

  it("getRun 回完整記錄（含 toolCalls/error）；不存在 → null", () => {
    const run = startRun("agent-a");
    finishRun(run.id, {
      status: "failed",
      error: "boom",
      toolCalls: [{ name: "t", durationMs: 3 }],
    });
    const full = getRun(run.id);
    expect(full.id).toBe(run.id);
    expect(full.status).toBe("failed");
    expect(full.error).toBe("boom");
    expect(full.toolCalls).toEqual([{ name: "t", durationMs: 3 }]);

    expect(getRun("20260816T000000-000-00000000")).toBeNull();
  });

  it("getRun 無效 id（traversal）→ throw", () => {
    expect(() => getRun("..")).toThrow(/Invalid run id/);
    expect(() => getRun("a%2f..%2fb")).toThrow(/Invalid run id/);
  });
});

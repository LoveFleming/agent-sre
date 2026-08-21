/**
 * monitor-instance.test.mjs — tests for server/monitor-instance.mjs
 *
 * Isolation: SRE_MONITOR_STATE_DIR env var → fresh temp dir before import.
 */

import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TMP_DIR = mkdtempSync(join(tmpdir(), "monitor-instance-test-"));
process.env.SRE_MONITOR_STATE_DIR = TMP_DIR;

const { getInstance, updateInstance, recordRun, appendIncident, setKnowledge, destroyInstance, peekInstance } = await import("./monitor-instance.mjs");

const MON = { id: "m1", name: "RW API", enabled: true };

afterAll(() => rmSync(TMP_DIR, { recursive: true, force: true }));

beforeEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("getInstance", () => {
  it("lazily creates a blank instance and persists it", () => {
    const inst = getInstance(MON);
    expect(inst.instanceId).toBe("agent-m1");
    expect(inst.status).toBe("idle");
    expect(inst.runCount).toBe(0);
    expect(inst.knowledgeMemory).toEqual([]);
    expect(inst.incidentMemory).toEqual([]);
    expect(peekInstance("m1")).toBe(inst);
  });

  it("refuses invalid monitor input", () => {
    expect(() => getInstance(null)).toThrow();
    expect(() => getInstance({})).toThrow();
  });
});

describe("recordRun", () => {
  it("healthy run → idle, quiet, no situation", () => {
    getInstance(MON);
    const inst = recordRun("m1", { ok: true, situation: "", summary: "healthy", nextRunAt: "2026-08-22T00:00:00Z" });
    expect(inst.runCount).toBe(1);
    expect(inst.status).toBe("idle");
    expect(inst.lastRunResult).toBe("success");
    expect(inst.nextRunAt).toBe("2026-08-22T00:00:00Z");
    expect(inst.currentState).toBe("sleep");
  });

  it("signaled run → watch status + working memory", () => {
    recordRun("m1", {
      ok: true,
      situation: "latency regression",
      summary: "P2",
      working: { hypothesis: "db pool", evidence: ["e1"], confidence: 0.8 },
    });
    const inst = peekInstance("m1");
    expect(inst.status).toBe("watch");
    expect(inst.currentSituation).toBe("latency regression");
    expect(inst.workingMemory.hypothesis).toBe("db pool");
    expect(inst.workingMemory.confidence).toBe(0.8);
  });

  it("failed run → error status", () => {
    recordRun("m1", { ok: false, situation: "", summary: "timeout" });
    expect(peekInstance("m1").status).toBe("error");
    expect(peekInstance("m1").lastRunResult).toBe("failed");
  });
});

describe("appendIncident + closure", () => {
  it("appends open incident; healthy run closes the latest", () => {
    getInstance(MON);
    appendIncident("m1", { situation: "db pool saturation", severity: "P2", summary: "s", confidence: 0.9, recommendation: "rollback v2" });
    let inst = peekInstance("m1");
    expect(inst.incidentMemory).toHaveLength(1);
    expect(inst.incidentMemory[0].open).toBe(true);
    expect(inst.incidentMemory[0].approvalRequired).toBe(true); // "rollback" keyword

    recordRun("m1", { ok: true, situation: "" }); // situation resolved
    inst = peekInstance("m1");
    expect(inst.incidentMemory[0].open).toBe(false);
    expect(inst.incidentMemory[0].closedAt).toBeTruthy();
  });
});

describe("setKnowledge / destroyInstance", () => {
  it("replaces knowledge wholesale; destroy removes state", () => {
    getInstance(MON);
    setKnowledge("m1", ["baseline p99 < 200ms", ""]);
    expect(peekInstance("m1").knowledgeMemory).toEqual(["baseline p99 < 200ms"]); // empties filtered
    expect(() => setKnowledge("m1", "not-an-array")).toThrow();

    expect(destroyInstance("m1")).toBe(true);
    expect(peekInstance("m1")).toBeNull();
    expect(destroyInstance("m1")).toBe(false); // already gone
  });

  it("updateInstance on unknown id returns null", () => {
    expect(updateInstance("ghost", () => {})).toBeNull();
  });
});

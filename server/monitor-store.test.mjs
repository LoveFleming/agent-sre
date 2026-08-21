/**
 * monitor-store.test.mjs — tests for server/monitor-store.mjs
 *
 * Isolation: SRE_MONITORS_DIR env var points the store at a fresh temp dir
 * before dynamic import (data/monitors/ is runtime state, not test data).
 */

import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TMP_DIR = mkdtempSync(join(tmpdir(), "monitor-store-test-"));
process.env.SRE_MONITORS_DIR = TMP_DIR;

const { listMonitors, getMonitor, createMonitor, updateMonitor, deleteMonitor, presetToCron } = await import("./monitor-store.mjs");

/** Minimal valid create payload (mirrors the Create Monitor form). */
function baseInput(overrides = {}) {
  return {
    name: "RW API Monitor",
    sourceMCPs: [{ type: "grafana", resource: "https://grafana.company/d/rw-api" }],
    outputMCPs: [{ type: "chat", target: "ops" }],
    ...overrides,
  };
}

afterAll(() => rmSync(TMP_DIR, { recursive: true, force: true }));

beforeEach(() => {
  for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f));
});

describe("createMonitor", () => {
  it("creates with defaults filled (scheduler, flow, agentConfig, memoryPolicy)", () => {
    const m = createMonitor(baseInput());
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.name).toBe("RW API Monitor");
    // scheduler defaults to every-5m interval
    expect(m.scheduler.cron).toBe("*/5 * * * *");
    expect(m.scheduler.timezone).toBe("Asia/Taipei");
    expect(m.scheduler.overlapPolicy).toBe("skip");
    // flow + agent defaults
    expect(m.processFlow.templateId).toBe("standard-sre");
    expect(m.agentConfig.agentName).toBe("RW API Monitor Agent");
    expect(m.agentConfig.rules.length).toBe(3);
    expect(m.agentConfig.prompt).toContain("SRE Agent");
    expect(m.agentConfig.skills.length).toBeGreaterThan(3);
    // memory policy defaults
    expect(m.memoryPolicy.persistKnowledge).toBe(true);
    expect(m.enabled).toBe(true);
    // output approval: chat type doesn't require approval
    expect(m.outputMCPs[0].approvalRequired).toBe(false);
    // persisted to disk
    expect(existsSync(join(TMP_DIR, `${m.id}.json`))).toBe(true);
  });

  it("resolves interval presets to cron", () => {
    const m = createMonitor(baseInput({ scheduler: { preset: "x", cron: "every-15m" } }));
    expect(m.scheduler.cron).toBe("*/15 * * * *");
  });

  it("action outputs always require approval", () => {
    const m = createMonitor(baseInput({ outputMCPs: [{ type: "action", target: "ops", approvalRequired: false }] }));
    expect(m.outputMCPs[0].approvalRequired).toBe(true);
  });

  it("rejects: missing name", () => {
    expect(() => createMonitor(baseInput({ name: " " }))).toThrow(/name/i);
  });

  it("rejects: zero sources", () => {
    expect(() => createMonitor(baseInput({ sourceMCPs: [] }))).toThrow(/SourceMCP/i);
  });

  it("rejects: bad source type", () => {
    expect(() => createMonitor(baseInput({ sourceMCPs: [{ type: "nope", resource: "x" }] }))).toThrow(/type/i);
  });

  it("rejects: bad cron", () => {
    expect(() => createMonitor(baseInput({ scheduler: { cron: "not a cron" } }))).toThrow(/cron/i);
  });

  it("rejects: missing output target", () => {
    expect(() => createMonitor(baseInput({ outputMCPs: [{ type: "chat", target: "" }] }))).toThrow(/target/i);
  });
});

describe("getMonitor / listMonitors", () => {
  it("round-trips through disk", () => {
    const m = createMonitor(baseInput());
    const got = getMonitor(m.id);
    expect(got.name).toBe("RW API Monitor");
    expect(got.sourceMCPs[0].type).toBe("grafana");
    expect(listMonitors()).toHaveLength(1);
  });

  it("returns null for unknown ids, throws for unsafe ids", () => {
    expect(getMonitor("does-not-exist")).toBeNull();
    expect(() => getMonitor("../evil")).toThrow(/Invalid monitor id/);
  });

  it("list skips corrupt files without blanking the registry", () => {
    createMonitor(baseInput());
    writeFileSync(join(TMP_DIR, "broken-monitor.json"), "{not json");
    const list = listMonitors();
    expect(list).toHaveLength(1);
  });
});

describe("updateMonitor", () => {
  it("merges changes and bumps updatedAt only", () => {
    const m = createMonitor(baseInput());
    const updated = updateMonitor(m.id, baseInput({ name: "RW API v2", description: "renamed" }));
    expect(updated.name).toBe("RW API v2");
    expect(updated.description).toBe("renamed");
    expect(updated.createdAt).toBe(m.createdAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(m.updatedAt).getTime());
  });

  it("404-flavored error for unknown ids", () => {
    expect(() => updateMonitor("ghost-id", baseInput())).toThrow(/^Monitor not found/);
  });

  it("disabled monitors persist enabled=false", () => {
    const m = createMonitor(baseInput());
    const updated = updateMonitor(m.id, baseInput({ enabled: false }));
    expect(updated.enabled).toBe(false);
  });
});

describe("deleteMonitor", () => {
  it("deletes existing, returns false for missing", () => {
    const m = createMonitor(baseInput());
    expect(deleteMonitor(m.id)).toBe(true);
    expect(existsSync(join(TMP_DIR, `${m.id}.json`))).toBe(false);
    expect(deleteMonitor(m.id)).toBe(false);
  });
});

describe("presetToCron", () => {
  it("maps known presets and rejects unknown", () => {
    expect(presetToCron("every-1m")).toBe("* * * * *");
    expect(presetToCron("every-5m")).toBe("*/5 * * * *");
    expect(presetToCron("bogus")).toBeNull();
  });
});

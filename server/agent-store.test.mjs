/**
 * agent-store.test.mjs — tests for server/agent-store.mjs
 *
 * Isolation: SRE_AGENTS_DIR env var points the store at a fresh temp dir
 * before dynamic import (agents/ is version-controlled config-as-code and
 * must never be polluted by tests).
 */

import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TMP_DIR = mkdtempSync(join(tmpdir(), "agent-store-test-"));
process.env.SRE_AGENTS_DIR = TMP_DIR;

const { listAgents, getAgent, saveAgent, deleteAgent } = await import("./agent-store.mjs");

const VALID_TARGET = { targetType: "user", targetId: "u-123" };

/** Minimal valid create payload. */
function baseInput(overrides = {}) {
  return { name: "Watchdog", notifyTarget: VALID_TARGET, ...overrides };
}

/** Read the raw stored file for an agent id (bypasses the store API). */
function rawFile(id) {
  return join(TMP_DIR, `${id}.json`);
}

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("agent-store — 1. CRUD round-trip + list ordering + update semantics", () => {
  beforeEach(() => {
    for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
  });

  it("create → get → update → delete round-trip returns stored data", () => {
    const created = saveAgent(baseInput({ description: "cpu watchdog" }));
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const fetched = getAgent(created.id);
    expect(fetched.name).toBe("Watchdog");
    expect(fetched.description).toBe("cpu watchdog");
    expect(fetched.notifyTarget).toEqual(VALID_TARGET);

    const updated = saveAgent({ id: created.id, name: "Watchdog v2" });
    expect(updated.id).toBe(created.id);
    expect(getAgent(updated.id).name).toBe("Watchdog v2");

    expect(deleteAgent(created.id)).toBe(true);
    expect(getAgent(created.id)).toBeNull();
  });

  it("listAgents sorts by createdAt ascending (oldest first)", async () => {
    const a = saveAgent(baseInput({ name: "A" }));
    await new Promise(r => setTimeout(r, 15)); // distinct ISO timestamps
    const b = saveAgent(baseInput({ name: "B" }));
    await new Promise(r => setTimeout(r, 15));
    const c = saveAgent(baseInput({ name: "C" }));

    expect(listAgents().map(x => x.id)).toEqual([a.id, b.id, c.id]);
  });

  it("update only changes updatedAt, preserves createdAt", async () => {
    const created = saveAgent(baseInput());
    await new Promise(r => setTimeout(r, 15));
    const updated = saveAgent({ id: created.id, name: "Renamed" });

    expect(updated.createdAt).toBe(created.createdAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(created.updatedAt).getTime());
  });

  it("update cannot override store-owned createdAt/updatedAt", () => {
    const created = saveAgent(baseInput());
    const updated = saveAgent({ id: created.id, createdAt: "1999-01-01T00:00:00.000Z", updatedAt: "1999-01-01T00:00:00.000Z" });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date("2000-01-01").getTime());
  });
});

describe("agent-store — 2. defaults", () => {
  beforeEach(() => {
    for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
  });

  it("fills all defaults on minimal create", () => {
    const a = saveAgent(baseInput());
    expect(a.description).toBe("");
    expect(a.context).toBe("");
    expect(a.prompt).toBe("");
    expect(a.agentRules).toEqual({ guardrails: [], redirectRules: [], refuseTopics: [] });
    expect(a.allowedTools).toEqual([]);
    expect(a.schedule).toBeNull();
    expect(a.cooldownMinutes).toBe(30);
    expect(a.notifyPolicy).toBe("always");
    expect(a.enabled).toBe(true);
  });

  it("persists a valid notifyPolicy (TASK-010)", () => {
    const a = saveAgent(baseInput({ notifyPolicy: "on-signal" }));
    expect(a.notifyPolicy).toBe("on-signal");
    expect(getAgent(a.id).notifyPolicy).toBe("on-signal");
    // update path preserves it too
    const updated = saveAgent({ id: a.id, name: "renamed" });
    expect(updated.notifyPolicy).toBe("on-signal");
  });

  it("normalizes partial agentRules without dropping stored keys on update", () => {
    const created = saveAgent(
      baseInput({ agentRules: { guardrails: ["g1"], redirectRules: ["r1"], refuseTopics: ["f1"] } })
    );
    const updated = saveAgent({ id: created.id, agentRules: { refuseTopics: ["f2"] } });
    expect(updated.agentRules).toEqual({ guardrails: ["g1"], redirectRules: ["r1"], refuseTopics: ["f2"] });
  });
});

describe("agent-store — 3. schema validation throws", () => {
  it("notifyPolicy: non-enum value is rejected (TASK-010)", () => {
    expect(() => saveAgent(baseInput({ notifyPolicy: "sometimes" }))).toThrow(/notifyPolicy/);
    expect(() => saveAgent(baseInput({ notifyPolicy: 1 }))).toThrow(/notifyPolicy/);
  });

  it("name: empty / whitespace / non-string / >100 chars", () => {
    expect(() => saveAgent(baseInput({ name: "" }))).toThrow(/name/);
    expect(() => saveAgent(baseInput({ name: "   " }))).toThrow(/name/);
    expect(() => saveAgent(baseInput({ name: null }))).toThrow(/name/);
    expect(() => saveAgent(baseInput({ name: 42 }))).toThrow(/name/);
    expect(() => saveAgent(baseInput({ name: "x".repeat(101) }))).toThrow(/name/);
  });

  it("notifyTarget: missing / bad targetType / empty targetId", () => {
    expect(() => saveAgent({ name: "X" })).toThrow(/notifyTarget/);    expect(() => saveAgent(baseInput({ notifyTarget: { targetType: "group", targetId: "1" } }))).toThrow(/targetType/);
    expect(() => saveAgent(baseInput({ notifyTarget: { targetType: "user", targetId: "" } }))).toThrow(/targetId/);
    expect(() => saveAgent(baseInput({ notifyTarget: { targetType: "user" } }))).toThrow(/targetId/);
  });

  it.each([0, -5, 1.5, "30", NaN, Infinity])("cooldownMinutes %p throws", (v) => {
    expect(() => saveAgent(baseInput({ cooldownMinutes: v }))).toThrow(/cooldownMinutes/);
  });

  it.each([
    "61 * * * *", // minute out of range
    "* 24 * * *", // hour out of range
    "* * 0 * *", // day-of-month 0
    "* * * 13 *", // month 13
    "* * * * 8", // dow 8
    "*/0 * * * *", // zero step
    "*-5 * * * *", // range on wildcard
    "5-1 * * * *", // inverted range
    "not-a-cron", // garbage
    "* * * *", // 4 fields
    "* * * * * *", // 6 fields (Quartz)
    "0 9 * * MON", // named values unsupported
    "", // empty
  ])("invalid cron %j throws", (expr) => {
    expect(() => saveAgent(baseInput({ schedule: expr }))).toThrow(/schedule/);
  });

  it.each([
    "*/15 * * * *",
    "0 9 * * 1-5",
    "30 4 1,15 * 0", // lists
    "5 4 * * sun", // → invalid: named values unsupported (numeric-only validator)
  ])("cron %j — numeric-only validator verdict", (expr) => {
    // Numeric-only: named values must throw. The first three are numeric and valid.
    if (expr.includes("sun")) {
      expect(() => saveAgent(baseInput({ schedule: expr }))).toThrow(/schedule/);
    } else {
      expect(() => saveAgent(baseInput({ schedule: expr }))).not.toThrow();
    }
  });

  it("allowedTools must be string[]", () => {
    expect(() => saveAgent(baseInput({ allowedTools: "grafana_query" }))).toThrow(/allowedTools/);
    expect(() => saveAgent(baseInput({ allowedTools: [42] }))).toThrow(/allowedTools/);
  });

  it("enabled must be boolean", () => {
    expect(() => saveAgent(baseInput({ enabled: "yes" }))).toThrow(/enabled/);
  });

  it("update of non-existent id throws 404-flavored error", () => {
    expect(() => saveAgent({ id: "no-such-agent-000", name: "X", notifyTarget: VALID_TARGET })).toThrow(
      /not found/i
    );
  });
});

describe("agent-store — 4. path traversal guard (getAgent/deleteAgent)", () => {
  const badIds = ["..", "../../etc/passwd", "/etc/passwd", "%2e%2e", "..%2fetc", "", "a/b", "a\\b", ".", "a.json"];

  it.each(badIds)("getAgent(%j) throws", (id) => {
    expect(() => getAgent(id)).toThrow(/Invalid agent id/);
  });

  it.each(badIds)("deleteAgent(%j) throws", (id) => {
    expect(() => deleteAgent(id)).toThrow(/Invalid agent id/);
  });

  it("non-string ids throw", () => {
    for (const id of [null, undefined, 123, {}, ["a"]]) {
      expect(() => getAgent(id)).toThrow();
      expect(() => deleteAgent(id)).toThrow();
    }
  });

  it("unknown tool in allowedTools warns but still saves (registry empty in tests)", () => {
    const a = saveAgent(baseInput({ allowedTools: ["definitely_not_registered"] }));
    expect(a.allowedTools).toEqual(["definitely_not_registered"]);
  });
});

describe("agent-store — 5. atomic write", () => {
  beforeEach(() => {
    for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
  });

  it("saveAgent leaves no .tmp file behind and final file parses", () => {
    const a = saveAgent(baseInput({ name: "Atomic" }));
    const files = readdirSync(TMP_DIR);
    expect(files).toEqual([`${a.id}.json`]);
    expect(() => JSON.parse(readFileSync(rawFile(a.id), "utf-8"))).not.toThrow();
  });

  it("stray .tmp files are ignored by listAgents", () => {
    const a = saveAgent(baseInput({ name: "Kept" }));
    writeFileSync(join(TMP_DIR, `${a.id}.json.tmp`), "{ half-written");
    const listed = listAgents();
    expect(listed.map(x => x.id)).toEqual([a.id]);
  });
});

describe("agent-store — 6. dirty data tolerance (asymmetric reads)", () => {
  beforeEach(() => {
    for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
  });

  it("listAgents skips corrupt JSON without throwing", () => {
    const good = saveAgent(baseInput({ name: "Good" }));
    writeFileSync(join(TMP_DIR, "bad-agent-id.json"), "{ not json");
    const listed = listAgents();
    expect(listed.map(x => x.id)).toEqual([good.id]);
  });

  it("getAgent throws on corrupt JSON for that specific id", () => {
    writeFileSync(join(TMP_DIR, "bad-agent-id.json"), "{ not json");
    expect(() => getAgent("bad-agent-id")).toThrow();
  });

  it("non-agent files (README.md, dotfiles) are ignored", () => {
    saveAgent(baseInput());
    writeFileSync(join(TMP_DIR, "README.md"), "# agents");
    writeFileSync(join(TMP_DIR, ".hidden.json"), "{}");
    expect(listAgents().length).toBe(1);
  });
});

describe("agent-store — 7. delete semantics", () => {
  it("deleteAgent of missing id returns false, getAgent returns null — no throw", () => {
    expect(deleteAgent("never-created-id")).toBe(false);
    expect(getAgent("never-created-id")).toBeNull();
  });
});

describe("agent-store — 8. update does not create new files / orphans", () => {
  beforeEach(() => {
    for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
  });

  it("update writes the same file, no extra files appear", () => {
    const created = saveAgent(baseInput({ name: "V1" }));
    const filesBefore = readdirSync(TMP_DIR).sort();
    const updated = saveAgent({ id: created.id, name: "V2", description: "changed" });

    expect(updated.id).toBe(created.id);
    expect(readdirSync(TMP_DIR).sort()).toEqual(filesBefore);
    expect(existsSync(rawFile(created.id))).toBe(true);
    expect(getAgent(created.id).name).toBe("V2");
    expect(getAgent(created.id).description).toBe("changed");
  });
});

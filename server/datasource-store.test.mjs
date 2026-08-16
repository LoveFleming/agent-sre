/**
 * datasource-store.test.mjs — tests for server/datasource-store.mjs (TASK-011)
 *
 * Isolation: SRE_DATASOURCES_DIR + PAAW_ROOT/SRE_ROOT env vars point the
 * store at fresh temp dirs before dynamic import (datasources/ and
 * tools/<name>/config.json hold plaintext tokens and must never be touched
 * by tests).
 *
 * Covers:
 *   - CRUD round-trip + list ordering
 *   - Schema validation: bad id (unsafe chars / traversal / too long),
 *     invalid url (non-URL, wrong protocol), invalid token/settings types
 *   - Token mask semantics on update: "***", "", missing all keep the
 *     stored value; a new string rotates it
 *   - Tool config hot-sync: tools/<id>/config.json gets the mapped shape
 *     (grafana → grafana_url/grafana_token; default → url/token)
 *   - Atomic write: no *.json.tmp residue
 *   - Secrets never leak into console.warn output (skipped-corrupt-file path)
 */

import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Isolation setup (must precede the dynamic import) ──
const TMP_DIR = mkdtempSync(join(tmpdir(), "datasource-store-test-"));
process.env.SRE_DATASOURCES_DIR = TMP_DIR;
// Root that tool-config sync resolves against (mirrors grafana handler).
const TOOL_ROOT = mkdtempSync(join(tmpdir(), "datasource-tools-test-"));
process.env.PAAW_ROOT = TOOL_ROOT;
delete process.env.SRE_ROOT;

const { listDatasources, getDatasource, saveDatasource, deleteDatasource, TOKEN_MASK } =
  await import("./datasource-store.mjs");

/** Minimal valid create payload. */
function baseInput(overrides = {}) {
  return { id: "grafana", url: "http://grafana.local:3000", token: "secret-1", ...overrides };
}

function dsFile(id) {
  return join(TMP_DIR, `${id}.json`);
}

function toolConfig(id) {
  return JSON.parse(readFileSync(join(TOOL_ROOT, "tools", id, "config.json"), "utf-8"));
}

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  rmSync(TOOL_ROOT, { recursive: true, force: true });
  delete process.env.PAAW_ROOT;
});

describe("datasource-store — 1. CRUD round-trip + list ordering", () => {
  beforeEach(() => {
    for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
    // Fresh tool dirs so hot-sync cases can't see each other's files.
    rmSync(join(TOOL_ROOT, "tools"), { recursive: true, force: true });
  });

  it("create → get → update → delete round-trip returns stored data", () => {
    const created = saveDatasource(baseInput());
    expect(created.id).toBe("grafana");
    expect(created.url).toBe("http://grafana.local:3000");
    expect(created.token).toBe("secret-1"); // internal API keeps plaintext
    expect(created.createdAt).toBeTypeOf("string");

    const fetched = getDatasource("grafana");
    expect(fetched.url).toBe("http://grafana.local:3000");
    expect(fetched.token).toBe("secret-1");

    const updated = saveDatasource({ id: "grafana", url: "http://grafana2.local:3000" });
    expect(updated.url).toBe("http://grafana2.local:3000");
    expect(updated.token).toBe("secret-1"); // partial patch keeps token
    expect(updated.createdAt).toBe(fetched.createdAt); // createdAt preserved

    expect(deleteDatasource("grafana")).toBe(true);
    expect(getDatasource("grafana")).toBeNull();
    expect(deleteDatasource("grafana")).toBe(false); // second delete → false
  });

  it("list sorts by createdAt (oldest first)", async () => {
    saveDatasource(baseInput({ id: "b-source" }));
    await new Promise((r) => setTimeout(r, 20));
    saveDatasource(baseInput({ id: "a-source" }));
    const ids = listDatasources().map((ds) => ds.id);
    expect(ids).toEqual(["b-source", "a-source"]);
  });

  it("atomic write leaves no *.json.tmp residue", () => {
    saveDatasource(baseInput());
    const residue = readdirSync(TMP_DIR).filter((f) => f.endsWith(".tmp"));
    expect(residue).toEqual([]);
  });
});

describe("datasource-store — 2. Schema validation", () => {
  beforeEach(() => {
    for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
  });

  it("rejects missing/invalid id (incl. traversal shapes)", () => {
    expect(() => saveDatasource({ url: "http://x.local" })).toThrow(/Invalid datasource id/);
    expect(() => saveDatasource({ id: "../evil", url: "http://x.local" })).toThrow(/Invalid datasource id/);
    expect(() => saveDatasource({ id: "a/b", url: "http://x.local" })).toThrow(/Invalid datasource id/);
    expect(() => saveDatasource({ id: "a.b", url: "http://x.local" })).toThrow(/Invalid datasource id/);
    expect(() => saveDatasource({ id: "", url: "http://x.local" })).toThrow(/Invalid datasource id/);
    expect(() => saveDatasource({ id: "x".repeat(65), url: "http://x.local" })).toThrow(/Invalid datasource id/);
    // get/delete share the same guard
    expect(() => getDatasource("../etc/passwd")).toThrow(/Invalid datasource id/);
    expect(() => deleteDatasource("..%2f")).toThrow(/Invalid datasource id/);
  });

  it("rejects invalid urls (empty / non-URL / wrong protocol)", () => {
    expect(() => saveDatasource({ id: "ok", url: "" })).toThrow(/url/);
    expect(() => saveDatasource({ id: "ok", url: "not-a-url" })).toThrow(/url/);
    expect(() => saveDatasource({ id: "ok", url: "ftp://x.local" })).toThrow(/protocol/);
  });

  it("accepts both http and https urls", () => {
    expect(saveDatasource({ id: "h1", url: "http://x.local:3000" }).url).toBe("http://x.local:3000");
    expect(saveDatasource({ id: "h2", url: "https://x.local" }).url).toBe("https://x.local");
  });

  it("rejects invalid token / settings types", () => {
    expect(() => saveDatasource({ id: "ok", url: "http://x.local", token: 123 })).toThrow(/token/);
    expect(() => saveDatasource({ id: "ok", url: "http://x.local", token: { nested: true } })).toThrow(/token/);
    expect(() => saveDatasource({ id: "ok", url: "http://x.local", settings: "flat" })).toThrow(/settings/);
    expect(() => saveDatasource({ id: "ok", url: "http://x.local", settings: [1, 2] })).toThrow(/settings/);
    // valid settings: scalars + nested plain objects
    expect(() =>
      saveDatasource({ id: "ok", url: "http://x.local", settings: { orgId: 1, nested: { a: true } } })
    ).not.toThrow();
  });

  it("skips corrupt files in list (registry survives) but getDatasource throws", () => {
    writeFileSync(dsFile("corrupt"), "{ not json");
    expect(listDatasources()).toEqual([]);
    expect(() => getDatasource("corrupt")).toThrow();
  });

  it("console.warn on corrupt file never includes file contents", () => {
    const warned = vi.fn();
    const orig = console.warn;
    console.warn = warned;
    try {
      writeFileSync(dsFile("corrupt2"), JSON.stringify({ secretish: "leak-me" }) + "&&&");
      listDatasources();
    } finally {
      console.warn = orig;
    }
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned.mock.calls[0].join(" ")).not.toContain("leak-me");
  });
});

describe("datasource-store — 3. Token mask semantics on update", () => {
  beforeEach(() => {
    for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
    saveDatasource(baseInput({ token: "original-secret" }));
  });

  it(`token = "${TOKEN_MASK}" keeps the stored value`, () => {
    const updated = saveDatasource({ id: "grafana", url: "http://new.local:3000", token: TOKEN_MASK });
    expect(updated.token).toBe("original-secret");
  });

  it("token = \"\" keeps the stored value", () => {
    const updated = saveDatasource({ id: "grafana", url: "http://new.local:3000", token: "" });
    expect(updated.token).toBe("original-secret");
  });

  it("token missing keeps the stored value", () => {
    const updated = saveDatasource({ id: "grafana", url: "http://new.local:3000" });
    expect(updated.token).toBe("original-secret");
  });

  it("a new non-mask string rotates the token", () => {
    const updated = saveDatasource({ id: "grafana", url: "http://new.local:3000", token: "rotated-secret" });
    expect(updated.token).toBe("rotated-secret");
    expect(getDatasource("grafana").token).toBe("rotated-secret");
  });

  it(`create with token = "${TOKEN_MASK}" stores empty (masked echo can't become a secret)`, () => {
    const created = saveDatasource({ id: "fresh", url: "http://fresh.local", token: TOKEN_MASK });
    expect(created.token).toBeUndefined();
  });
});

describe("datasource-store — 4. Tool config hot-sync", () => {
  beforeEach(() => {
    for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
    rmSync(join(TOOL_ROOT, "tools"), { recursive: true, force: true });
  });

  it("grafana datasource maps to { grafana_url, grafana_token } in tools/grafana/config.json", () => {
    mkdirSync(join(TOOL_ROOT, "tools", "grafana"), { recursive: true });
    saveDatasource({ id: "grafana", url: "http://grafana.local:3000", token: "gsk-abc" });
    expect(toolConfig("grafana")).toEqual({
      grafana_url: "http://grafana.local:3000",
      grafana_token: "gsk-abc",
    });
  });

  it("default mapper writes { url, token } for non-grafana providers (prometheus-style)", () => {
    mkdirSync(join(TOOL_ROOT, "tools", "prometheus"), { recursive: true });
    saveDatasource({ id: "prometheus", url: "http://prom.local:9090", token: "prom-tok" });
    expect(toolConfig("prometheus")).toEqual({
      url: "http://prom.local:9090",
      token: "prom-tok",
    });
  });

  it("mask-echo update keeps the real token in the synced config", () => {
    mkdirSync(join(TOOL_ROOT, "tools", "grafana"), { recursive: true });
    saveDatasource({ id: "grafana", url: "http://g.local", token: "real-tok" });
    saveDatasource({ id: "grafana", url: "http://g2.local", token: TOKEN_MASK });
    expect(toolConfig("grafana")).toEqual({
      grafana_url: "http://g2.local",
      grafana_token: "real-tok", // NOT ***
    });
  });

  it("tokenless datasource writes config without a token key", () => {
    mkdirSync(join(TOOL_ROOT, "tools", "prometheus"), { recursive: true });
    saveDatasource({ id: "prometheus", url: "http://prom.local:9090" });
    expect(toolConfig("prometheus")).toEqual({ url: "http://prom.local:9090" });
  });

  it("no tools/<id>/ dir → sync silently skipped, datasource still saved", () => {
    expect(() => saveDatasource({ id: "ghost", url: "http://ghost.local" })).not.toThrow();
    expect(getDatasource("ghost")).not.toBeNull();
    expect(existsSync(join(TOOL_ROOT, "tools", "ghost"))).toBe(false);
  });

  it("settings are merged into the synced config", () => {
    mkdirSync(join(TOOL_ROOT, "tools", "grafana"), { recursive: true });
    saveDatasource({
      id: "grafana",
      url: "http://g.local",
      token: "t",
      settings: { default_org_id: 2 },
    });
    expect(toolConfig("grafana")).toEqual({
      grafana_url: "http://g.local",
      grafana_token: "t",
      default_org_id: 2,
    });
  });

  it("delete removes the synced tool config too", () => {
    mkdirSync(join(TOOL_ROOT, "tools", "grafana"), { recursive: true });
    saveDatasource({ id: "grafana", url: "http://g.local", token: "t" });
    const cfgPath = join(TOOL_ROOT, "tools", "grafana", "config.json");
    expect(existsSync(cfgPath)).toBe(true);
    deleteDatasource("grafana");
    expect(existsSync(cfgPath)).toBe(false);
  });
});

/**
 * routes.test.mjs — Regression tests for:
 *   1. Path traversal protection in static file serving (TASK-005/006/007).
 *   2. /api/agents CRUD endpoints + /api/tasks deprecation flags (TASK-002).
 *
 * Covers:
 *   - Normal path `/` serves the UI (index.html) with HTTP 200.
 *   - Traversal paths (`/../`, `/%2e%2e/`, `/..%2f`) return HTTP 404 instead
 *     of leaking files outside ui-dist (they must NOT return file contents).
 *   - `safeResolve` unit-level guard: traversal is rejected with a throw.
 *   - /api/agents: list / create / get / update / delete round-trip,
 *     400 on missing required fields (name, prompt) and invalid ids,
 *     404 on unknown ids, scheduler notifier hook fired on mutations.
 *   - /api/tasks endpoints still work but carry "deprecated": true.
 *
 * Spins up a real http.Server via registerRoutes to exercise the HTTP wiring.
 *
 * Isolation: SRE_AGENTS_DIR env var is set BEFORE the dynamic import of
 * routes.mjs — agent-store.mjs resolves its directory at module-load time
 * (same trick as agent-store.test.mjs; agents/ is version-controlled
 * config-as-code and must never be polluted by tests).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, request as httpRequest } from "http";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { mkdtempSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const UI_DIR = resolve(ROOT, "ui-dist");

// Must precede the routes.mjs import (see file header).
const AGENTS_TMP = mkdtempSync(join(tmpdir(), "routes-agents-test-"));
process.env.SRE_AGENTS_DIR = AGENTS_TMP;

const { registerRoutes, setSchedulerNotifier } = await import("./routes.mjs");
const { safeResolve } = await import("./tool-loader.mjs");

let server;

/** Perform an HTTP request against the running test server; JSON body in/out. */
function httpJson(method, pathname, body) {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = payload
      ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
      : {};
    const req = httpRequest(
      { host: "127.0.0.1", port: server.address().port, path: pathname, method, headers },
      (res) => {
        let data = "";
        res.setEncoding("utf-8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { parsed = null; }
          resolvePromise({ status: res.statusCode, body: parsed, text: data });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Shorthand GET (used by the static-serving cases that assert on raw text). */
function httpGet(pathname) {
  return httpJson("GET", pathname);
}

describe("routes.mjs — static serving & path traversal guard", () => {
  beforeAll(async () => {
    server = createServer();
    registerRoutes(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
  });

  afterAll(() => {
    if (server) server.close();
  });

  // ---------------------------------------------------------------
  // 正常路徑
  // ---------------------------------------------------------------
  describe("正常路徑", () => {
    it("GET / 回傳 200 且含 UI title", async () => {
      const res = await httpGet("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("<!DOCTYPE html>");
      expect(res.text).toContain("Agent SRE Console");
    });

    it("GET /index.html 回傳 200 且含 UI title", async () => {
      const res = await httpGet("/index.html");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Agent SRE Console");
    });
  });

  // ---------------------------------------------------------------
  // 路徑穿越 → 應回傳 404，不得洩漏檔內容
  // ---------------------------------------------------------------
  describe("路徑穿越 (traversal) 應被擋 → 404", () => {
    it.each([
      "/../secret",
      "/../etc/passwd",
      "/..%2f..%2fetc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/..%5c..%5cwindows/win.ini",
      "/assets/../../etc/passwd",
    ])("GET %s → 404 且不洩漏 /etc/passwd 內容", async (p) => {
      const res = await httpGet(p);
      expect(res.status).toBe(404);
      expect(res.text).not.toMatch(/root:.*:\/bin/); // 不洩漏 passwd 內容
    });
  });

  // ---------------------------------------------------------------
  // safeResolve 單元層級的穿越防護
  // ---------------------------------------------------------------
  describe("safeResolve — 單元層級 traversal guard", () => {
    it.each([
      ["..", "../"],
      ["../../etc", "../../etc"],
      ["../../../../etc/passwd", "../../../../etc/passwd"],
      ["a/../../etc/passwd", "a/../../etc/passwd"],
      ["../ui-dist/../etc", "../ui-dist/../etc"],
    ])("safeResolve(UI_DIR, %j) 應 throw", (_label, child) => {
      expect(() => safeResolve(UI_DIR, child)).toThrow();
    });

    it("正常子路徑回傳結果停在 UI_DIR 內", () => {
      const ok = safeResolve(UI_DIR, "index.html");
      expect(ok).toBe(resolve(UI_DIR, "index.html"));
      expect(ok.startsWith(UI_DIR)).toBe(true);
    });
  });
});

describe("routes.mjs — /api/agents CRUD (TASK-002)", () => {
  beforeAll(async () => {
    server = createServer();
    registerRoutes(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
  });

  afterAll(() => {
    if (server) server.close();
    rmSync(AGENTS_TMP, { recursive: true, force: true });
    setSchedulerNotifier(null); // 還原 hook，避免外溢到其他測試檔
  });

  beforeEach(() => {
    // 每個 case 從乾淨的 registry 開始
    for (const f of readdirSync(AGENTS_TMP)) rmSync(join(AGENTS_TMP, f), { force: true });
    setSchedulerNotifier(null);
  });

  /** Minimal valid agent payload (name + prompt are the route-required pair;
   *  notifyTarget is store-required, so it is always present here). */
  function validAgent(overrides = {}) {
    return {
      name: "CPU Watchdog",
      prompt: "You watch CPU metrics and alert on saturation.",
      notifyTarget: { targetType: "user", targetId: "u-ops" },
      ...overrides,
    };
  }

  // ---------------------------------------------------------------
  // 建立列表讀取
  // ---------------------------------------------------------------
  describe("GET / POST — 列表與建立", () => {
    it("POST /api/agents 建立成功 → 201，id 由 server 產生（UUID）", async () => {
      const res = await httpJson("POST", "/api/agents", validAgent());
      expect(res.status).toBe(201);
      expect(res.body.agent.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.agent.name).toBe("CPU Watchdog");
      expect(res.body.agent.prompt).toContain("CPU metrics");
    });

    it("POST /api/agents 缺 name → 400 + { error }", async () => {
      const res = await httpJson("POST", "/api/agents", validAgent({ name: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Missing required field: name");
    });

    it("POST /api/agents 缺 prompt → 400 + { error }", async () => {
      const res = await httpJson("POST", "/api/agents", validAgent({ prompt: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Missing required field: prompt");
    });

    it("POST /api/agents body 非物件 → 400", async () => {
      const res = await httpJson("POST", "/api/agents", [1, 2, 3]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("JSON object");
    });

    it("GET /api/agents 回傳完整列表（含新建的 agent）", async () => {
      const created = await httpJson("POST", "/api/agents", validAgent());
      await httpJson("POST", "/api/agents", validAgent({ name: "Disk Watchdog" }));

      const res = await httpJson("GET", "/api/agents");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.agents)).toBe(true);
      expect(res.body.agents).toHaveLength(2);
      expect(res.body.agents.some(a => a.id === created.body.agent.id)).toBe(true);
    });

    it("GET /api/agents/:id 回傳單一 agent", async () => {
      const created = await httpJson("POST", "/api/agents", validAgent());
      const id = created.body.agent.id;

      const res = await httpJson("GET", `/api/agents/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.agent.id).toBe(id);
      expect(res.body.agent.name).toBe("CPU Watchdog");
    });

    it("GET /api/agents/:id 不存在 → 404", async () => {
      const res = await httpJson("GET", "/api/agents/00000000-0000-4000-8000-000000000000");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Agent not found");
    });
  });

  // ---------------------------------------------------------------
  // 更新
  // ---------------------------------------------------------------
  describe("PUT — 更新", () => {
    it("PUT /api/agents/:id 更新成功 → 200，name/prompt 反映變更", async () => {
      const created = await httpJson("POST", "/api/agents", validAgent());
      const id = created.body.agent.id;

      const res = await httpJson("PUT", `/api/agents/${id}`, {
        name: "CPU Watchdog v2",
        prompt: "Updated prompt.",
      });
      expect(res.status).toBe(200);
      expect(res.body.agent.id).toBe(id);
      expect(res.body.agent.name).toBe("CPU Watchdog v2");
      expect(res.body.agent.prompt).toBe("Updated prompt.");
    });

    it("PUT /api/agents/:id 不存在 → 404", async () => {
      const res = await httpJson("PUT", "/api/agents/00000000-0000-4000-8000-000000000000", validAgent());
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Agent not found");
    });

    it("PUT /api/agents/:id 缺 name → 400（即使 id 存在）", async () => {
      const created = await httpJson("POST", "/api/agents", validAgent());
      const res = await httpJson("PUT", `/api/agents/${created.body.agent.id}`, {
        prompt: "no name here",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Missing required field: name");
    });

    it("PUT /api/agents/:id 缺 prompt → 400（即使 id 存在）", async () => {
      const created = await httpJson("POST", "/api/agents", validAgent());
      const res = await httpJson("PUT", `/api/agents/${created.body.agent.id}`, {
        name: "name only",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Missing required field: prompt");
    });

    it("PUT /api/agents/:id schema 違規（cooldownMinutes 非數字）→ 400", async () => {
      const created = await httpJson("POST", "/api/agents", validAgent());
      const res = await httpJson("PUT", `/api/agents/${created.body.agent.id}`, {
        ...validAgent(),
        cooldownMinutes: "soon",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("cooldownMinutes");
    });
  });

  // ---------------------------------------------------------------
  // 刪除
  // ---------------------------------------------------------------
  describe("DELETE — 刪除", () => {
    it("DELETE /api/agents/:id 刪除成功 → 200，之後 GET 變 404", async () => {
      const created = await httpJson("POST", "/api/agents", validAgent());
      const id = created.body.agent.id;

      const del = await httpJson("DELETE", `/api/agents/${id}`);
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);
      expect(del.body.id).toBe(id);

      const after = await httpJson("GET", `/api/agents/${id}`);
      expect(after.status).toBe(404);
    });

    it("DELETE /api/agents/:id 不存在 → 404", async () => {
      const res = await httpJson("DELETE", "/api/agents/00000000-0000-4000-8000-000000000000");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Agent not found");
    });
  });

  // ---------------------------------------------------------------
  // 無效 id（含 traversal 樣式）→ 400，不得洩漏檔案
  // ---------------------------------------------------------------
  describe("無效 id 防護", () => {
    it.each(["..", "../../etc/passwd", "a%2f..%2fb", "bad.id", "空 格"])(
      "GET /api/agents/%s → 400 + { error }",
      async (badId) => {
        const res = await httpJson("GET", `/api/agents/${encodeURIComponent(badId)}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain("Invalid agent id");
      }
    );
  });

  // ---------------------------------------------------------------
  // scheduler notifier hook（ADR-003 介面預留）
  // ---------------------------------------------------------------
  describe("scheduler notifier hook", () => {
    it("create / update / delete 各觸發一次對應事件", async () => {
      const events = [];
      setSchedulerNotifier((e) => events.push(e));

      const created = await httpJson("POST", "/api/agents", validAgent());
      const id = created.body.agent.id;
      await httpJson("PUT", `/api/agents/${id}`, validAgent({ name: "v2" }));
      await httpJson("DELETE", `/api/agents/${id}`);

      expect(events.map(e => e.type)).toEqual(["created", "updated", "deleted"]);
      expect(events[0].agent.id).toBe(id);
      expect(events[2].agent).toEqual({ id });
    });

    it("notifier throw 時不影響 HTTP 回應（仍 201）", async () => {
      setSchedulerNotifier(() => { throw new Error("scheduler boom"); });
      const res = await httpJson("POST", "/api/agents", validAgent());
      expect(res.status).toBe(201);
    });

    it("未註冊 notifier 時 CRUD 照常運作", async () => {
      const res = await httpJson("POST", "/api/agents", validAgent());
      expect(res.status).toBe(201);
    });
  });
});

describe("routes.mjs — /api/tasks deprecated 標記 (TASK-002)", () => {
  beforeAll(async () => {
    server = createServer();
    registerRoutes(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
  });

  afterAll(() => {
    if (server) server.close();
  });

  it("GET /api/tasks 仍可用但帶 deprecated: true", async () => {
    const res = await httpJson("GET", "/api/tasks");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.deprecated).toBe(true);
  });

  it("POST /api/tasks 建立成功但帶 deprecated: true", async () => {
    const res = await httpJson("POST", "/api/tasks", { name: "legacy task" });
    expect(res.status).toBe(201);
    expect(res.body.task.name).toBe("legacy task");
    expect(res.body.deprecated).toBe(true);
  });

  it("GET /api/tasks/:id 帶 deprecated: true", async () => {
    const created = await httpJson("POST", "/api/tasks", { name: "legacy task" });
    const id = created.body.task.id;

    const res = await httpJson("GET", `/api/tasks/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.deprecated).toBe(true);
  });

  it("PUT /api/tasks/:id 帶 deprecated: true", async () => {
    const created = await httpJson("POST", "/api/tasks", { name: "legacy task" });
    const id = created.body.task.id;

    const res = await httpJson("PUT", `/api/tasks/${id}`, { name: "renamed" });
    expect(res.status).toBe(200);
    expect(res.body.task.name).toBe("renamed");
    expect(res.body.deprecated).toBe(true);
  });

  it("DELETE /api/tasks/:id 帶 deprecated: true", async () => {
    const created = await httpJson("POST", "/api/tasks", { name: "legacy task" });
    const id = created.body.task.id;

    const res = await httpJson("DELETE", `/api/tasks/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deprecated).toBe(true);
  });
});

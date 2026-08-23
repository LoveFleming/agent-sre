/**
 * routes.test.mjs — Regression tests for the monitoring-only HTTP shell:
 *   1. Path traversal protection in static file serving.
 *   2. X-API-Token auth on /api/* (TASK-015).
 *   3. /api/health + monitor delegation sanity.
 *
 * Spins up a real http.Server via registerRoutes to exercise the HTTP wiring.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, request as httpRequest } from "http";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// TASK-015: enable auth for the whole suite. Dedicated 401/dev-mode cases
// live in their own describe block that flips env + cached value.
const TOKEN = "test-secret-token-015";
process.env.AGENT_SRE_API_TOKEN = TOKEN;

const { registerRoutes, resetApiTokenCacheForTests } = await import("./routes.mjs");
const { safeResolve } = await import("./tool-loader.mjs");

let server;

/** Perform an HTTP request against the running test server; JSON body in/out.
 *  Always sends X-API-Token (TASK-015); pass opts.token = null to omit,
 *  or opts.token = "<wrong>" to send a bad one. */
function httpJson(method, pathname, body, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = payload
      ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
      : {};
    if (opts.token === null) {
      // deliberately no X-API-Token header
    } else if (opts.token !== undefined) {
      headers["X-API-Token"] = opts.token;
    } else {
      headers["X-API-Token"] = TOKEN;
    }
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

  describe("正常路徑", () => {
    it("GET / 回傳 200 且含 UI title", async () => {
      const res = await httpGet("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("<!DOCTYPE html>");
      expect(res.text).toContain("SRE Agentic Monitoring Workspace");
    });

    it("GET /index.html 回傳 200 且含 UI title", async () => {
      const res = await httpGet("/index.html");
      expect(res.status).toBe(200);
      expect(res.text).toContain("SRE Agentic Monitoring Workspace");
    });
  });

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
      expect(res.text).not.toMatch(/root:.*:\/bin/);
    });
  });

  describe("safeResolve — 單元層級 traversal guard", () => {
    it("正常相對路徑可解析", () => {
      expect(() => safeResolve(ROOT, "ui-dist/index.html")).not.toThrow();
    });

    it.each(["../secret", "..\\secret", "a/../../b"])(
      "safeResolve(%s) 應 throw",
      (rel) => {
        expect(() => safeResolve(ROOT, rel)).toThrow();
      }
    );
  });
});

describe("routes.mjs — X-API-Token auth (TASK-015)", () => {
  beforeAll(async () => {
    server = createServer();
    registerRoutes(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
  });

  afterAll(() => {
    if (server) server.close();
  });

  describe("401 — 缺 token / 錯 token", () => {
    it("無 X-API-Token → 401", async () => {
      const res = await httpJson("GET", "/api/monitors", undefined, { token: null });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("錯 token → 401", async () => {
      const res = await httpJson("GET", "/api/monitors", undefined, { token: "wrong-token-123" });
      expect(res.status).toBe(401);
    });

    it("同長度錯 token → 401（constant-time 分支）", async () => {
      const sameLen = TOKEN.split("").reverse().join("");
      const res = await httpJson("GET", "/api/monitors", undefined, { token: sameLen });
      expect(res.status).toBe(401);
    });

    it("正確 token → 200", async () => {
      const res = await httpJson("GET", "/api/monitors");
      expect(res.status).toBe(200);
      expect(res.body.monitors).toBeDefined();
    });
  });

  describe("豁免 — /api/health 與靜態檔案", () => {
    it("GET /api/health 不需要 token → 200", async () => {
      const res = await httpJson("GET", "/api/health", undefined, { token: null });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });

    it("GET / 靜態檔案不需要 token → 200（UI title 仍在）", async () => {
      const res = await httpGet("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("<title>");
    });
  });

  describe("dev mode — AGENT_SRE_API_TOKEN 未設定時放行", () => {
    beforeEach(() => {
      delete process.env.AGENT_SRE_API_TOKEN;
      resetApiTokenCacheForTests();
    });

    afterEach(() => {
      process.env.AGENT_SRE_API_TOKEN = TOKEN;
      resetApiTokenCacheForTests();
    });

    it("無 token 的請求在 dev mode 放行 → 200", async () => {
      const res = await httpJson("GET", "/api/monitors", undefined, { token: null });
      expect(res.status).toBe(200);
      expect(res.body.monitors).toBeDefined();
    });

    it("dev mode 帶錯 token 也放行（一致性：無 secret 即無可比對）", async () => {
      const res = await httpJson("GET", "/api/monitors", undefined, { token: "wrong" });
      expect(res.status).toBe(200);
    });
  });
});

describe("routes.mjs — 舊 crew/task 端點已移除", () => {
  beforeAll(async () => {
    server = createServer();
    registerRoutes(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
  });

  afterAll(() => {
    if (server) server.close();
  });

  it.each(["/api/crews", "/api/tools", "/api/agents", "/api/tasks", "/api/datasources", "/api/chat"])(
    "%s → 404（monitor workspace 是唯一介面）",
    async (p) => {
      const res = await httpJson("GET", p);
      expect(res.status).toBe(404);
    }
  );

  it("POST /api/chat → 404", async () => {
    const res = await httpJson("POST", "/api/chat", { crewId: "x", message: "y" });
    expect(res.status).toBe(404);
  });
});

/**
 * routes.test.mjs — Regression tests for path traversal protection in static
 * file serving and safeResolve integration (TASK-005/006/007).
 *
 * Covers:
 *   - Normal path `/` serves the UI (index.html) with HTTP 200.
 *   - Traversal paths (`/../`, `/%2e%2e/`, `/..%2f`) return HTTP 404 instead
 *     of leaking files outside ui-dist (they must NOT return file contents).
 *   - `safeResolve` unit-level guard: traversal is rejected with a throw.
 *
 * Spins up a real http.Server via registerRoutes to exercise the HTTP wiring.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, request as httpRequest } from "http";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { registerRoutes } from "./routes.mjs";
import { safeResolve } from "./tool-loader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const UI_DIR = resolve(ROOT, "ui-dist");

let server;

/** Perform an HTTP GET against the running test server. */
function httpGet(pathname) {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: server.address().port, path: pathname, method: "GET" },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolvePromise({ status: res.statusCode, text: body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
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
  describe("正常路徑應回傳 UI 內容", () => {
    it("GET / 回傳 200 且內容為 index.html", async () => {
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

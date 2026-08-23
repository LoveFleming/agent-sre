/**
 * routes.mjs — HTTP shell for the SRE Agentic Monitoring server
 *
 * The monitor workspace IS the app. This module only provides:
 *   - CORS + X-API-Token auth (gates every /api/* except /api/health)
 *   - GET /api/health
 *   - delegation to monitor routes (/api/monitors*, /api/monitor-meta)
 *   - static UI serving (ui-dist)
 */

import { toolRegistry } from "./tool-registry.mjs";
import { safeResolve } from "./tool-loader.mjs";
import { handleMonitorRoutes } from "./monitor-routes.mjs";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { timingSafeEqual } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const UI_DIR = resolve(ROOT, "ui-dist");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── API token auth (TASK-015) ─────────────────────────────────────────────
// All /api/* endpoints (except /api/health) require the X-API-Token header
// to match env AGENT_SRE_API_TOKEN. Comparison is constant-time
// (crypto.timingSafeEqual) so an attacker cannot leak the token via response
// latency. When the env var is unset we run in permissive dev mode and log a
// prominent warning at startup — the UI and static files never need a token.

/**
 * Shared-secret comparison in constant time.
 * Lengths are compared first (timingSafeEqual throws when they differ);
 * a manual length check keeps the common mismatch path constant-time too.
 */
function safeTokenEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf-8");
  const bufB = Buffer.from(String(b), "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

let expectedToken = process.env.AGENT_SRE_API_TOKEN || null;
let warnedNoToken = false;

/** Test hook: re-read env and re-arm the startup-style warning. */
export function resetApiTokenCacheForTests() {
  expectedToken = process.env.AGENT_SRE_API_TOKEN || null;
  warnedNoToken = false;
}

/**
 * Enforce X-API-Token on /api/* requests. Returns true when the request is
 * authorized (and the caller should continue), false when a 401 response has
 * already been sent.
 */
function checkApiToken(req, res) {
  const url = req.url || "/";
  const path = url.split("?")[0];
  if (!path.startsWith("/api/")) return true; // static files never need auth
  if (path === "/api/health") return true;    // health check stays public

  if (expectedToken) {
    const presented = req.headers["x-api-token"];
    if (typeof presented !== "string" || !safeTokenEqual(presented, expectedToken)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return false;
    }
  } else if (!warnedNoToken) {
    console.warn("⚠️  [auth] AGENT_SRE_API_TOKEN is not set — running in permissive dev mode.");
    console.warn("   All /api/* endpoints (except /api/health) are UNPROTECTED. Set the env var before exposing this server beyond localhost.");
    warnedNoToken = true;
  }
  return true;
}

/** Attach all routes to an http server. */
export function registerRoutes(server) {
  server.on("request", async (req, res) => {
    const method = req.method || "GET";
    const url = req.url || "/";
    const path = url.split("?")[0];

    // ── CORS ──
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Token");
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    try {
      // ── API token auth — gates every /api/* route below ──
      if (!checkApiToken(req, res)) return;

      // ── SRE Agentic Monitoring (/api/monitors*, /api/monitor-meta) ──
      if (path.startsWith("/api/monitor")) {
        const handled = await handleMonitorRoutes(req, res, json);
        if (handled) return;
      }

      // ── GET /api/health ──
      if (path === "/api/health" && method === "GET") {
        return json(res, 200, { status: "ok", uptime: process.uptime(), tools: toolRegistry.list() });
      }

      // ── Static UI files (non-API paths) ──
      if (!path.startsWith("/api/")) {
        const filePath = path === "/" ? "/index.html" : path;
        try {
          const fullPath = safeResolve(UI_DIR, filePath.replace(/^\/+/, ""));
          if (existsSync(fullPath)) {
            const ext = extname(fullPath);
            res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
            res.end(readFileSync(fullPath));
            return;
          }
        } catch {
          // traversal blocked → fall through to 404
        }
      }

      // ── 404 ──
      return json(res, 404, { error: "Not found", path });
    } catch (err) {
      console.error(`[route] ${method} ${path}: ${err.message}`);
      return json(res, 500, { error: err.message });
    }
  });
}

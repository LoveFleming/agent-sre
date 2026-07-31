/**
 * routes.mjs — HTTP route handlers for the SRE API server
 */

import { loadAllCrews, getCrew, listCrews } from "./crew-loader.mjs";
import { runAgentLoop, runAgentLoopStream } from "./agent-loop.mjs";
import { toolRegistry } from "./tool-registry.mjs";
import { loadConversation, saveConversation, archiveConversation, listArchives, loadArchive } from "./conversation.mjs";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const UI_DIR = resolve(ROOT, "ui");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

/** Read request body as JSON */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; if (data.length > 1024 * 1024) reject(new Error("Body too large")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Register all routes on a http.Server */
export function registerRoutes(server) {
  server.on("request", async (req, res) => {
    const url = req.url || "/";
    const path = url.split("?")[0];
    const method = req.method || "GET";

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    try {
      // ── GET /api/health ──
      if (path === "/api/health" && method === "GET") {
        return json(res, 200, { status: "ok", uptime: process.uptime(), tools: toolRegistry.list() });
      }

      // ── GET /api/crews ──
      if (path === "/api/crews" && method === "GET") {
        return json(res, 200, { crews: listCrews() });
      }

      // ── GET /api/crews/:id ──
      const crewMatch = path.match(/^\/api\/crews\/([^/]+)$/);
      if (crewMatch && method === "GET") {
        const crew = getCrew(decodeURIComponent(crewMatch[1]));
        if (!crew) return json(res, 404, { error: "Crew not found" });
        return json(res, 200, crew);
      }

      // ── GET /api/tools ──
      if (path === "/api/tools" && method === "GET") {
        const tools = toolRegistry.list().map(name => ({
          name,
          definition: toolRegistry.get(name).definition,
          source: toolRegistry.get(name).source,
        }));
        return json(res, 200, { tools });
      }

      // ── GET /api/conversations/:crewId ──
      const convMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
      if (convMatch && method === "GET") {
        const crewId = decodeURIComponent(convMatch[1]);
        return json(res, 200, { messages: loadConversation(crewId) });
      }

      // ── POST /api/conversations/:crewId ── (save)
      if (convMatch && method === "POST") {
        const crewId = decodeURIComponent(convMatch[1]);
        const body = await readBody(req);
        saveConversation(crewId, body.messages || []);
        return json(res, 200, { success: true });
      }

      // ── DELETE /api/conversations/:crewId ── (clear)
      if (convMatch && method === "DELETE") {
        const crewId = decodeURIComponent(convMatch[1]);
        saveConversation(crewId, []);
        return json(res, 200, { success: true });
      }

      // ── POST /api/conversations/:crewId/archive ──
      const archiveMatch = path.match(/^\/api\/conversations\/([^/]+)\/archive$/);
      if (archiveMatch && method === "POST") {
        const crewId = decodeURIComponent(archiveMatch[1]);
        const ts = archiveConversation(crewId);
        return json(res, 200, { success: true, sessionId: ts });
      }

      // ── GET /api/conversations/:crewId/archives ──
      const archivesMatch = path.match(/^\/api\/conversations\/([^/]+)\/archives$/);
      if (archivesMatch && method === "GET") {
        const crewId = decodeURIComponent(archivesMatch[1]);
        return json(res, 200, { sessions: listArchives(crewId) });
      }

      // ── POST /api/chat — chat with a crew member ──
      if (path === "/api/chat" && method === "POST") {
        const body = await readBody(req);
        const { crewId, message, stream, model } = body;

        if (!crewId || !message) {
          return json(res, 400, { error: "Missing crewId or message" });
        }

        const crew = getCrew(crewId);
        if (!crew) {
          return json(res, 404, { error: `Crew not found: ${crewId}` });
        }

        // Load conversation history
        const history = loadConversation(crewId);
        const onToolCall = ({ name, result }) => {
          console.log(`[agent] ${crewId} tool: ${name} → ${result?.slice(0, 100)}`);
        };

        if (stream) {
          await runAgentLoopStream({ crew, message, history, model, res, onToolCall });
          return;
        }

        const result = await runAgentLoop({ crew, message, history, model, onToolCall });

        // Save updated conversation
        saveConversation(crewId, result.history);

        return json(res, 200, {
          content: result.content,
          toolCallCount: result.toolCallCount || 0,
        });
      }

      // ── POST /api/tools/:name — directly execute a tool (for UI testing) ──
      const toolExecMatch = path.match(/^\/api\/tools\/([^/]+)$/);
      if (toolExecMatch && method === "POST") {
        const toolName = decodeURIComponent(toolExecMatch[1]);
        const body = await readBody(req);
        const entry = toolRegistry.get(toolName);
        if (!entry) return json(res, 404, { error: `Tool not found: ${toolName}` });
        try {
          const result = await entry.handler(body.arguments || {}, { toolName });
          return json(res, 200, result);
        } catch (err) {
          return json(res, 500, { error: err.message, text: `❌ ${err.message}` });
        }
      }

      // ── Static UI files (non-API paths) ──
      if (!path.startsWith("/api/")) {
        const filePath = path === "/" ? "/index.html" : path;
        const fullPath = resolve(UI_DIR, filePath.slice(1));
        if (fullPath.startsWith(UI_DIR) && existsSync(fullPath)) {
          const ext = extname(fullPath);
          res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
          res.end(readFileSync(fullPath));
          return;
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

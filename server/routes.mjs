/**
 * routes.mjs — HTTP route handlers for the SRE API server
 */

import { loadAllCrews, getCrew, listCrews } from "./crew-loader.mjs";
import { runAgentLoop, runAgentLoopStream } from "./agent-loop.mjs";
import { toolRegistry } from "./tool-registry.mjs";
import { safeResolve } from "./tool-loader.mjs";
import { loadConversation, saveConversation, archiveConversation, listArchives, loadArchive } from "./conversation.mjs";
import { taskStore } from "./task-store.mjs";
import { listAgents, getAgent, saveAgent, deleteAgent } from "./agent-store.mjs";
import { listRuns, getRun } from "./run-store.mjs";
import { listDatasources, getDatasource, saveDatasource, deleteDatasource, TOKEN_MASK } from "./datasource-store.mjs";
import { beginRun, executeScheduledRun } from "./scheduler.mjs";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { timingSafeEqual } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const UI_DIR = resolve(ROOT, "ui-dist");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

/**
 * Scheduler reschedule hook (ADR-003 / TASK-002 call-site placeholder).
 * The scheduler module does not exist yet; when it does, it registers a
 * callback here via setSchedulerNotifier() and gets told about every agent
 * create/update/delete so it can re-evaluate cron jobs.
 * @type {((event: {type: "created"|"updated"|"deleted", agent: object}) => void) | null}
 */
let schedulerNotifier = null;

/**
 * Register the scheduler callback. Call with null to unregister.
 * @param {((event: {type: "created"|"updated"|"deleted", agent: object}) => void) | null} fn
 */
export function setSchedulerNotifier(fn) {
  schedulerNotifier = typeof fn === "function" ? fn : null;
}

/** Fire the scheduler hook; never lets a scheduler error fail the HTTP request. */
function notifyScheduler(type, agent) {
  if (!schedulerNotifier) return;
  try {
    schedulerNotifier({ type, agent });
  } catch (err) {
    console.error(`[route] scheduler notifier failed for ${type} ${agent?.id}: ${err.message}`);
  }
}

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
 * @param {string} a — presented token (from the request header)
 * @param {string} b — expected token (from env)
 * @returns {boolean}
 */
function safeTokenEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf-8");
  const bufB = Buffer.from(String(b), "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Resolve the expected token from env. Exported for tests so they can flip
 * AGENT_SRE_API_TOKEN and reset the cached value between cases.
 * @returns {string | null} null when auth is disabled (dev mode)
 */
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
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @returns {boolean}
 */
function checkApiToken(req, res) {
  const url = req.url || "/";
  const path = url.split("?")[0];
  if (!path.startsWith("/api/")) return true; // static files never need auth
  if (path === "/api/health") return true;    // health check stays public

  if (expectedToken === null) {
    // Dev mode: no token configured → allow, but warn once per process.
    if (!warnedNoToken) {
      warnedNoToken = true;
      console.warn(
        "[auth] ⚠️  AGENT_SRE_API_TOKEN is not set — running in permissive dev mode. " +
        "All /api/* endpoints are UNPROTECTED. Set the env var before exposing this server."
      );
    }
    return true;
  }

  const presented = req.headers["x-api-token"];
  if (typeof presented !== "string" || !safeTokenEqual(presented, expectedToken)) {
    json(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}


/** Register all routes on a http.Server */
export function registerRoutes(server) {
  server.on("request", async (req, res) => {
    const url = req.url || "/";
    const path = url.split("?")[0];
    const method = req.method || "GET";

    // CORS — X-API-Token must be allow-listed for the browser UI (TASK-015)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Token");
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    try {
      // ── API token auth (TASK-015) — gates every /api/* route below ──
      if (!checkApiToken(req, res)) return;

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

      // ── GET /api/tasks — list all tasks (deprecated → /api/agents) ──
      if (path === "/api/tasks" && method === "GET") {
        return json(res, 200, { tasks: taskStore.list(), deprecated: true });
      }

      // ── POST /api/tasks — create a new task (deprecated → POST /api/agents) ──
      if (path === "/api/tasks" && method === "POST") {
        const body = await readBody(req);
        if (!body.name) {
          return json(res, 400, { error: "Missing required field: name" });
        }
        const task = taskStore.create(body);
        return json(res, 201, { task, deprecated: true });
      }

      // ── Task by-id routes: GET / PUT / DELETE ──
      const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const id = decodeURIComponent(taskMatch[1]);

        // GET /api/tasks/:id — retrieve a single task
        if (method === "GET") {
          const task = taskStore.get(id);
          if (!task) return json(res, 404, { error: `Task not found: ${id}` });
          return json(res, 200, { task, deprecated: true });
        }

        // PUT /api/tasks/:id — update a task
        if (method === "PUT") {
          const task = taskStore.get(id);
          if (!task) return json(res, 404, { error: `Task not found: ${id}` });
          const body = await readBody(req);
          if (!body || typeof body !== "object") {
            return json(res, 400, { error: "Request body must be a JSON object" });
          }
          const updated = taskStore.update(id, body);
          return json(res, 200, { task: updated, deprecated: true });
        }

        // DELETE /api/tasks/:id — delete a task
        if (method === "DELETE") {
          const deleted = taskStore.delete(id);
          if (!deleted) return json(res, 404, { error: `Task not found: ${id}` });
          return json(res, 200, { success: true, id, deprecated: true });
        }
      }

      // ── GET /api/agents — list all agents ──
      if (path === "/api/agents" && method === "GET") {
        return json(res, 200, { agents: listAgents() });
      }

      // ── POST /api/agents — create an agent (id generated server-side) ──
      if (path === "/api/agents" && method === "POST") {
        const body = await readBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return json(res, 400, { error: "Request body must be a JSON object" });
        }
        if (!body.name) return json(res, 400, { error: "Missing required field: name" });
        if (!body.prompt) return json(res, 400, { error: "Missing required field: prompt" });
        try {
          const agent = saveAgent(body);
          notifyScheduler("created", agent);
          return json(res, 201, { agent });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }

      // ── Agent by-id routes: GET / PUT / DELETE ──
      const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
      if (agentMatch) {
        const id = decodeURIComponent(agentMatch[1]);

        // GET /api/agents/:id — retrieve a single agent
        if (method === "GET") {
          let agent = null;
          try {
            agent = getAgent(id);
          } catch (err) {
            // invalid/traversal id — store contract says these throw
            return json(res, 400, { error: err.message });
          }
          if (!agent) return json(res, 404, { error: `Agent not found: ${id}` });
          return json(res, 200, { agent });
        }

        // PUT /api/agents/:id — update an agent
        if (method === "PUT") {
          const body = await readBody(req);
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            return json(res, 400, { error: "Request body must be a JSON object" });
          }
          if (!body.name) return json(res, 400, { error: "Missing required field: name" });
          if (!body.prompt) return json(res, 400, { error: "Missing required field: prompt" });
          try {
            const agent = saveAgent({ ...body, id });
            notifyScheduler("updated", agent);
            return json(res, 200, { agent });
          } catch (err) {
            // Store throws "Agent not found: <id>" for missing ids (404 flavor),
            // everything else is a schema violation (400).
            if (err.message && err.message.startsWith("Agent not found")) {
              return json(res, 404, { error: err.message });
            }
            return json(res, 400, { error: err.message });
          }
        }

        // DELETE /api/agents/:id — delete an agent
        if (method === "DELETE") {
          let deleted = false;
          try {
            deleted = deleteAgent(id);
          } catch (err) {
            // invalid/traversal id
            return json(res, 400, { error: err.message });
          }
          if (!deleted) return json(res, 404, { error: `Agent not found: ${id}` });
          notifyScheduler("deleted", { id });
          return json(res, 200, { success: true, id });
        }
      }

      // ── GET /api/datasources — list all, tokens ALWAYS masked (TASK-011) ──
      // Secret rule: no response path may ever contain a plaintext token.
      if (path === "/api/datasources" && method === "GET") {
        const datasources = listDatasources().map(ds => ({
          ...ds,
          token: TOKEN_MASK,
        }));
        return json(res, 200, { datasources });
      }

      // ── POST /api/datasources — create a datasource (TASK-011) ──
      // id is a caller-chosen slug naming the tool provider it binds to.
      // The token is written in plaintext (handlers need the real value);
      // the response is masked. Duplicate id → 400 (PUT for updates).
      if (path === "/api/datasources" && method === "POST") {
        const body = await readBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return json(res, 400, { error: "Request body must be a JSON object" });
        }
        try {
          if (getDatasource(body.id) !== null) {
            return json(res, 400, { error: `Datasource already exists: ${body.id} (use PUT to update)` });
          }
          const ds = saveDatasource(body);
          return json(res, 201, { datasource: { ...ds, token: TOKEN_MASK } });
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }

      // ── Datasource by-id routes: GET / PUT / DELETE (TASK-011) ──
      const datasourceMatch = path.match(/^\/api\/datasources\/([^/]+)$/);
      if (datasourceMatch) {
        const id = decodeURIComponent(datasourceMatch[1]);

        // GET /api/datasources/:id — single read, token masked
        if (method === "GET") {
          let ds;
          try {
            ds = getDatasource(id);
          } catch (err) {
            // invalid/traversal id — store contract says these throw
            return json(res, 400, { error: err.message });
          }
          if (!ds) return json(res, 404, { error: `Datasource not found: ${id}` });
          return json(res, 200, { datasource: { ...ds, token: TOKEN_MASK } });
        }

        // PUT /api/datasources/:id — update.
        // Token rule: "***", empty, or missing in the body keeps the stored
        // value (the UI can only ever send the mask back); any other string
        // rotates it. A response NEVER echoes plaintext.
        if (method === "PUT") {
          const body = await readBody(req);
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            return json(res, 400, { error: "Request body must be a JSON object" });
          }
          let ds;
          try {
            ds = saveDatasource({ ...body, id });
          } catch (err) {
            if (err.message && err.message.startsWith("Datasource not found")) {
              return json(res, 404, { error: err.message });
            }
            return json(res, 400, { error: err.message });
          }
          return json(res, 200, { datasource: { ...ds, token: TOKEN_MASK } });
        }

        // DELETE /api/datasources/:id
        if (method === "DELETE") {
          let deleted;
          try {
            deleted = deleteDatasource(id);
          } catch (err) {
            // invalid/traversal id
            return json(res, 400, { error: err.message });
          }
          if (!deleted) return json(res, 404, { error: `Datasource not found: ${id}` });
          return json(res, 200, { success: true, id });
        }
      }

      // ── POST /api/agents/:id/run — manual trigger (TASK-006) ──
      // Runs the agent through the exact same execution path as a cron tick
      // (executeScheduledRun), but immediately: no cron involved, and the
      // agent's enabled/schedule settings do NOT gate it. Returns 202 with
      // the runId right away; the run itself continues in the background
      // and its result lands in GET /api/runs/:id.
      const agentRunMatch = path.match(/^\/api\/agents\/([^/]+)\/run$/);
      if (agentRunMatch && method === "POST") {
        const id = decodeURIComponent(agentRunMatch[1]);
        let outcome;
        try {
          outcome = beginRun(id);
        } catch (err) {
          // invalid/traversal id (agent-store throws) — same 400 as siblings
          return json(res, 400, { error: err.message });
        }
        if (outcome.status === "not-found") return json(res, 404, { error: `Agent not found: ${id}` });
        if (outcome.status === "conflict") {
          return json(res, 409, { error: "agent is already running" });
        }

        // Fire-and-forget: executeScheduledRun owns the lock release (its
        // finally always clears inFlight) and settles the run record itself.
        executeScheduledRun(id, { run: outcome.run, trigger: "manual" }).catch(err => {
          console.error(`[routes] manual run for agent ${id} crashed before settling: ${err.message}`);
        });
        return json(res, 202, { runId: outcome.run.id });
      }

      // ── GET /api/runs — list run summaries, ?agentId= filter + ?limit= (TASK-004) ──
      if (path === "/api/runs" && method === "GET") {
        const query = new URL(url, "http://localhost").searchParams;
        const filter = {};
        if (query.get("agentId")) filter.agentId = query.get("agentId");
        const limitRaw = query.get("limit");
        if (limitRaw !== null && limitRaw !== "") {
          const limit = Number(limitRaw);
          if (!Number.isInteger(limit) || limit < 0) {
            return json(res, 400, { error: `Invalid limit: ${limitRaw}` });
          }
          filter.limit = limit;
        }
        let runs;
        try {
          runs = listRuns(filter);
        } catch (err) {
          // invalid/traversal agentId
          return json(res, 400, { error: err.message });
        }
        return json(res, 200, { runs });
      }

      // ── GET /api/runs/:id — full run record (TASK-004) ──
      const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch && method === "GET") {
        const runId = decodeURIComponent(runMatch[1]);
        let run;
        try {
          run = getRun(runId);
        } catch (err) {
          // invalid/traversal run id
          return json(res, 400, { error: err.message });
        }
        if (!run) return json(res, 404, { error: `Run not found: ${runId}` });
        return json(res, 200, { run });
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

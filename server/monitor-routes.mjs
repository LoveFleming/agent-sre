/**
 * monitor-routes.mjs — /api/monitors* routes (SRE Agentic Monitoring MVP)
 *
 * Endpoints:
 *   GET    /api/monitors                     list + instance summary (health dot data)
 *   POST   /api/monitors                     create → instance + cron job + tab-ready
 *   GET    /api/monitors/:id                 definition + full instance state
 *   PUT    /api/monitors/:id                 update definition (Model Settings Save)
 *   DELETE /api/monitors/:id                 delete definition + state + cron (NOT tab close)
 *   POST   /api/monitors/:id/run             Run Now — execute the Agent Loop
 *   GET    /api/monitors/:id/chat            conversation memory (chat history)
 *   POST   /api/monitors/:id/chat            operator chat with the agent instance
 *   GET    /api/monitors/:id/memory          memory viewer (knowledge/incident/working)
 *   PUT    /api/monitors/:id/memory          edit knowledge memory
 *   GET    /api/monitors/:id/runs            execution history (run-store, monitor-<id>)
 *   GET    /api/monitor-meta                 flow templates + schedule presets + source types
 *
 * Auth: mounted inside routes.mjs's handler → inherits X-API-Token gating.
 * Lifecycle: closing a UI tab is a pure frontend action — no endpoint, no state.
 */

import {
  listMonitors, getMonitor, createMonitor, updateMonitor, deleteMonitor,
  listSchedulePresets, listSourceTypes, listOutputTypes,
} from "./monitor-store.mjs";
import { listFlowTemplates } from "./monitor-flows.mjs";
import {
  getInstance, updateInstance, setKnowledge, destroyInstance,
} from "./monitor-instance.mjs";
import { executeMonitorRun, monitorKey, rescheduleMonitor } from "./monitor-scheduler.mjs";
import { loadConversation, saveConversation } from "./conversation.mjs";
import { runAgentLoop } from "./agent-loop.mjs";
import { listRuns } from "./run-store.mjs";
import { getFlowTemplate } from "./monitor-flows.mjs";

/** Summary row for the left-side menu (name, health, source, schedule, counts). */
function summarize(monitor) {
  let inst = null;
  try { inst = getInstance(monitor); } catch { /* state io issue — menu must survive */ }
  const flow = getFlowTemplate(monitor.processFlow?.templateId);
  return {
    id: monitor.id,
    name: monitor.name,
    enabled: monitor.enabled !== false,
    status: inst ? inst.status : "unknown",
    situation: inst?.currentSituation || "",
    sourceType: monitor.sourceMCPs?.[0]?.type || "custom",
    schedule: monitor.scheduler?.cron || "",
    flowName: flow.name,
    lastRunAt: inst?.lastRunAt || null,
    nextRunAt: inst?.nextRunAt || null,
    runCount: inst?.runCount || 0,
  };
}

/** Build the crew-shaped context for interactive chat (richer than the run prompt). */
function buildChatCrew(monitor) {
  const { agentConfig, sourceMCPs, processFlow } = monitor;
  const flow = getFlowTemplate(processFlow.templateId);
  const sections = [];
  sections.push(`### Mission\n${agentConfig.mission || `Monitor ${monitor.name}.`}`);
  if (agentConfig.rules?.length) sections.push(`### Deterministic Rules\n${agentConfig.rules.map(r => `- ${r}`).join("\n")}`);
  if (agentConfig.skills?.length) sections.push(`### Skills\n${agentConfig.skills.join(" · ")}`);
  sections.push(`### Process Flow\n${flow.name}: ${flow.nodes.map(n => n.name).join(" → ")}`);
  sections.push(`### Source MCPs\n${sourceMCPs.map(s => `- ${s.type}: ${s.resource}`).join("\n")}`);

  const inst = getInstance(monitor);
  const live = [
    inst.currentSituation ? `Active situation: ${inst.currentSituation}` : "No active situation (last run saw no signal).",
    inst.lastRunAt ? `Last run: ${inst.lastRunAt} (${inst.lastRunResult})` : "Never run yet.",
    inst.incidentMemory.length ? `Recent incidents:\n${inst.incidentMemory.slice(-5).map(i => `- ${i.situation} (${i.severity})`).join("\n")}` : "",
    inst.knowledgeMemory.length ? `Knowledge:\n${inst.knowledgeMemory.map(k => `- ${k}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  return {
    id: monitorKey(monitor.id),
    title: agentConfig.agentName,
    description: monitor.description,
    expertise: `${sections.join("\n\n")}\n\n### Live Instance State\n${live}`,
    systemPrompt: agentConfig.prompt,
    allowedTools: agentConfig.allowedToolsOverride || monitor.sourceMCPs.flatMap(s => s.tools || []),
  };
}

/** Read request body as JSON (same contract as routes.mjs). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; if (data.length > 1024 * 1024) reject(new Error("Body too large")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

/**
 * Handle /api/monitor* requests. Returns true when the request was handled.
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {(res: object, status: number, body: object) => void} json
 */
export async function handleMonitorRoutes(req, res, json) {
  const path = (req.url || "/").split("?")[0];
  const method = req.method || "GET";

  /** json() wrapper that also reports "handled" to routes.mjs. */
  const reply = (res, code, body) => { json(res, code, body); return true; };

  // ── GET /api/monitor-meta — pickers data ──
  if (path === "/api/monitor-meta" && method === "GET") {
    return reply(res, 200, {
      flowTemplates: listFlowTemplates(),
      schedulePresets: listSchedulePresets(),
      sourceTypes: listSourceTypes(),
      outputTypes: listOutputTypes(),
    });
  }

  // ── GET /api/monitors — list (left menu) ──
  if (path === "/api/monitors" && method === "GET") {
    return reply(res, 200, { monitors: listMonitors().map(summarize) });
  }

  // ── POST /api/monitors — create ──
  if (path === "/api/monitors" && method === "POST") {
    const body = await readBody(req);
    let monitor;
    try {
      monitor = createMonitor(body);
    } catch (err) {
      return reply(res, 400, { error: err.message });
    }
    getInstance(monitor); // materialize the AgentInstance immediately
    rescheduleMonitor("created", monitor);
    return reply(res, 201, { monitor, instance: getInstance(monitor) });
  }

  const mMatch = path.match(/^\/api\/monitors\/([^/]+)(\/.*)?$/);
  if (!mMatch) return false;
  const id = decodeURIComponent(mMatch[1]);
  const sub = mMatch[2] || "";

  let monitor = null;
  try {
    monitor = getMonitor(id);
  } catch (err) {
    return reply(res, 400, { error: err.message });
  }

  // ── /api/monitors/:id — GET / PUT / DELETE ──
  if (sub === "") {
    if (method === "GET") {
      if (!monitor) return reply(res, 404, { error: `Monitor not found: ${id}` });
      return reply(res, 200, { monitor, instance: getInstance(monitor) });
    }
    if (method === "PUT") {
      const body = await readBody(req);
      let updated;
      try {
        updated = updateMonitor(id, body);
      } catch (err) {
        if (err.message?.startsWith("Monitor not found")) return reply(res, 404, { error: err.message });
        return reply(res, 400, { error: err.message });
      }
      updateInstance(id, inst => { if (updated.enabled === false) inst.status = "disabled"; });
      rescheduleMonitor("updated", updated);
      return reply(res, 200, { monitor: updated, instance: getInstance(updated) });
    }
    if (method === "DELETE") {
      let deleted = false;
      try { deleted = deleteMonitor(id); } catch (err) { return reply(res, 400, { error: err.message }); }
      if (!deleted) return reply(res, 404, { error: `Monitor not found: ${id}` });
      rescheduleMonitor("deleted", { id });
      destroyInstance(id);
      return reply(res, 200, { success: true, id });
    }
  }

  if (!monitor) return reply(res, 404, { error: `Monitor not found: ${id}` });

  // ── POST /api/monitors/:id/run — Run Now ──
  if (sub === "/run" && method === "POST") {
    const result = await executeMonitorRun(monitor, { trigger: "manual" });
    return reply(res, result.ok ? 200 : 409, { result, instance: getInstance(monitor) });
  }

  // ── Chat with the agent instance ──
  if (sub === "/chat") {
    if (method === "GET") {
      return reply(res, 200, { messages: loadConversation(monitorKey(id)) });
    }
    if (method === "POST") {
      const body = await readBody(req);
      const message = typeof body?.message === "string" ? body.message.trim() : "";
      if (!message) return reply(res, 400, { error: "Missing required field: message" });
      const crew = buildChatCrew(monitor);
      const history = loadConversation(monitorKey(id));
      try {
        const result = await runAgentLoop({ crew, message, history, model: body.model });
        saveConversation(monitorKey(id), result.history);
        return reply(res, 200, { content: result.content, toolCallCount: result.toolCallCount || 0 });
      } catch (err) {
        return reply(res, 500, { error: `Agent loop failed: ${err.message}` });
      }
    }
  }

  // ── Memory viewer / editor ──
  if (sub === "/memory") {
    const inst = getInstance(monitor);
    if (method === "GET") {
      return reply(res, 200, {
        knowledge: inst.knowledgeMemory,
        incidents: inst.incidentMemory,
        working: inst.workingMemory,
        memoryPolicy: monitor.memoryPolicy,
      });
    }
    if (method === "PUT") {
      const body = await readBody(req);
      if (!Array.isArray(body?.knowledge)) return reply(res, 400, { error: "Missing required field: knowledge (string[])" });
      try {
        setKnowledge(id, body.knowledge);
      } catch (err) {
        return reply(res, 400, { error: err.message });
      }
      return reply(res, 200, { knowledge: getInstance(monitor).knowledgeMemory });
    }
  }

  // ── Execution history ──
  if (sub === "/runs" && method === "GET") {
    return reply(res, 200, { runs: listRuns({ agentId: monitorKey(id) }) });
  }

  return false; // unknown /api/monitors/* subpath → 404 by routes.mjs fallback
}

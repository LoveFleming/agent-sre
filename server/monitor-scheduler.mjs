/**
 * monitor-scheduler.mjs — Monitor Agent Loop runner + cron engine (MVP)
 *
 * Spec §15 Agent Loop, executed per monitor run (scheduled tick or Run Now):
 *   Wake → Load Working Context → Execute Process Flow → Source MCP /
 *   Rules / Skills / Memory → Agent Reasoning → Decision → Output MCP →
 *   Update Memory → Sleep
 *
 * Deterministic-first (north-star discipline):
 *  - Phase "read": plain tool calls (no LLM) — e.g. grafana_list_alerts
 *  - Phase "gate": deterministic rule evaluation — quiet when healthy,
 *    LLM never runs just because the scheduler fired
 *  - Phase "reason": exactly ONE LLM call, fed with the evidence bundle +
 *    incident/knowledge memory + monitor prompt/rules (agent-loop.mjs)
 *  - Phase "output": tchat notify ONLY when the run produced a situation
 *    (notifyPolicy equivalent of watchdog: healthy → silence)
 *  - Phase "memory": instance state + incident memory updates
 *
 * Scheduling follows scheduler.mjs conventions: node-cron job per enabled
 * monitor, in-flight re-entry guard (skip overlap), reschedule hooks on
 * create/update/delete, run-store recording under agentId `monitor:<id>`.
 */

import cron from "node-cron";
import { listMonitors, getMonitor } from "./monitor-store.mjs";
import { getFlowTemplate } from "./monitor-flows.mjs";
import { getInstance, recordRun, appendIncident } from "./monitor-instance.mjs";
import { loadConversation, saveConversation } from "./conversation.mjs";
import { startRun, finishRun } from "./run-store.mjs";
import { runAgentLoop } from "./agent-loop.mjs";
import { toolRegistry } from "./tool-registry.mjs";
import { sendTchatMessage } from "../tools/tchat/handler.mjs";

/** monitorId → node-cron ScheduledTask */
const jobs = new Map();
/** monitorIds with a run in flight (re-entry guard). */
const inFlight = new Set();
let started = false;

const RUN_KEY_PREFIX = "monitor-";
/** @returns {string} run-store / conversation key for a monitor */
export function monitorKey(monitorId) {
  return `${RUN_KEY_PREFIX}${monitorId}`;
}

// ── Tool layer (deterministic source reads) ──

/**
 * Execute a tool directly (no LLM) via the registry. Returns a short
 * string result or an error marker — never throws into the runner.
 * @param {string} name
 * @param {object} args
 * @returns {Promise<{ok: boolean, result: string}>}
 */
async function callTool(name, args = {}) {
  const tool = toolRegistry.get(name);
  if (!tool) return { ok: false, result: `tool not registered: ${name}` };
  try {
    const out = await tool.handler(args);
    const text = typeof out === "string" ? out : JSON.stringify(out);
    return { ok: true, result: text.length > 8_000 ? `${text.slice(0, 8_000)}…[truncated]` : text };
  } catch (err) {
    return { ok: false, result: `error: ${err.message}` };
  }
}

/** Pick the deterministic read tool for a source type (MVP mapping). */
function readToolForSource(type) {
  switch (type) {
    case "grafana": return "grafana_list_alerts";
    case "prometheus": return "query_promql";
    case "loki": return "query_logs";
    case "k8s": return "kubectl_get";
    case "tchat": return "tchat_read_history";
    case "docs": return "list_runbooks";
    case "security": return "scan_deps";
    default: return null;
  }
}

/** Deterministic "is there a signal" gate — true when any evidence line looks alerting. */
function hasSignal(evidenceLines) {
  const joined = evidenceLines.join("\n").toLowerCase();
  return /\b(firing|pending|critical|unhealthy|error|fail|crashloop|evicted)\b/.test(joined);
}

/**
 * Build the crew-shaped object agent-loop.mjs expects from a monitor
 * definition (prompt + rules + skills + mission + source context).
 */
function buildMonitorCrew(monitor) {
  const { agentConfig, sourceMCPs, processFlow } = monitor;
  const flow = getFlowTemplate(processFlow.templateId);
  const sections = [];

  sections.push(`### Mission\n${agentConfig.mission || `Monitor ${monitor.name} and publish only meaningful conclusions.`}`);
  if (agentConfig.rules?.length) {
    sections.push(`### Deterministic Rules\n${agentConfig.rules.map(r => `- ${r}`).join("\n")}`);
  }
  if (agentConfig.skills?.length) {
    sections.push(`### Skills\n${agentConfig.skills.join(" · ")}`);
  }
  sections.push(`### Process Flow\n${flow.name}: ${flow.nodes.map(n => n.name).join(" → ")}`);
  sections.push(`### Source MCPs\n${sourceMCPs.map(s => `- ${s.type}: ${s.resource}`).join("\n")}`);
  if (monitor.outputMCPs?.length) {
    sections.push(`### Output MCPs\n${monitor.outputMCPs.map(o => `- ${o.type} → ${o.target}${o.approvalRequired ? " (approval required)" : ""}`).join("\n")}`);
  }

  return {
    id: monitorKey(monitor.id),
    title: agentConfig.agentName,
    description: monitor.description,
    expertise: sections.join("\n\n"),
    systemPrompt: `${agentConfig.prompt}\n\n${sections.join("\n\n")}`,
    allowedTools: monitor.sourceMCPs.flatMap(s => s.tools || []),
    notifyTarget: monitor.outputMCPs.find(o => o.type === "chat")?.target
      ? { targetType: "channel", targetId: monitor.outputMCPs.find(o => o.type === "chat").target }
      : null,
  };
}

/**
 * Execute one monitor run (the Agent Loop). Shared by cron ticks and
 * POST /api/monitors/:id/run (Run Now).
 *
 * @param {object} monitor - monitor definition
 * @param {{trigger?: "cron"|"manual", model?: string}} [opts]
 * @returns {Promise<{ok: boolean, quiet: boolean, situation: string, summary: string, runId: string|null, evidence: string[]}>}
 */
export async function executeMonitorRun(monitor, opts = {}) {
  const trigger = opts.trigger || "manual";
  const key = monitorKey(monitor.id);

  // Re-entry guard: skip when a run is already in flight (spec §6 overlapPolicy skip).
  if (inFlight.has(monitor.id)) {
    return { ok: false, quiet: true, situation: "", summary: "skipped: previous run still in flight", runId: null, evidence: [] };
  }
  inFlight.add(monitor.id);

  const inst = getInstance(monitor);
  const run = startRun(key);
  inst.status = "running";
  inst.currentState = "read";
  const nextRunAt = computeNextRunAt(monitor);

  try {
    // ── Phase: read sources (deterministic, no LLM) ──
    const evidence = [];
    for (const src of monitor.sourceMCPs) {
      const toolName = readToolForSource(src.type);
      if (!toolName) {
        evidence.push(`[${src.type}] ${src.resource} — no deterministic reader mapped (MVP)`);
        continue;
      }
      const args = src.type === "prometheus" || src.type === "loki"
        ? { query: src.resource }
        : src.type === "k8s" ? { resource: src.resource || "pods" }
        : src.type === "tchat" ? { chat_id: src.resource, limit: 20 }
        : src.type === "grafana" ? { state: "all" }
        : {};
      const { ok, result } = await callTool(toolName, args);
      evidence.push(`[${src.type}] ${src.resource}\n${ok ? result : `READ FAILED — ${result}`}`);
    }

    // ── Phase: deterministic rule gate ──
    const signaled = hasSignal(evidence);

    if (!signaled) {
      // Healthy: stay quiet (never burn an LLM call because cron fired).
      recordRun(monitor.id, { ok: true, situation: "", summary: "healthy — no signal", nextRunAt });
      finishRun(run.id, { status: "success", summary: "healthy — no signal", toolCallCount: evidence.length });
      return { ok: true, quiet: true, situation: "", summary: "Healthy — no signal detected. Nothing requires action.", runId: run.id, evidence };
    }

    // ── Phase: agent reasoning (ONE LLM call with evidence + memory) ──
    inst.currentState = "reason";
    const crew = buildMonitorCrew(monitor);
    const memoryContext = [
      inst.knowledgeMemory.length ? `Knowledge memory:\n${inst.knowledgeMemory.map(k => `- ${k}`).join("\n")}` : "",
      inst.incidentMemory.length ? `Recent incidents:\n${inst.incidentMemory.slice(-5).map(i => `- ${i.situation} (${i.severity}, ${i.createdAt})`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    const askPrompt = [
      `Scheduled monitor run (${trigger}) for "${monitor.name}".`,
      "",
      "Current evidence from Source MCPs:",
      ...evidence.map(e => `---\n${e}`),
      memoryContext ? `\nMemory:\n${memoryContext}` : "",
      "",
      "Follow your process flow: correlate the evidence, check against rules and memory, then answer with:",
      "1. SITUATION: one-line title (or EMPTY if this is a known-benign pattern)",
      "2. SEVERITY: P1-P4",
      "3. EVIDENCE: the 2-4 most important lines",
      "4. HYPOTHESIS: what you think is happening (separate from evidence)",
      "5. CONFIDENCE: 0-1",
      "6. RECOMMENDATION: lowest-risk next action (or 'none')",
      "Never claim root cause without evidence. Do not execute gated actions.",
    ].filter(x => x !== undefined).join("\n");

    const history = loadConversation(key);
    const result = await runAgentLoop({ crew, message: askPrompt, history, model: opts.model });

    // ── Parse the structured answer (deterministic regex, honest fallback) ──
    const text = result.content || "";
    const grab = (label) => {
      const m = text.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`, "i"));
      // strip markdown emphasis the model sometimes wraps answers in
      return m ? m[1].trim().replace(/^[*_`~#]+|[*_`~]+$/g, "").trim() : "";
    };
    let situation = grab("SITUATION");
    // severity: prefer an explicit P1-P4 token anywhere in the line, else P3
    const sevRaw = grab("SEVERITY").toUpperCase();
    const sevMatch = sevRaw.match(/P[1-4]/);
    const severity = sevMatch ? sevMatch[0] : "P3";
    const confidenceRaw = parseFloat(grab("CONFIDENCE"));
    const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : null;
    const recommendation = grab("RECOMMENDATION");
    if (/^empty|^none|^healthy|known.?benign/i.test(situation)) situation = "";

    // ── Phase: output MCP (only when a situation survived the gate) ──
    let notified = false;
    if (situation) {
      appendIncident(monitor.id, { situation, severity, summary: text.slice(0, 2_000), confidence, recommendation, approvalRequired: /restart|rollback|scale|failover/i.test(recommendation) });
      const chatOut = monitor.outputMCPs.find(o => o.type === "chat");
      if (chatOut) {
        try {
          const sent = await sendTchatMessage({
            targetType: "channel",
            targetId: chatOut.target,
            text: `🚨 [${monitor.name}] ${situation} (${severity}, confidence ${confidence ?? "?"})\n${recommendation ? `建議: ${recommendation}\n` : ""}(approval required for production-changing actions)`,
          });
          notified = sent?.ok !== false;
          if (!notified) console.error(`[monitor-scheduler] notify rejected for ${monitor.id}: ${sent?.error}`);
        } catch (err) {
          console.error(`[monitor-scheduler] notify failed for ${monitor.id}: ${err.message}`);
        }
      }
    }

    // ── Phase: memory + bookkeeping ──
    recordRun(monitor.id, {
      ok: true,
      situation,
      summary: situation ? `${situation} (${severity})` : "benign/known pattern — no escalation",
      working: { hypothesis: grab("HYPOTHESIS"), evidence: evidence.slice(0, 10), confidence },
      nextRunAt,
    });
    saveConversation(key, result.history);
    finishRun(run.id, {
      status: "success",
      summary: situation ? `${situation} (${severity})${notified ? " · notified" : ""}` : "benign — quiet",
      toolCallCount: result.toolCallCount || 0,
    });

    return { ok: true, quiet: !situation, situation, summary: text.slice(0, 4_000), runId: run.id, evidence };
  } catch (err) {
    recordRun(monitor.id, { ok: false, situation: "", summary: `run failed: ${err.message}`, nextRunAt });
    finishRun(run.id, { status: "failed", error: err.message });
    return { ok: false, quiet: false, situation: "", summary: `Run failed: ${err.message}`, runId: run.id, evidence: [] };
  } finally {
    inFlight.delete(monitor.id);
  }
}

/** Estimate the next run ISO time from a 5-field cron (minute-granularity MVP). */
export function computeNextRunAt(monitor) {
  const expr = monitor.scheduler?.cron || "*/5 * * * *";
  const [minField] = expr.trim().split(/\s+/);
  const now = new Date();
  const next = new Date(now.getTime() + 60_000);
  next.setSeconds(0, 0);

  const stepMatch = minField.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10) || 5;
    next.setMinutes(Math.ceil(next.getMinutes() / step) * step);
  } else if (minField === "*") {
    // every minute — next is fine
  } else if (/^\d+$/.test(minField)) {
    const m = parseInt(minField, 10);
    if (next.getMinutes() > m) next.setHours(next.getHours() + 1);
    next.setMinutes(m);
  } else {
    next.setMinutes(next.getMinutes() + 5); // lists/ranges — coarse estimate
  }
  return next.toISOString();
}

// ── Cron lifecycle (mirrors scheduler.mjs) ──

function scheduleMonitor(monitor) {
  const { id, scheduler, enabled } = monitor;
  if (!enabled || !scheduler?.cron) return;
  const valid = cron.validate(scheduler.cron);
  if (!valid) {
    console.warn(`[monitor-scheduler] invalid cron for ${id}: ${scheduler.cron}`);
    return;
  }
  const task = cron.schedule(scheduler.cron, async () => {
    const fresh = getMonitor(id);
    if (!fresh || fresh.enabled === false) return;
    try {
      await executeMonitorRun(fresh, { trigger: "cron" });
    } catch (err) {
      console.error(`[monitor-scheduler] tick failed for ${id}: ${err.message}`);
    }
  });
  jobs.set(id, task);
  getInstance(monitor).nextRunAt = computeNextRunAt(monitor);
}

function unscheduleMonitor(id) {
  const task = jobs.get(id);
  if (task) {
    task.stop();
    jobs.delete(id);
  }
}

/**
 * Keep cron jobs in sync after create/update/delete. Same contract as
 * scheduler.mjs rescheduleAgent.
 * @param {"created"|"updated"|"deleted"} type
 * @param {object} monitor
 */
export function rescheduleMonitor(type, monitor) {
  if (!started) return;
  if (!monitor?.id) return;
  unscheduleMonitor(monitor.id);
  if (type === "deleted") return;
  if (monitor.enabled !== false) scheduleMonitor(monitor);
}

/** Start all monitor cron jobs at boot. */
export function startMonitorScheduler() {
  started = true;
  for (const m of listMonitors()) {
    if (m.enabled !== false) scheduleMonitor(m);
  }
  console.log(`[monitor-scheduler] ${jobs.size} monitor job(s) scheduled`);
}

/**
 * scheduler.mjs — node-cron scheduling engine (TASK-005, ADR-003)
 *
 * startScheduler(): every agent with enabled=true and a non-empty schedule
 * gets one cron job. A tick runs the agent through the same execution path
 * as /api/chat (runAgentLoop + conversation history + toolRegistry),
 * records the outcome in run-store (running → success/failed), then
 * notifies the agent's notifyTarget.
 *
 * Notify note: the tchat transport (TASK-007) does not exist yet, so the
 * notify step only logs and the run records notified:false + notifyError.
 * deliverNotification() is the single swap point for the future transport.
 *
 * Wiring: index.mjs bridges routes.mjs ↔ scheduler.mjs — it calls
 * setSchedulerNotifier(({type, agent}) => rescheduleAgent(type, agent)).
 * This module deliberately does NOT import routes.mjs (dependency cycle:
 * routes → agent-store ↔ scheduler → agent-store).
 *
 * Constraints implemented here:
 * 1. Re-entry guard — one in-flight run per agent (inFlight Set); an
 *    overlapping tick is skipped, never queued.
 * 2. Run timeout — default 5 minutes (SRE_RUN_TIMEOUT_MS env override);
 *    an exceeded run finishes as failed.
 * 3. Dynamic reschedule — rescheduleAgent()/rescheduleAll() keep jobs in
 *    sync with agent-store mutations without a restart.
 *
 * Scheduled runs use the agent's own id as conversation key, so patrol
 * memory accumulates under data/conversations/<agentId>/ while human chat
 * sessions stay under their crew keys (sre.commander etc.).
 */

import cron from "node-cron";
import { listAgents, getAgent } from "./agent-store.mjs";
import { runAgentLoop } from "./agent-loop.mjs";
import { loadConversation, saveConversation } from "./conversation.mjs";
import { startRun, finishRun } from "./run-store.mjs";

/** Default wall-clock budget for one scheduled run. */
const DEFAULT_RUN_TIMEOUT_MS = 5 * 60_000;
/** Truncation for logged notify summaries (console hygiene only). */
const NOTIFY_LOG_SUMMARY_MAX = 120;

/** agentId → node-cron ScheduledTask */
const jobs = new Map();
/** agentIds with a run currently in flight (re-entry guard). */
const inFlight = new Set();
/** Boot latch — rescheduleAgent is a no-op before startScheduler(). */
let started = false;

function resolveRunTimeoutMs() {
  const raw = Number(process.env.SRE_RUN_TIMEOUT_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_RUN_TIMEOUT_MS;
}

/**
 * Assemble a crew object shaped for runAgentLoop/buildSystemPrompt
 * (agent-loop.mjs) from a persisted agent (agent-store schema):
 * prompt/context/agentRules/allowedTools → title/description/expertise/
 * systemPrompt/allowedTools, plus the notify target so the LLM knows
 * its report audience.
 * @param {object} agent - stored agent record
 * @returns {object} crew-shaped object
 */
export function buildCrew(agent) {
  const rules = agent.agentRules || {};
  const sections = [];

  if (Array.isArray(rules.guardrails) && rules.guardrails.length) {
    sections.push(`### Guardrails\n${rules.guardrails.map(r => `- ${r}`).join("\n")}`);
  }
  if (Array.isArray(rules.redirectRules) && rules.redirectRules.length) {
    sections.push(`### 轉介規則\n${rules.redirectRules.map(r => `- ${r}`).join("\n")}`);
  }
  if (Array.isArray(rules.refuseTopics) && rules.refuseTopics.length) {
    sections.push(`### 拒絕主題\n${rules.refuseTopics.map(r => `- ${r}`).join("\n")}`);
  }

  const target = agent.notifyTarget || {};
  const notifyBlock =
    `\n## 通知目標\n` +
    `本次為排程自動執行。執行結論將通知 ${target.targetType || "user"} ` +
    `${target.targetId || ""}，請在結論中明確標示是否需要人工介入。`;

  const promptParts = [agent.prompt || ""];
  if (sections.length) promptParts.push(sections.join("\n\n"));
  promptParts.push(notifyBlock.trim());

  return {
    id: agent.id,
    title: agent.name,
    description: agent.context || "",
    expertise: "",
    systemPrompt: promptParts.join("\n\n"),
    allowedTools: Array.isArray(agent.allowedTools) ? agent.allowedTools : [],
  };
}

/** The user message a scheduled tick sends to the agent loop.
 *  trigger="manual" (TASK-006 /api/agents/:id/run) says a human asked for
 *  this run; otherwise it reads as the cron tick it is. */
function buildTriggerMessage(agent, trigger = "scheduled") {
  if (trigger === "manual") {
    return [
      `[手動觸發] ${new Date().toISOString()}`,
      "",
      "有人透過 API 手動觸發本次執行。請依你的設定執行本次檢查，完成後回報發現與建議。",
    ].join("\n");
  }
  return [
    `[排程觸發] ${new Date().toISOString()}`,
    `排程: "${agent.schedule}"`,
    "",
    "這是排程自動執行，沒有人在線。請依你的設定執行本次檢查，完成後回報發現與建議。",
  ].join("\n");
}

/**
 * Deliver the run outcome to the agent's notifyTarget.
 * TASK-007 (tchat transport) is not implemented yet — log only and report
 * not-delivered so the run persists notified:false + a notifyError.
 * @returns {Promise<{sent: boolean, error: string|null}>}
 */
async function deliverNotification(agent, summary) {
  const text = String(summary ?? "");
  console.log(
    `[scheduler] notify(pending transport) agent=${agent.id} ` +
    `→ ${agent.notifyTarget.targetType}:${agent.notifyTarget.targetId} ` +
    `summary=${text.slice(0, NOTIFY_LOG_SUMMARY_MAX)}`
  );
  return { sent: false, error: "notify transport not implemented (TASK-007 pending)" }; // swap point for TASK-007
}

/**
 * Execute one agent run end-to-end: store → crew → agent loop → run-store
 * → notify. A tick landing while the agent is already running is skipped.
 *
 * TASK-006: when the caller passes a pre-created `run` (from beginRun()),
 * the in-flight lock is already held and the skip check is bypassed —
 * this is the manual-trigger path from POST /api/agents/:id/run. Without
 * `run`, this behaves exactly like the cron tick it has always been.
 *
 * @param {string} agentId
 * @param {{timeoutMs?: number, run?: object|null, trigger?: "scheduled"|"manual"}} [options]
 * @returns {Promise<{skipped?: boolean, reason?: string, run?: object}>}
 */
export async function executeScheduledRun(agentId, { timeoutMs = resolveRunTimeoutMs(), run = null, trigger = "scheduled" } = {}) {
  let agent = null;
  try {
    agent = getAgent(agentId);
  } catch (err) {
    // Manual path: an id that passed beginRun() cannot become invalid, but
    // if it somehow does, release the lock so the agent is not wedged.
    if (run) {
      inFlight.delete(agentId);
      try {
        return { run: finishRun(run.id, { status: "failed", error: err.message }) };
      } catch {
        return { run: null };
      }
    }
    throw err;
  }
  if (!agent) {
    // Agent was deleted between beginRun() and now — settle the run instead
    // of leaving it stuck in "running" forever.
    if (run) {
      inFlight.delete(agentId);
      try {
        return { run: finishRun(run.id, { status: "failed", error: `Agent not found: ${agentId}` }) };
      } catch {
        return { run: null };
      }
    }
    throw new Error(`Agent not found: ${agentId}`);
  }

  if (!run) {
    if (inFlight.has(agentId)) {
      console.warn(`[scheduler] agent "${agent.name}" (${agentId}) is still running — skipping this tick`);
      return { skipped: true, reason: "already-running" };
    }
    inFlight.add(agentId);
    run = startRun(agentId);
  }
  const toolCalls = [];
  let settled = false;

  /** Idempotent finish — timeout + late rejection must not double-write. */
  const finish = (result) => {
    if (settled) return { alreadyFinished: true };
    settled = true;
    try {
      return { run: finishRun(run.id, result) };
    } catch (err) {
      console.error(`[scheduler] finishRun failed for run ${run.id}: ${err.message}`);
      return { run: null };
    }
  };

  try {
    const crew = buildCrew(agent);
    const history = loadConversation(crew.id);
    const onToolCall = ({ name, result }) => {
      // agent-loop fires onToolCall after each execute() and exposes no
      // per-call timing, so durationMs stays null (honest > wrong number).
      toolCalls.push({ name, durationMs: null });
      console.log(`[scheduler] ${agent.name} tool: ${name} → ${result?.slice(0, 100)}`);
    };

    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error(`Run timed out after ${timeoutMs}ms`), { code: "SCHED_RUN_TIMEOUT" })),
        timeoutMs
      );
      timer.unref?.();
    });

    let result;
    try {
      result = await Promise.race([
        runAgentLoop({ crew, message: buildTriggerMessage(agent, trigger), history, onToolCall }),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
    }

    saveConversation(crew.id, result.history);
    const notify = await deliverNotification(agent, result.content);

    return finish({
      status: "success",
      summary: result.content,
      toolCalls,
      notified: notify.sent,
      ...(notify.sent ? {} : { notifyError: notify.error }),
    });
  } catch (err) {
    console.error(`[scheduler] run ${run.id} for agent ${agentId} failed: ${err.message}`);
    // A failed scheduled run is exactly the case a human wants to hear
    // about — same placeholder path as success until TASK-007 lands.
    try {
      await deliverNotification(agent, `❌ 排程執行失敗: ${err.message}`);
    } catch {
      // notify stub never throws today; keep this defensive for TASK-007
    }
    return finish({ status: "failed", error: err.message, toolCalls, notified: false, notifyError: "notify transport not implemented (TASK-007 pending)" });
  } finally {
    inFlight.delete(agentId);
  }
}

/**
 * Register (or replace) the cron job for one agent.
 * Only enabled agents with a non-empty, valid schedule qualify; anything
 * else unregisters. agent-store already validates cron on save — an
 * invalid expression here means a hand-edited file, so warn and skip.
 * @param {object} agent - stored agent record
 * @returns {boolean} whether a job is now registered
 */
function registerAgent(agent) {
  if (!agent?.id) return false;
  unregisterAgent(agent.id);

  if (agent.enabled !== true || !agent.schedule) return false;
  if (!cron.validate(agent.schedule)) {
    console.warn(`[scheduler] invalid schedule "${agent.schedule}" for agent ${agent.id} — job not registered`);
    return false;
  }

  try {
    const task = cron.schedule(agent.schedule, () => {
      executeScheduledRun(agent.id).catch(err => {
        // executeScheduledRun settles its own runs; this only guards the
        // unexpected (e.g. getAgent/startRun throwing before try{}).
        console.error(`[scheduler] tick failed for agent ${agent.id}: ${err.message}`);
      });
    });
    jobs.set(agent.id, task);
    console.log(`[scheduler] scheduled "${agent.name}" (${agent.id}) → ${agent.schedule}`);
    return true;
  } catch (err) {
    console.error(`[scheduler] cannot register schedule "${agent.schedule}" for agent ${agent.id}: ${err.message}`);
    return false;
  }
}

/** Remove an agent's cron job if present. */
function unregisterAgent(agentId) {
  const task = jobs.get(agentId);
  if (!task) return false;
  try {
    task.destroy();
  } catch {
    // already stopped/destroyed — nothing to do
  }
  jobs.delete(agentId);
  return true;
}

/**
 * Routes notifier target: re-evaluate one agent's job after a store
 * mutation. No-op before startScheduler() so API mutations during boot
 * never race initial registration.
 * @param {"created"|"updated"|"deleted"} type
 * @param {object} agent - the stored agent (post-mutation snapshot)
 */
export function rescheduleAgent(type, agent) {
  if (!started) return;
  if (type === "deleted") {
    unregisterAgent(agent?.id);
    return;
  }
  if (type === "created" || type === "updated") {
    registerAgent(agent);
  }
}

/** Re-read agent-store and rebuild every job (tests / manual resync). */
export function rescheduleAll() {
  for (const agent of listAgents()) registerAgent(agent);
}

/**
 * Boot the scheduler: register cron jobs for every enabled+scheduled
 * agent. Idempotent — a second call only re-registers.
 * @returns {{jobs: {agentId: string, schedule: string, nextRun: string}[]}}
 */
export function startScheduler() {
  started = true;
  rescheduleAll();
  const jobs_ = [...jobs.entries()].map(([agentId, task]) => ({
    agentId,
    schedule: task.getPattern(),
    nextRun: task.getNextRun().toISOString(),
  }));
  console.log(`[scheduler] ${jobs_.length} scheduled agent(s) registered`);
  return { jobs: jobs_ };
}

/** Stop all jobs and reset (tests / graceful shutdown). */
export function stopScheduler() {
  for (const agentId of [...jobs.keys()]) unregisterAgent(agentId);
  started = false;
  return { activeCount: 0 };
}

/** Cron expression currently registered for an agent (null = none). */
export function activeSchedule(agentId) {
  return jobs.get(agentId)?.getPattern() ?? null;
}

/** Number of registered cron jobs. */
export function activeCount() {
  return jobs.size;
}

/** Whether a scheduled run for this agent is currently in flight. */
export function isRunning(agentId) {
  return inFlight.has(agentId);
}

/**
 * Synchronous entry point for manual triggering (TASK-006,
 * POST /api/agents/:id/run): validates the agent exists, refuses when a
 * run is already in flight (single lock source of truth for both cron and
 * manual paths), marks the in-flight lock, and creates the run record —
 * all before the HTTP 202 goes out, so the route can hand the caller the
 * runId immediately with no race window.
 *
 * The caller then passes the returned run to executeScheduledRun(agentId,
 * { run }) which picks it up and always releases the lock in its finally.
 *
 * @param {string} agentId
 * @returns {{status: "started", run: object} | {status: "not-found"} | {status: "conflict"}}
 * @throws {Error} On invalid/traversal agentId (agent-store contract)
 */
export function beginRun(agentId) {
  // getAgent throws for invalid ids (same 400-flavored contract the other
  // agent routes rely on) and returns null for unknown ones.
  const agent = getAgent(agentId);
  if (!agent) return { status: "not-found" };
  if (inFlight.has(agentId)) return { status: "conflict" };
  inFlight.add(agentId);
  try {
    const run = startRun(agentId);
    return { status: "started", run };
  } catch (err) {
    inFlight.delete(agentId);
    throw err;
  }
}

/**
 * monitor-instance.mjs — AgentInstance runtime state + memory (MVP)
 *
 * Spec §4 AgentInstance:
 *   ├─ instanceId / monitorId
 *   ├─ status            idle | running | watch | error | disabled
 *   ├─ currentState      last flow node reached
 *   ├─ currentSituation  active situation title ("" when healthy)
 *   ├─ workingMemory     live investigation state (hypothesis/evidence/confidence)
 *   ├─ conversationMemory  → delegated to conversation.mjs (key `monitor:<id>`)
 *   ├─ incidentMemory    → persisted here (array of situations + outcomes)
 *   ├─ knowledgeMemory   → persisted here (operator-curated baselines/patterns)
 *   ├─ executionHistory  → delegated to run-store (agentId `monitor:<id>`)
 *   └─ agentLoop         → delegated to monitor-scheduler.mjs (cron tick)
 *
 * Lifecycle rule (spec): the UI tab only ATTACHES to the instance. Closing
 * a tab never touches this state; only DELETE /api/monitors/:id does.
 *
 * Persistence: data/monitor-state/<monitorId>.json — one file holds
 * status + lastRun/nextRun + the three memory slices. Written on every
 * state transition (small files, low frequency — no debounce needed).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from "fs";
import { resolve } from "path";
import { ROOT } from "./config.mjs";
import { safeResolve } from "./tool-loader.mjs";

const FILE_RE = /^[a-zA-Z0-9_-]+\.json$/;
const INCIDENTS_MAX = 200;
const KNOWLEDGE_MAX = 200;

function resolveStateDir() {
  const override = process.env.SRE_MONITOR_STATE_DIR;
  return override && override.trim() ? resolve(override) : resolve(ROOT, "data", "monitor-state");
}

/** In-memory live registry: monitorId → instance object (source of truth between writes). */
const registry = new Map();

function blankInstance(monitor) {
  return {
    instanceId: `agent-${monitor.id.slice(0, 8)}`,
    monitorId: monitor.id,
    monitorName: monitor.name,
    status: monitor.enabled === false ? "disabled" : "idle",
    currentState: "created",
    currentSituation: "",
    lastRunAt: null,
    lastRunResult: null,
    nextRunAt: null,
    runCount: 0,
    workingMemory: { hypothesis: "", evidence: [], confidence: null, updatedAt: null },
    knowledgeMemory: [],
    incidentMemory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function loadFromDisk(monitorId) {
  const dir = resolveStateDir();
  const file = safeResolve(dir, `${monitorId}.json`);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    return raw && typeof raw === "object" && raw.monitorId === monitorId ? raw : null;
  } catch {
    return null;
  }
}

function persist(instance) {
  const dir = resolveStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  instance.updatedAt = new Date().toISOString();
  writeFileSync(safeResolve(dir, `${instance.monitorId}.json`), JSON.stringify(instance, null, 2));
}

/**
 * Get (or lazily create) the AgentInstance for a monitor. The definition is
 * only read on first touch — later calls reuse the registry copy.
 * @param {object} monitor - monitor definition (from monitor-store)
 * @returns {object} instance
 */
export function getInstance(monitor) {
  if (!monitor || typeof monitor.id !== "string") throw new Error("getInstance requires a monitor definition");
  const existing = registry.get(monitor.id) || loadFromDisk(monitor.id);
  if (existing) {
    // Refresh cheap derived fields from the definition.
    existing.monitorName = monitor.name;
    if (monitor.enabled === false && existing.status === "idle") existing.status = "disabled";
    registry.set(monitor.id, existing);
    return existing;
  }
  const fresh = blankInstance(monitor);
  registry.set(monitor.id, fresh);
  persist(fresh);
  return fresh;
}

/** Registry-only lookup (no definition at hand) — null when unknown. */
export function peekInstance(monitorId) {
  return registry.get(monitorId) || null;
}

/**
 * Mutate an instance through a patch function, then persist atomically.
 * @param {string} monitorId
 * @param {(inst: object) => void} patchFn
 * @returns {object|null} updated instance (null when never created)
 */
export function updateInstance(monitorId, patchFn) {
  const inst = registry.get(monitorId) || loadFromDisk(monitorId);
  if (!inst) return null;
  patchFn(inst);
  persist(inst);
  registry.set(monitorId, inst);
  return inst;
}

/**
 * Record a completed run on the instance.
 * @param {string} monitorId
 * @param {{ok: boolean, situation?: string, summary?: string, working?: object}} result
 */
export function recordRun(monitorId, { ok, situation = "", summary = "", working = null, nextRunAt = null }) {
  return updateInstance(monitorId, inst => {
    inst.runCount += 1;
    inst.lastRunAt = new Date().toISOString();
    inst.lastRunResult = ok ? "success" : "failed";
    inst.status = ok ? (situation ? "watch" : "idle") : "error";
    inst.currentSituation = situation || "";
    inst.currentState = ok ? "sleep" : "error";
    if (nextRunAt) inst.nextRunAt = nextRunAt;
    if (working) inst.workingMemory = { ...working, updatedAt: new Date().toISOString() };
    // Situation closed and previously watching → summarize into incident memory.
    if (ok && !situation && inst.incidentMemory.length && inst.incidentMemory[inst.incidentMemory.length - 1].open) {
      inst.incidentMemory[inst.incidentMemory.length - 1].open = false;
      inst.incidentMemory[inst.incidentMemory.length - 1].closedAt = inst.lastRunAt;
    }
  });
}

/**
 * Append an incident to incident memory (called when a run produces a
 * meaningful situation). Keeps the newest INCIDENTS_MAX entries.
 */
export function appendIncident(monitorId, incident) {
  return updateInstance(monitorId, inst => {
    inst.incidentMemory.push({
      id: `inc-${Date.now().toString(36)}`,
      situation: incident.situation || "unspecified",
      severity: incident.severity || "P3",
      summary: incident.summary || "",
      confidence: typeof incident.confidence === "number" ? incident.confidence : null,
      recommendation: incident.recommendation || "",
      approvalRequired: incident.approvalRequired === true || /restart|rollback|scale|failover|config write/i.test(incident.recommendation || ""),
      open: true,
      createdAt: new Date().toISOString(),
    });
    if (inst.incidentMemory.length > INCIDENTS_MAX) inst.incidentMemory = inst.incidentMemory.slice(-INCIDENTS_MAX);
  });
}

/** Replace knowledge memory wholesale (settings editor). */
export function setKnowledge(monitorId, entries) {
  if (!Array.isArray(entries) || entries.length > KNOWLEDGE_MAX) throw new Error("knowledge must be a string[] (max 200)");
  return updateInstance(monitorId, inst => { inst.knowledgeMemory = entries.filter(e => typeof e === "string" && e.trim().length > 0); });
}

/** Remove all persisted state for a monitor (called on monitor delete). */
export function destroyInstance(monitorId) {
  registry.delete(monitorId);
  const dir = resolveStateDir();
  const file = safeResolve(dir, `${monitorId}.json`);
  if (existsSync(file)) {
    unlinkSync(file);
    return true;
  }
  return false;
}

/** List state files (diagnostics). */
export function listInstanceStateFiles() {
  const dir = resolveStateDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => FILE_RE.test(f));
}

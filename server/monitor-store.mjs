/**
 * monitor-store.mjs — MonitorDefinition persistence (SRE Agentic Monitoring MVP)
 *
 * Spec §4 domain model:
 *   MonitorDefinition
 *   ├─ id / name / description
 *   ├─ Scheduler          { triggerType, cron, timezone, timeoutMinutes, overlapPolicy, retry }
 *   ├─ SourceMCP[]        { id, type, resource, tools[] }
 *   ├─ ProcessFlow        { templateId }
 *   ├─ AgentConfiguration { agentName, role, mission, rules[], prompt, skills[] }
 *   ├─ MemoryPolicy       { persistKnowledge, persistIncidents, workingMemoryTtlRuns }
 *   └─ OutputMCP[]        { id, type, target, approvalRequired }
 *
 * Persistence: one JSON file per monitor under data/monitors/<id>.json.
 * Follows agent-store.mjs conventions: store-owned ids (randomUUID),
 * filename whitelist + safeResolve traversal defense, asymmetric reads
 * (list skips bad files, get throws), plain-Error validation.
 *
 * The AgentInstance (runtime state) lives in monitor-instance.mjs — this
 * module is pure definition persistence.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
import { resolve } from "path";
import { ROOT } from "./config.mjs";
import { safeResolve } from "./tool-loader.mjs";
import { getFlowTemplate, defaultMonitorPrompt, defaultMonitorRules, DEFAULT_SKILLS } from "./monitor-flows.mjs";

/** Whitelist for monitor ids used as filenames (traversal layer 1). */
const FILENAME_SAFE_RE = /^[a-zA-Z0-9_-]+$/;
/** Only `<safe-id>.json` files count as monitors (excludes tmp/README/dotfiles). */
const MONITOR_FILE_RE = /^[a-zA-Z0-9_-]+\.json$/;

const NAME_MAX = 100;
const RESOURCE_MAX = 500;
const PROMPT_MAX = 20_000;
const SCHEDULE_PRESETS = {
  "every-1m": "* * * * *",
  "every-5m": "*/5 * * * *",
  "every-15m": "*/15 * * * *",
  "every-30m": "*/30 * * * *",
  "hourly": "0 * * * *",
};
/** Source types map onto the existing tool providers (MCP-equivalents). */
const SOURCE_TYPES = ["grafana", "prometheus", "loki", "k8s", "tchat", "docs", "security", "shell", "custom"];
const OUTPUT_TYPES = ["chat", "incident", "notification", "ticket", "action"];
const TRIGGER_TYPES = ["interval", "cron", "event-fallback"];
const OVERLAP_POLICIES = ["skip", "queue"];

function resolveMonitorsDir() {
  const override = process.env.SRE_MONITORS_DIR;
  return override && override.trim() ? resolve(override) : resolve(ROOT, "data", "monitors");
}

/** @returns {string} cron expression for a preset id, or null */
export function presetToCron(presetId) {
  return SCHEDULE_PRESETS[presetId] || null;
}

/** @returns {Record<string,string>} preset id → cron (for UI pickers) */
export function listSchedulePresets() {
  return { ...SCHEDULE_PRESETS };
}

function isNonEmptyString(v, max = 5_000) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

function isStringArray(v, max = 100, itemMax = 1_000) {
  return Array.isArray(v) && v.every(x => typeof x === "string" && x.length <= itemMax) && v.length <= max;
}

/** Validate + normalize a SourceMCP entry. Throws on invalid shape. */
function normalizeSource(src, idx) {
  if (!src || typeof src !== "object") throw new Error(`SourceMCP[${idx}] must be an object`);
  const type = typeof src.type === "string" ? src.type : "";
  if (!SOURCE_TYPES.includes(type)) {
    throw new Error(`SourceMCP[${idx}].type must be one of: ${SOURCE_TYPES.join(", ")}`);
  }
  const resource = typeof src.resource === "string" ? src.resource.trim() : "";
  if (!resource || resource.length > RESOURCE_MAX) {
    throw new Error(`SourceMCP[${idx}].resource is required (1..${RESOURCE_MAX} chars)`);
  }
  const tools = Array.isArray(src.tools) ? src.tools.filter(t => typeof t === "string") : [];
  return { id: typeof src.id === "string" && src.id ? src.id : `src-${randomUUID().slice(0, 8)}`, type, resource, tools };
}

/** Validate + normalize an OutputMCP entry. */
function normalizeOutput(out, idx) {
  if (!out || typeof out !== "object") throw new Error(`OutputMCP[${idx}] must be an object`);
  const type = typeof out.type === "string" ? out.type : "";
  if (!OUTPUT_TYPES.includes(type)) {
    throw new Error(`OutputMCP[${idx}].type must be one of: ${OUTPUT_TYPES.join(", ")}`);
  }
  const target = typeof out.target === "string" ? out.target.trim() : "";
  if (!target) throw new Error(`OutputMCP[${idx}].target is required (e.g. channel id)`);
  return {
    id: typeof out.id === "string" && out.id ? out.id : `out-${randomUUID().slice(0, 8)}`,
    type,
    target,
    approvalRequired: type === "action" ? true : out.approvalRequired === true,
  };
}

/**
 * Validate + normalize a full MonitorDefinition payload (create or update).
 * Returns the normalized record WITHOUT id/timestamps (caller merges).
 * @param {object} input
 * @returns {object}
 */
function normalizeMonitor(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Monitor must be a JSON object");
  }
  if (!isNonEmptyString(input.name, NAME_MAX)) throw new Error("Missing or invalid field: name");

  // ── Scheduler ──
  const rawSched = input.scheduler || {};
  const triggerType = TRIGGER_TYPES.includes(rawSched.triggerType) ? rawSched.triggerType : "interval";
  let cron = typeof rawSched.cron === "string" ? rawSched.cron.trim() : "";
  // Interval presets may arrive as preset ids ("every-5m") — resolve to cron.
  if (SCHEDULE_PRESETS[cron]) cron = SCHEDULE_PRESETS[cron];
  if (!cron) cron = SCHEDULE_PRESETS["every-5m"];
  if (!/^[0-9*/,\-\s]+$/.test(cron) || cron.split(/\s+/).filter(Boolean).length !== 5) {
    throw new Error("scheduler.cron must be a 5-field cron expression");
  }
  const scheduler = {
    triggerType,
    cron,
    timezone: typeof rawSched.timezone === "string" && rawSched.timezone ? rawSched.timezone : "Asia/Taipei",
    timeoutMinutes: Number.isInteger(rawSched.timeoutMinutes) && rawSched.timeoutMinutes > 0 && rawSched.timeoutMinutes <= 60 ? rawSched.timeoutMinutes : 3,
    overlapPolicy: OVERLAP_POLICIES.includes(rawSched.overlapPolicy) ? rawSched.overlapPolicy : "skip",
    retry: Number.isInteger(rawSched.retry) && rawSched.retry >= 0 && rawSched.retry <= 5 ? rawSched.retry : 0,
  };

  // ── SourceMCP[] (at least one — the agent's observable world) ──
  const rawSources = Array.isArray(input.sourceMCPs) ? input.sourceMCPs : [];
  if (rawSources.length === 0) throw new Error("At least one SourceMCP is required");
  if (rawSources.length > 5) throw new Error("At most 5 SourceMCPs per monitor");
  const sourceMCPs = rawSources.map(normalizeSource);

  // ── ProcessFlow (template id; unknown → standard) ──
  const flowTemplate = getFlowTemplate(typeof input.processFlow === "object" && input.processFlow ? input.processFlow.templateId : "standard-sre");
  const processFlow = { templateId: flowTemplate.id };

  // ── AgentConfiguration ──
  const rawAgent = input.agentConfig || {};
  const agentConfig = {
    agentName: isNonEmptyString(rawAgent.agentName, NAME_MAX) ? rawAgent.agentName.trim() : `${input.name.trim()} Agent`,
    role: isNonEmptyString(rawAgent.role, 200) ? rawAgent.role.trim() : "Production Monitoring Agent",
    mission: typeof rawAgent.mission === "string" ? rawAgent.mission.slice(0, 4_000) : "",
    rules: isStringArray(rawAgent.rules) ? rawAgent.rules : defaultMonitorRules(),
    prompt: typeof rawAgent.prompt === "string" && rawAgent.prompt.trim() ? rawAgent.prompt.slice(0, PROMPT_MAX) : defaultMonitorPrompt(),
    skills: isStringArray(rawAgent.skills) ? rawAgent.skills : [...DEFAULT_SKILLS],
  };

  // ── MemoryPolicy ──
  const rawMem = input.memoryPolicy || {};
  const memoryPolicy = {
    persistKnowledge: rawMem.persistKnowledge !== false,
    persistIncidents: rawMem.persistIncidents !== false,
    workingMemoryTtlRuns: Number.isInteger(rawMem.workingMemoryTtlRuns) && rawMem.workingMemoryTtlRuns >= 0 ? rawMem.workingMemoryTtlRuns : 20,
  };

  // ── OutputMCP[] (may be empty = report only in chat) ──
  const rawOutputs = Array.isArray(input.outputMCPs) ? input.outputMCPs : [];
  if (rawOutputs.length > 5) throw new Error("At most 5 OutputMCPs per monitor");
  const outputMCPs = rawOutputs.map(normalizeOutput);

  return {
    name: input.name.trim(),
    description: typeof input.description === "string" ? input.description.slice(0, 2_000) : "",
    scheduler,
    sourceMCPs,
    processFlow,
    agentConfig,
    memoryPolicy,
    outputMCPs,
    enabled: input.enabled === false ? false : true,
  };
}

/**
 * List all monitors. Unreadable files are skipped with a warning (one bad
 * file must not blank the registry).
 * @returns {object[]}
 */
export function listMonitors() {
  const dir = resolveMonitorsDir();
  if (!existsSync(dir)) return [];
  const out = [];
  for (const fname of readdirSync(dir)) {
    if (!MONITOR_FILE_RE.test(fname)) continue;
    try {
      const raw = JSON.parse(readFileSync(resolve(dir, fname), "utf-8"));
      if (raw && typeof raw === "object" && typeof raw.id === "string") out.push(raw);
    } catch (err) {
      console.warn(`[monitor-store] skipping unreadable ${fname}: ${err.message}`);
    }
  }
  out.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  return out;
}

/**
 * Get one monitor by id. Throws on invalid/corrupt ids, returns null when
 * the monitor does not exist.
 * @param {string} id
 * @returns {object|null}
 */
export function getMonitor(id) {
  if (typeof id !== "string" || !FILENAME_SAFE_RE.test(id)) {
    throw new Error(`Invalid monitor id: ${id}`);
  }
  const file = safeResolve(resolveMonitorsDir(), `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8"));
}

/**
 * Create a monitor (id + timestamps are store-owned).
 * @param {object} input
 * @returns {object} the created record
 */
export function createMonitor(input) {
  const normalized = normalizeMonitor(input);
  const dir = resolveMonitorsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const record = { id: randomUUID(), ...normalized, createdAt: now, updatedAt: now };
  const file = safeResolve(dir, `${record.id}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

/**
 * Update a monitor. Unknown id → throws "Monitor not found: <id>" (callers
 * map that to 404). Validation identical to create.
 * @param {string} id
 * @param {object} input
 * @returns {object} the updated record
 */
export function updateMonitor(id, input) {
  const existing = getMonitor(id); // throws on invalid id shape
  if (!existing) throw new Error(`Monitor not found: ${id}`);
  const normalized = normalizeMonitor(input);
  const record = { ...existing, ...normalized, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
  const file = safeResolve(resolveMonitorsDir(), `${id}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

/**
 * Delete a monitor. Returns true when deleted, false when not found.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteMonitor(id) {
  if (typeof id !== "string" || !FILENAME_SAFE_RE.test(id)) {
    throw new Error(`Invalid monitor id: ${id}`);
  }
  const file = safeResolve(resolveMonitorsDir(), `${id}.json`);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

/** Source type whitelist (for route validation / UI pickers). */
export function listSourceTypes() {
  return [...SOURCE_TYPES];
}

/** Output type whitelist. */
export function listOutputTypes() {
  return [...OUTPUT_TYPES];
}

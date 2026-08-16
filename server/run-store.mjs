/**
 * run-store.mjs — File-based Agent Run history persistence (TASK-004)
 *
 * Every agent execution is appended as one JSON file:
 *   runs/<agentId>/<runId>.json
 *
 * A run record looks like:
 *   {
 *     id, agentId,
 *     status: "running" | "success" | "failed",
 *     startedAt, finishedAt, durationMs,
 *     summary,        // LLM final conclusion (success runs)
 *     notified,       // whether the notifyTarget was messaged
 *     toolCalls,      // [{ name, durationMs }] summary per tool invocation
 *     error           // failure reason (failed runs)
 *   }
 *
 * Lifecycle: scheduler/agent-loop calls startRun() before execution, then
 * finishRun() once with the outcome. This module is pure persistence —
 * no scheduling, no LLM, no HTTP concepts (validation errors throw plain
 * Error for the route layer to map).
 *
 * Design notes (follows agent-store.mjs TASK-001 patterns):
 * - Only 4 functions exported: startRun, finishRun, listRuns, getRun.
 * - runId = `<compact-UTC-timestamp>-<random hex>` — lexicographic order
 *   equals chronological order, and the suffix keeps ids collision-free
 *   when two agents start within the same millisecond.
 * - External ids (agentId, runId) get double traversal protection:
 *   FILENAME_SAFE_RE whitelist + safeResolve() from tool-loader.mjs.
 * - Atomic writes via `.tmp` + renameSync, same as agent-store.
 * - Asymmetric reads: listRuns skips corrupt files (one bad file can't
 *   blank the history), getRun throws on a corrupt file (fail loudly).
 * - SRE_RUNS_DIR env var relocates the directory (tests point it at a
 *   temp dir). Absolute env values are trusted as operator config.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync } from "fs";
import { randomBytes } from "crypto";
import { isAbsolute, dirname } from "path";
import { ROOT } from "./config.mjs";
import { safeResolve } from "./tool-loader.mjs";

/** Whitelist for external ids used as path segments (rejects `..`, `/`, `\`, `%`, dots). */
const FILENAME_SAFE_RE = /^[a-zA-Z0-9_-]+$/;
/** Only files shaped like `<safe-id>.json` are treated as runs (excludes `*.json.tmp`, dotfiles). */
const RUN_FILE_RE = /^[a-zA-Z0-9_-]+\.json$/;
/** Cap for the stored `summary` — it is an LLM conclusion digest, not a transcript. */
const SUMMARY_MAX_LENGTH = 4000;
/** Cap for the `error` message — keeps a stack-trace-shaped string from bloating the record. */
const ERROR_MAX_LENGTH = 2000;
const RUN_STATUSES = new Set(["running", "success", "failed"]);

function resolveRunsDir() {
  const override = process.env.SRE_RUNS_DIR;
  if (override && isAbsolute(override)) return override;
  return safeResolve(ROOT, override || "runs");
}

const RUNS_DIR = resolveRunsDir();

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Validate an external id (agentId or runId) against the filename whitelist.
 * Combined with safeResolve() below this gives double-layer path traversal
 * protection.
 * @param {string} id
 * @param {string} label - field name used in the error message
 * @returns {string}
 * @throws {Error} If the id is not a string of [a-zA-Z0-9_-].
 */
function assertFilenameSafeId(id, label) {
  if (typeof id !== "string" || !FILENAME_SAFE_RE.test(id)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * Build the on-disk path for a run with double traversal protection:
 * whitelist regex first, then safeResolve anchoring under RUNS_DIR.
 * @param {string} agentId
 * @param {string} runId
 * @returns {string}
 */
function runFilePath(agentId, runId) {
  assertFilenameSafeId(agentId, "agentId");
  assertFilenameSafeId(runId, "run id");
  return safeResolve(safeResolve(RUNS_DIR, agentId), `${runId}.json`);
}

/**
 * Generate a fresh run id: `<YYYYMMDDTHHMMSS-SSS>-<hex8>` in UTC.
 * Fixed-width fields keep lexicographic sort == chronological sort.
 * @returns {string}
 */
function newRunId() {
  const now = new Date();
  const pad = (n, w) => String(n).padStart(w, "0");
  const compact =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}` +
    `T${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}` +
    `-${pad(now.getUTCMilliseconds(), 3)}`;
  return `${compact}-${randomBytes(4).toString("hex")}`;
}

/**
 * Normalize a toolCalls summary: keep only { name, durationMs } per entry,
 * drop malformed elements instead of throwing (best-effort telemetry).
 * @param {unknown} value
 * @returns {{name: string, durationMs: number}[]}
 */
function normalizeToolCalls(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(c => c && typeof c === "object" && typeof c.name === "string")
    .map(c => ({
      name: c.name,
      durationMs: typeof c.durationMs === "number" && Number.isFinite(c.durationMs) ? c.durationMs : null,
    }));
}

/**
 * Read one run file. Missing file → null; corrupt JSON → throws
 * (asymmetric with listRuns, which skips corrupt files).
 * @param {string} filePath
 * @returns {object|null}
 */
function readRunFile(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/** Atomic write: `<id>.json.tmp` then renameSync (POSIX/NTFS atomic within a dir). */
function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, filePath);
}

/**
 * List the per-agent run directories under RUNS_DIR.
 * Directory names come from the filesystem, but each is still routed
 * through safeResolve before any read.
 * @returns {string[]}
 */
function agentDirs() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => safeResolve(RUNS_DIR, e.name));
}

/**
 * Locate the file for a run id by scanning agent directories.
 * @param {string} runId - already whitelist-validated
 * @returns {string|null} file path, or null when not found
 */
function findRunFile(runId) {
  for (const dir of agentDirs()) {
    const filePath = safeResolve(dir, `${runId}.json`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

/**
 * Start a run: writes a `status: "running"` record and returns it.
 * The store owns `id` / `startedAt` / `finishedAt` / `durationMs`; caller
 * input for those is ignored.
 * @param {string} agentId
 * @returns {{id: string, agentId: string, status: "running", startedAt: string,
 *            finishedAt: null, durationMs: null, summary: string,
 *            notified: boolean, toolCalls: {name:string,durationMs:number}[], error: null}}
 * @throws {Error} On invalid/traversal agentId.
 */
export function startRun(agentId) {
  assertFilenameSafeId(agentId, "agentId");
  const run = {
    id: newRunId(),
    agentId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    summary: "",
    notified: false,
    toolCalls: [],
    error: null,
  };
  const filePath = runFilePath(agentId, run.id);
  ensureDir(dirname(filePath));
  atomicWriteJson(filePath, run);
  return run;
}

/**
 * Finish a run: patches status/outcome fields onto the stored record.
 * Missing run → throws with 404-flavored wording for the route layer.
 *
 * @param {string} runId
 * @param {Object} result
 * @param {"success"|"failed"} result.status - required terminal status
 * @param {string} [result.summary] - LLM final conclusion (success runs)
 * @param {string} [result.error] - failure reason (failed runs)
 * @param {Array} [result.toolCalls] - per-tool summary entries
 * @param {boolean} [result.notified] - whether notifyTarget was messaged
 * @returns {object} The updated run record.
 * @throws {Error} On invalid id, missing run, or bad status.
 */
export function finishRun(runId, result = {}) {
  assertFilenameSafeId(runId, "run id");
  if (!RUN_STATUSES.has(result.status) || result.status === "running") {
    throw new Error(`finishRun requires status "success" or "failed" (got ${JSON.stringify(result.status)})`);
  }

  const filePath = findRunFile(runId);
  if (!filePath) throw new Error(`Run not found: ${runId}`);
  const run = readRunFile(filePath); // corrupt file → throws (specific read fails loudly)

  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(run.startedAt));

  const updated = {
    ...run,
    status: result.status,
    finishedAt,
    durationMs,
    summary: typeof result.summary === "string" ? result.summary.slice(0, SUMMARY_MAX_LENGTH) : run.summary,
    // `error` belongs to failed runs only; a success run always ends up null.
    error: result.status === "failed" && typeof result.error === "string"
      ? result.error.slice(0, ERROR_MAX_LENGTH)
      : null,
    toolCalls: result.toolCalls !== undefined ? normalizeToolCalls(result.toolCalls) : run.toolCalls,
    notified: typeof result.notified === "boolean" ? result.notified : run.notified,
  };
  atomicWriteJson(filePath, updated);
  return updated;
}

/**
 * List runs as summaries (no toolCalls array / error — those live in getRun).
 * Sorted by startedAt descending (newest first — this is a log).
 * Tolerant read: missing dir → [], corrupt JSON → warn + skip.
 *
 * @param {{agentId?: string}} [filter] - restrict to one agent's runs
 * @returns {{id, agentId, status, startedAt, finishedAt, durationMs,
 *            summary, notified, toolCallCount}[]}
 * @throws {Error} On an invalid/traversal agentId filter.
 */
export function listRuns(filter = {}) {
  const dirs = [];
  if (filter.agentId !== undefined && filter.agentId !== null && filter.agentId !== "") {
    assertFilenameSafeId(filter.agentId, "agentId");
    dirs.push(safeResolve(RUNS_DIR, filter.agentId));
  } else {
    dirs.push(...agentDirs());
  }

  const runs = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!RUN_FILE_RE.test(file)) continue;
      try {
        const run = JSON.parse(readFileSync(safeResolve(dir, file), "utf-8"));
        runs.push({
          id: run.id,
          agentId: run.agentId,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs,
          summary: run.summary,
          notified: run.notified,
          toolCallCount: Array.isArray(run.toolCalls) ? run.toolCalls.length : 0,
        });
      } catch (err) {
        console.warn(`[run-store] Skipping unreadable run file "${file}": ${err.message}`);
      }
    }
  }
  return runs.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

/**
 * Get the full run record by id (scans agent directories).
 * @param {string} runId
 * @returns {object|null} null when not found.
 * @throws {Error} On invalid/traversal id or corrupt JSON.
 */
export function getRun(runId) {
  assertFilenameSafeId(runId, "run id");
  const filePath = findRunFile(runId);
  if (!filePath) return null;
  return readRunFile(filePath);
}

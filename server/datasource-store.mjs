/**
 * datasource-store.mjs — File-based Datasource Registry persistence (TASK-011)
 *
 * Single source of truth for external datasource connections:
 *   datasources/<id>.json — one JSON file per datasource
 *
 * A datasource couples a connection endpoint with an optional secret:
 *   { id, url, token?, settings?, createdAt, updatedAt }
 * where `id` is a caller-chosen slug that ALSO names the tool provider dir
 * (tools/<id>/) when the datasource backs a registered tool. Saving a
 * datasource hot-syncs the mapped config into tools/<id>/config.json so
 * providers (e.g. grafana) pick up new values without a server restart
 * (grafana's handler re-reads its config on every call — see TASK-011 note
 * in tools/grafana/handler.mjs).
 *
 * Design notes (mirrors agent-store.mjs, TASK-001 SA review):
 * - Only 4 functions exported: listDatasources, getDatasource,
 *   saveDatasource, deleteDatasource (+ TOKEN_MASK constant for routes).
 * - Validation failures throw plain Error — no HTTP concepts here.
 * - External ids get double protection: filename whitelist regex
 *   + safeResolve() imported from tool-loader.mjs (not duplicated).
 * - Atomic write: <id>.json.tmp → renameSync, so a crash mid-write never
 *   leaves a half-written registry file.
 *
 * Secret handling (TASK-011 security requirements):
 * - Tokens are persisted in plaintext on disk because tool handlers need
 *   the real value to authenticate. datasources/ and tools/<name>/config.json
 *   are gitignored — never commit them.
 * - This module NEVER logs tokens (no console.* with payload contents);
 *   validation error messages name the offending field, never its value.
 * - API responses must mask tokens at the route layer (TOKEN_MASK). This
 *   store layer intentionally has no presentation concepts; treat every
 *   value returned here as internal-only.
 * - Tokens stay out of run logs and agent prompts by construction: the
 *   agent loop never reads this store, and the scheduler/run-store only
 *   records agent ids.
 * - Update semantics: a `token` of "***" (the mask round-trip from the UI),
 *   empty, or missing means "keep the stored value" — the API cannot
 *   echo back plaintext, so it can never send it back in either.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, readdirSync } from "fs";
import { dirname } from "path";
import { isAbsolute } from "path";
import { ROOT } from "./config.mjs";
import { safeResolve } from "./tool-loader.mjs";

/** The mask the API layer substitutes for tokens in every response. */
export const TOKEN_MASK = "***";

const ID_MAX_LENGTH = 64;
const URL_MAX_LENGTH = 2048;
const TOKEN_MAX_LENGTH = 4096;

/** Whitelist for datasource ids used as filenames (first traversal layer). */
const ID_SAFE_RE = /^[a-zA-Z0-9_-]+$/;
/** Only files shaped like `<safe-id>.json` are datasources (excludes `*.json.tmp`, dotfiles). */
const DS_FILE_RE = /^[a-zA-Z0-9_-]+\.json$/;

/**
 * Per-tool config format adapters. Each maps a datasource onto the config
 * shape its tools/<id>/handler.mjs actually reads. Tools not listed fall
 * back to the common { url, token } shape (prometheus/loki style).
 */
const TOOL_CONFIG_MAPPERS = {
  grafana: (ds) => ({
    grafana_url: ds.url,
    ...(ds.token ? { grafana_token: ds.token } : {}),
    ...(ds.settings || {}),
  }),
};

const DEFAULT_TOOL_CONFIG_MAPPER = (ds) => ({
  url: ds.url,
  ...(ds.token ? { token: ds.token } : {}),
  ...(ds.settings || {}),
});

function resolveDatasourcesDir() {
  const override = process.env.SRE_DATASOURCES_DIR;
  if (override && isAbsolute(override)) return override;
  return safeResolve(ROOT, override || "datasources");
}

const DATASOURCES_DIR = resolveDatasourcesDir();

/**
 * Root that tool handlers resolve their config against. MUST mirror the
 * resolution in tools/grafana/handler.mjs (`PAAW_ROOT || SRE_ROOT || repo
 * root`) so the file this store writes is exactly the file handlers read.
 */
function toolRoot() {
  const override = process.env.PAAW_ROOT || process.env.SRE_ROOT;
  if (override && isAbsolute(override)) return override;
  return ROOT;
}

/** On-disk path of the synced tool config for a datasource id. */
function toolConfigPath(id) {
  return safeResolve(toolRoot(), "tools", id, "config.json");
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Validate an external datasource id against the filename whitelist.
 * Combined with safeResolve() in datasourceFilePath() this gives
 * double-layer path traversal protection (regex rejects `..`, `/`, `\`,
 * `%`, dots, empty).
 * @param {string} id
 * @returns {string}
 * @throws {Error} If the id is not a string of [a-zA-Z0-9_-] (max 64).
 */
function assertSafeId(id) {
  if (typeof id !== "string" || !ID_SAFE_RE.test(id) || id.length > ID_MAX_LENGTH) {
    throw new Error(`Invalid datasource id: ${JSON.stringify(id)}`);
  }
  return id;
}

/** Build the on-disk path for a datasource id (double traversal protection). */
function datasourceFilePath(id) {
  assertSafeId(id);
  return safeResolve(DATASOURCES_DIR, `${id}.json`);
}

/**
 * Read one datasource file. Missing → null; corrupt JSON → throws
 * (asymmetric with listDatasources, which skips corrupt files).
 */
function readDatasourceFile(id) {
  const filePath = datasourceFilePath(id);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/** Validate a URL string: parseable and http(s) only. */
function assertValidUrl(url) {
  if (typeof url !== "string" || url.length === 0 || url.length > URL_MAX_LENGTH) {
    throw new Error("Datasource url must be a non-empty string");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Datasource url is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Datasource url protocol must be http: or https:");
  }
}

/** Validate an optional token field. */
function assertValidToken(token) {
  if (token === undefined || token === null || token === "") return;
  if (typeof token !== "string" || token.length > TOKEN_MAX_LENGTH) {
    throw new Error("Datasource token must be a string");
  }
}

/** Validate the optional settings bag: JSON-safe scalars/objects only. */
function assertValidSettings(settings) {
  if (settings === undefined || settings === null) return;
  if (typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Datasource settings must be an object");
  }
  const ok = (v) => {
    if (v === null) return true;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return true;
    if (t === "object" && !Array.isArray(v)) return Object.values(v).every(ok);
    return false;
  };
  if (!Object.values(settings).every(ok)) {
    throw new Error("Datasource settings values must be JSON scalars or objects");
  }
}

/**
 * Write the mapped tool config next to the handler that consumes it.
 * No-op when tools/<id>/ does not exist (the datasource is not bound to a
 * registered tool provider) — we never create tool dirs from here.
 */
function syncToolConfig(ds) {
  let configPath;
  try {
    configPath = toolConfigPath(ds.id);
  } catch {
    return; // root override broken — datasource itself still saved above
  }
  if (!existsSync(dirname(configPath))) return;
  const mapper = TOOL_CONFIG_MAPPERS[ds.id] || DEFAULT_TOOL_CONFIG_MAPPER;
  const content = `${JSON.stringify(mapper(ds), null, 2)}\n`;
  const tmpPath = `${configPath}.tmp`;
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, configPath);
}

/** Atomic JSON write shared by the registry file itself. */
function atomicWrite(filePath, obj) {
  ensureDir(dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(obj, null, 2));
  renameSync(tmpPath, filePath);
}

/**
 * List all datasources, sorted by creation time (oldest first).
 * Unreadable/corrupt files are skipped with a warning that never includes
 * file contents, so one bad file can't blank the registry.
 * ⚠️ Returned objects contain plaintext tokens — internal use only.
 * @returns {Object[]}
 */
export function listDatasources() {
  ensureDir(DATASOURCES_DIR);
  const out = [];
  for (const f of readdirSync(DATASOURCES_DIR)) {
    if (!DS_FILE_RE.test(f)) continue;
    const filePath = safeResolve(DATASOURCES_DIR, f);
    try {
      const ds = JSON.parse(readFileSync(filePath, "utf-8"));
      if (ds && typeof ds === "object" && typeof ds.id === "string") out.push(ds);
    } catch {
      console.warn(`[datasource-store] skipping unreadable file: ${f}`);
    }
  }
  return out.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

/**
 * Get a single datasource by id.
 * Missing → null. Corrupt file → throws (specific reads fail loudly).
 * ⚠️ The returned object may contain a plaintext token — internal use only.
 * @param {string} id
 * @returns {Object|null}
 * @throws {Error} On invalid/traversal id or corrupt JSON.
 */
export function getDatasource(id) {
  return readDatasourceFile(id);
}

/**
 * Create or update a datasource. `input.id` selects the target; on update
 * every present field is merged over the stored one (partial patch).
 *
 * Token round-trip rule: on update, a `token` that is missing, empty, or
 * the TOKEN_MASK placeholder keeps the stored value — the API only ever
 * shows the mask, so a client echoing the form back must not clobber the
 * secret. Setting a new non-mask string rotates it.
 *
 * After a successful save the mapped tools/<id>/config.json is hot-synced
 * (when the tool dir exists).
 * @param {Object} input - { id, url, token?, settings? }
 * @returns {Object} The stored datasource (may contain a plaintext token —
 *                   internal use only; the route layer masks it).
 * @throws {Error} On schema violation or invalid id.
 */
export function saveDatasource(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("saveDatasource expects a datasource object");
  }

  const id = assertSafeId(input.id);
  assertValidUrl(input.url);
  assertValidToken(input.token);
  assertValidSettings(input.settings);

  const stored = readDatasourceFile(id);
  const now = new Date().toISOString();

  // Token merge rule (see function doc). On create, "***" as a literal
  // first-time token is rejected-taken-as-empty: it can only have come
  // from echoing a masked response back.
  let token;
  if (input.token !== undefined && input.token !== null && input.token !== "" && input.token !== TOKEN_MASK) {
    token = input.token;
  } else if (stored) {
    token = stored.token;
  } else {
    token = "";
  }

  const ds = {
    id,
    url: input.url,
    ...(token ? { token } : {}),
    ...(input.settings !== undefined && input.settings !== null ? { settings: input.settings } : (stored?.settings ? { settings: stored.settings } : {})),
    ...(stored?.createdAt ? { createdAt: stored.createdAt } : { createdAt: now }),
    updatedAt: now,
  };

  atomicWrite(datasourceFilePath(id), ds);
  syncToolConfig(ds);
  return ds;
}

/**
 * Delete a datasource and its synced tool config (if any) — the registry
 * is the single source of truth for that file.
 * @param {string} id
 * @returns {boolean} true if a datasource was deleted, false if not found.
 * @throws {Error} On invalid/traversal id.
 */
export function deleteDatasource(id) {
  assertSafeId(id);
  const filePath = datasourceFilePath(id);
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);

  // Best-effort cleanup of the synced tool config; failures must not
  // resurrect the deleted registry entry.
  try {
    const configPath = toolConfigPath(id);
    if (existsSync(configPath)) unlinkSync(configPath);
  } catch {
    // ignore — config may be absent or root misconfigured
  }
  return true;
}

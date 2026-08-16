/**
 * conversation.mjs — Simple file-based conversation storage
 *
 * Stores chat history per crew member + session.
 *   data/conversations/<crewId>/active.json
 *   data/conversations/<crewId>/s-<timestamp>.json  (archived)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const CONV_DIR = resolve(ROOT, "data/conversations");

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Reject crew/session ids that could escape the conversations dir */
function sanitizeId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid id: ${String(id)}`);
  }
  return id;
}

/** Load active conversation */
export function loadConversation(crewId) {
  sanitizeId(crewId);
  const dir = join(CONV_DIR, crewId);
  const activeFile = join(dir, "active.json");
  if (!existsSync(activeFile)) return [];
  try {
    const data = JSON.parse(readFileSync(activeFile, "utf-8"));
    return data.messages || [];
  } catch {
    return [];
  }
}

/** Save conversation */
export function saveConversation(crewId, messages) {
  sanitizeId(crewId);
  const dir = join(CONV_DIR, crewId);
  ensureDir(dir);
  writeFileSync(join(dir, "active.json"), JSON.stringify({ messages, updatedAt: new Date().toISOString() }, null, 2));
}

/** Archive current conversation + start fresh */
export function archiveConversation(crewId) {
  sanitizeId(crewId);
  const dir = join(CONV_DIR, crewId);
  const activeFile = join(dir, "active.json");
  if (!existsSync(activeFile)) return null;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveFile = join(dir, `s-${ts}.json`);
  try {
    const data = readFileSync(activeFile, "utf-8");
    writeFileSync(archiveFile, data);
    writeFileSync(activeFile, JSON.stringify({ messages: [], updatedAt: new Date().toISOString() }));
    return ts;
  } catch {
    return null;
  }
}

/** List archived sessions */
export function listArchives(crewId) {
  sanitizeId(crewId);
  const dir = join(CONV_DIR, crewId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.startsWith("s-") && f.endsWith(".json"))
    .map(f => {
      try {
        const data = JSON.parse(readFileSync(join(dir, f), "utf-8"));
        return {
          sessionId: f.replace(".json", ""),
          messageCount: (data.messages || []).length,
          updatedAt: data.updatedAt,
          preview: data.messages?.[0]?.content?.slice(0, 80) || "",
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

/** Load archived session */
export function loadArchive(crewId, sessionId) {
  sanitizeId(crewId);
  sanitizeId(sessionId);
  const dir = join(CONV_DIR, crewId);
  const file = join(dir, `${sessionId}.json`);
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"));
    return data.messages || [];
  } catch {
    return [];
  }
}

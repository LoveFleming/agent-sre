/**
 * types.ts — Shared types for the Agent SRE Platform UI
 */

// ── Navigation ──

export type ViewId =
  | "home"
  | "agents"
  | "tools"
  | "monitor"
  | "console"
  | "config";

export interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  badge?: string; // "soon" | "new" | number
}

// ── Server data ──

export interface Crew {
  id: string;
  title: string;
  codename?: string;
  emoji?: string;
  description?: string;
  expertise?: string;
  imageUrl?: string;
  greeting?: string;
}

export interface ChatMsg {
  role: "user" | "assistant" | "tool";
  content: string;
  ts?: string;
}

export interface ToolEntry {
  name: string;
  definition: {
    function: {
      name: string;
      description: string;
      parameters: {
        type?: string;
        properties?: Record<string, { type?: string }>;
        required?: string[];
      };
    };
  };
  source?: string; // "provider:grafana" etc.
}

export interface ChatTab {
  crewId: string;
  title: string;
  emoji: string;
  messages: ChatMsg[];
}

export interface HealthInfo {
  status: string;
  uptime?: number;
  tools?: string[];
}

// ── Agent management (supersedes Task — /api/agents, TASK-003) ──

export interface AgentRules {
  guardrails: string[];
  redirectRules: string[];
  refuseTopics: string[];
}

/** Where a scheduled agent's report gets delivered (tchat user or channel). */
export interface NotifyTarget {
  targetType: "user" | "channel";
  targetId: string;
}

/** A persisted agent — mirrors server/agent-store.mjs `Agent` schema. */
export interface Agent {
  id: string;
  name: string;
  description: string;
  context: string;
  prompt: string;
  agentRules: AgentRules;
  allowedTools: string[];
  /** 5-field cron expression (`min hour dom mon dow`) or null = manual only. */
  schedule: string | null;
  notifyTarget: NotifyTarget;
  /** Minimum minutes between scheduled runs. */
  cooldownMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Factory for a blank agent draft (used by the "New Agent" button). */
export function emptyAgentDraft(): Agent {
  return {
    id: "",
    name: "",
    description: "",
    context: "",
    prompt: "",
    agentRules: {
      guardrails: [],
      redirectRules: [],
      refuseTopics: [],
    },
    allowedTools: [],
    schedule: null,
    notifyTarget: { targetType: "user", targetId: "" },
    cooldownMinutes: 30,
    enabled: true,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * Validate a 5-field numeric cron expression client-side (mirrors
 * server/agent-store.mjs `isValidCron` so obvious typos are caught
 * before the round-trip; the server re-validates authoritatively).
 * Supports `*`, ranges (`1-5`), steps (`0/15`, `1-30/2`), lists (`1,15,30`).
 */
const CRON_FIELD_BOUNDS: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 = Sunday)
];

function isValidCronPart(part: string, [min, max]: [number, number]): boolean {
  const m = part.match(/^(\*|\d{1,2})(?:-(\d{1,2}))?(?:\/(\d{1,3}))?$/);
  if (!m) return false;
  const [, startRaw, endRaw, stepRaw] = m;
  if (stepRaw !== undefined && parseInt(stepRaw, 10) < 1) return false;
  if (startRaw === "*") return endRaw === undefined; // `*-5` is not valid cron
  const start = parseInt(startRaw, 10);
  if (start < min || start > max) return false;
  if (endRaw !== undefined) {
    const end = parseInt(endRaw, 10);
    if (end < start || end > max) return false;
  }
  return true;
}

export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, i) => {
    if (field === "") return false;
    return field.split(",").every((part) => isValidCronPart(part, CRON_FIELD_BOUNDS[i]));
  });
}

/** Convert a string array to a newline-separated textarea value. */
export function linesToText(lines: string[]): string {
  return lines.join("\n");
}

/** Convert a newline-separated textarea value back to a string array. */
export function textToLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ── Derived helpers ──

/** Extract the provider id from a tool source string like "provider:grafana" */
export function getProvider(source?: string): string {
  if (!source) return "other";
  const parts = source.split(":");
  return parts[1] || parts[0] || "other";
}

/** Format uptime seconds into a human-readable string */
export function formatUptime(seconds?: number): string {
  if (!seconds && seconds !== 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

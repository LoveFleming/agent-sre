/**
 * types.ts — Shared types for the Agent SRE Platform UI
 */

// ── Navigation ──

export type ViewId =
  | "home"
  | "agents"
  | "tools"
  | "tasks"
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
